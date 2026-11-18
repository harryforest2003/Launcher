import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderPlus, ImagePlus, Package, Pencil, Plus, TextCursorInput } from "lucide-react";
import UiButton from "../../components/ui/Button";
import Modal from "../../components/ui/Modal";
import blockbenchLogo from "../../assets/blockbench-logo.svg";
import BackgroundLogo from "../../components/BackgroundLogo";
import { BinIcon } from "../../components/Icons";
import SearchDropdown from "../../components/SearchDropdown";
import { findItem } from "../catalog";
import { ATLAS_PIXELS, buildPack, type BuiltPack, type PackSkin } from "../pack";
import type { DisplayTable, GlowInfo, ModelElement, SkinLibrary, SkinMeta } from "../types";
import { MC_VERSIONS, NEWEST_VERSION, findVersion } from "../versions";
import { START_ITEMS } from "./startItems";
import { usePrompt } from "./prompt";
import { Button, ErrorNote, PromptDialog, SectionTitle, Slider } from "./shared";
import { CHECKERBOARD, fieldStyle } from "./styles";

type Props = {
  /** Starts a new skin; itemId preselects the item (a sword when omitted). */
  onNewSkin: (itemId?: string) => void;
  onEdit: (skin: SkinMeta) => void;
  onEditInBlockbench: (skin: SkinMeta) => void;
  notice: string | null;
};

// The size of the square buttons on each skin's card, like the instance page's.
const squareButton = { width: 28, height: 28, boxSizing: "border-box" as const, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" };

const ALL = "__all__";
const SINGLES = "__singles__";

const VERSION_OPTIONS = MC_VERSIONS.slice()
  .reverse()
  .map((version) => ({ value: version.id, label: version.id }));

const UP_TO_OPTIONS = [{ value: "", label: "Only this version" }, ...VERSION_OPTIONS];

function messageOf(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

async function loadPackSkin(meta: SkinMeta): Promise<PackSkin> {
  const api = window.skinBuilderAPI;
  const [texturePng, modelBytes] = await Promise.all([
    api.readSkinFile(meta.id, "texture.png"),
    api.readSkinFile(meta.id, "model.json"),
  ]);
  const { elements, display, glow } = JSON.parse(new TextDecoder().decode(modelBytes)) as {
    elements: ModelElement[];
    display?: DisplayTable;
    glow?: GlowInfo;
  };

  if (!glow) return { meta, texturePng, elements, display };

  const [stripPng, stillPng] = await Promise.all([
    api.readSkinFile(meta.id, "glow.png"),
    api.readSkinFile(meta.id, "glow_still.png"),
  ]);
  return { meta, texturePng, elements, display, glow: { info: glow, stripPng, stillPng } };
}

// A 16x16 pixel-art sword, drawn like a Minecraft item texture: an outlined blade along the diagonal,
// a crossguard across it, a wooden grip and a pommel. A darker copy behind it hints at thickness.
const SWORD_PIXELS: [number, number, string][] = (() => {
  const pixels: [number, number, string][] = [];
  const line = (from: number, to: number, y: (x: number) => number, kind: string) => {
    for (let x = from; x <= to; x++) pixels.push([x, y(x), kind]);
  };
  line(6, 13, (x) => 14 - x, "outline");
  line(8, 15, (x) => 17 - x, "outline");
  pixels.push([14, 0, "outline"], [15, 0, "outline"], [15, 1, "outline"]);
  line(6, 14, (x) => 15 - x, "blade");
  line(7, 14, (x) => 16 - x, "edge");
  line(3, 7, (x) => x + 5, "guard");
  line(4, 7, (x) => x + 4, "guardShade");
  line(2, 4, (x) => 15 - x, "handle");
  pixels.push([0, 14, "pommel"], [1, 14, "pommel"], [0, 15, "pommel"], [1, 15, "pommelShade"]);
  return pixels;
})();

const SWORD_FILL: Record<string, string> = {
  outline: "#15131c",
  blade: "#eef1f6",
  edge: "#a7b1c2",
  guard: "var(--color-accent)",
  guardShade: "var(--color-accent-hover, var(--color-accent))",
  handle: "#8a5a32",
  pommel: "var(--color-accent)",
  pommelShade: "#15131c",
};

function PixelSword() {
  return (
    <svg viewBox="-0.5 -0.5 17 17" width="100%" height="100%" style={{ maxWidth: 260, maxHeight: 260 }} shapeRendering="crispEdges" role="presentation">
      <g transform="translate(0.75 0.75)" fill="#000" opacity="0.4">
        {SWORD_PIXELS.map(([x, y], i) => <rect key={i} x={x} y={y} width="1" height="1" />)}
      </g>
      {SWORD_PIXELS.map(([x, y, kind], i) => <rect key={i} x={x} y={y} width="1" height="1" fill={SWORD_FILL[kind]} />)}
    </svg>
  );
}

export default function LibraryView({ onNewSkin, onEdit, onEditInBlockbench, notice }: Props) {
  const [library, setLibrary] = useState<SkinLibrary>({ groups: [], skins: [] });
  const [filter, setFilter] = useState(ALL);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const { request, ask } = usePrompt();

  const [packName, setPackName] = useState("My Skins");
  const [minVersion, setMinVersion] = useState(NEWEST_VERSION);
  const [maxVersion, setMaxVersion] = useState("");
  const [firstCmd, setFirstCmd] = useState(1337);
  const [atlasBudget, setAtlasBudget] = useState(0.5);
  const [outputFolder, setOutputFolder] = useState("");
  const [building, setBuilding] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const [result, setResult] = useState<(BuiltPack & { path: string }) | null>(null);

  const reload = useCallback(async () => {
    try {
      setLibrary(await window.skinBuilderAPI.getLibrary());
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    const api = window.skinBuilderAPI;
    Promise.all([api.getLibrary(), api.getOutputFolder()])
      .then(([loaded, folder]) => {
        setLibrary(loaded);
        setOutputFolder(folder);
      })
      .catch((err) => setError(messageOf(err)));
  }, []);

  const visible = useMemo(() => {
    if (filter === ALL) return library.skins;
    if (filter === SINGLES) return library.skins.filter((skin) => !skin.groupId);
    return library.skins.filter((skin) => skin.groupId === filter);
  }, [filter, library.skins]);

  const activeGroup = library.groups.find((group) => group.id === filter);

  /** Ticked skins win. With none ticked, a group view exports that whole group. */
  const packSkins = useMemo(() => {
    const ticked = library.skins.filter((skin) => selected.has(skin.id));
    if (ticked.length > 0) return ticked;
    return activeGroup ? visible : [];
  }, [activeGroup, library.skins, selected, visible]);

  const packSource =
    selected.size > 0
      ? `${selected.size} selected skin${selected.size === 1 ? "" : "s"}`
      : activeGroup
        ? `Group "${activeGroup.name}" (${visible.length} skin${visible.length === 1 ? "" : "s"})`
        : "Nothing yet. Tick some skins or open a group.";

  const packAtlasShare =
    (packSkins.reduce((sum, skin) => sum + (skin.atlasPixels || skin.textureWidth * skin.textureHeight), 0) / ATLAS_PIXELS) * 100;

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(messageOf(err));
    }
  };

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createGroup = () =>
    run(async () => {
      const name = await ask("Name for the new group");
      if (!name) return;
      const group = await window.skinBuilderAPI.createGroup(name);
      if (selected.size > 0) {
        await Promise.all([...selected].map((id) => window.skinBuilderAPI.updateSkin(id, { groupId: group.id })));
      }
      setFilter(group.id);
      setSelected(new Set());
    });

  const renameGroup = () =>
    run(async () => {
      if (!activeGroup) return;
      const name = await ask("New name for this group", activeGroup.name);
      if (name) await window.skinBuilderAPI.renameGroup(activeGroup.id, name);
    });

  const deleteGroup = () =>
    run(async () => {
      if (!activeGroup) return;
      if (!window.confirm(`Delete the group "${activeGroup.name}"? Its skins are kept as singles.`)) return;
      await window.skinBuilderAPI.deleteGroup(activeGroup.id);
      setFilter(ALL);
    });

  const renameSkin = (skin: SkinMeta) =>
    run(async () => {
      const name = await ask("New name for this skin", skin.name);
      if (name) await window.skinBuilderAPI.updateSkin(skin.id, { name });
    });

  const deleteSkin = (skin: SkinMeta) =>
    run(async () => {
      if (!window.confirm(`Delete "${skin.name}"? This cannot be undone.`)) return;
      await window.skinBuilderAPI.deleteSkin(skin.id);
      setSelected((current) => {
        const next = new Set(current);
        next.delete(skin.id);
        return next;
      });
    });

  const chooseFolder = async () => {
    setError(null);
    try {
      const folder = await window.skinBuilderAPI.pickOutputFolder();
      if (folder) setOutputFolder(folder);
      return folder;
    } catch (err) {
      setError(messageOf(err));
      return null;
    }
  };

  const buildAndWrite = async () => {
    setBuilding(true);
    setError(null);
    setResult(null);

    try {
      // Native folder picker the first time; the choice is remembered after that.
      const folder = outputFolder || (await chooseFolder());
      if (!folder) {
        setBuilding(false);
        return;
      }

      const skins = await Promise.all(packSkins.map(loadPackSkin));
      const icon = await window.skinBuilderAPI.readSkinFile(packSkins[0].id, "thumb.png");

      const pack = await buildPack({
        name: packName.trim() || "My Skins",
        description: `${packName.trim() || "My Skins"}, made with Unity Launcher`,
        minVersion,
        maxVersion: maxVersion || minVersion,
        firstCustomModelData: firstCmd,
        atlasBudgetPercent: atlasBudget,
        skins,
        icon,
      });

      let written = await window.skinBuilderAPI.writePack(pack.fileName, pack.zip);
      if (!written.written) {
        const replace = window.confirm(`${pack.fileName} already exists in this folder. Replace it?`);
        if (!replace) {
          setBuilding(false);
          return;
        }
        written = await window.skinBuilderAPI.writePack(pack.fileName, pack.zip, true);
      }

      setResult({ ...pack, path: written.path });
    } catch (err) {
      setError(messageOf(err));
    }
    setBuilding(false);
  };

  const canBuild = packSkins.length > 0 && !building;
  const rangeBackwards =
    Boolean(maxVersion) && findVersion(maxVersion).order < findVersion(minVersion).order;

  const filterButton = (id: string, label: string, count: number) => (
    <Button key={id} active={filter === id} onClick={() => setFilter(id)} style={{ padding: "6px 11px", fontSize: 13 }}>
      {label} ({count})
    </Button>
  );

  const small = { padding: "7px 10px", fontSize: 13 };
  const groupCount = (id: string) => library.skins.filter((skin) => skin.groupId === id).length;
  const groupOptions = library.groups
    .map((group) => ({ value: group.id, label: `${group.name} (${groupCount(group.id)})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const fieldLabel = (text: string) => <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>{text}</div>;
  const folderName = outputFolder.split(/[\\/]/).filter(Boolean).pop() ?? outputFolder;

  const hasSkins = library.skins.length > 0;

  /*
   * No skins: one hero with one action. With skins: a toolbar (filter, group, pack) over a
   * grid that fills the width. The pack form lives in a dialog, opened from the toolbar.
   */
  return (
    <div className="sk-library" data-testid="skin-list-page">
      <div
        data-testid="skin-list"
        style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", boxSizing: "border-box", position: "relative" }}
      >
        <BackgroundLogo />
        {notice && <div style={{ color: "var(--color-success-text)", fontSize: 14, marginBottom: 12, flexShrink: 0, position: "relative" }}>{notice}</div>}
        {error && <div style={{ marginBottom: 12, flexShrink: 0, position: "relative" }}><ErrorNote>{error}</ErrorNote></div>}

        {hasSkins && (
          <div data-testid="skin-filters" className="sk-toolbar">
            <div className="sk-toolbar__filters">
              {filterButton(ALL, "All skins", library.skins.length)}
              {filterButton(SINGLES, "Singles", library.skins.filter((skin) => !skin.groupId).length)}
              {library.groups.length > 0 && (
                <div data-testid="group-picker" className="sk-toolbar__groups">
                  <SearchDropdown
                    compact
                    active={Boolean(activeGroup)}
                    label="Show a group"
                    options={groupOptions}
                    value={activeGroup ? `${activeGroup.name} (${groupCount(activeGroup.id)})` : ""}
                    placeholder={`Search ${library.groups.length} group${library.groups.length === 1 ? "" : "s"}...`}
                    onChange={setFilter}
                  />
                </div>
              )}
            </div>
            <div className="sk-toolbar__actions">
              {activeGroup && (
                <>
                  <UiButton size="sm" variant="ghost" onClick={renameGroup}>Rename group</UiButton>
                  <UiButton size="sm" variant="danger" onClick={deleteGroup}>Delete group</UiButton>
                </>
              )}
              <UiButton variant="secondary" icon={<FolderPlus size={16} aria-hidden="true" />} onClick={createGroup}>
                {selected.size > 0 ? "Group selected" : "New group"}
              </UiButton>
              <UiButton variant="secondary" icon={<Package size={16} aria-hidden="true" />} onClick={() => setPackOpen(true)}>
                Build resource pack{packSkins.length > 0 ? ` (${packSkins.length})` : ""}
              </UiButton>
              <UiButton variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => onNewSkin()}>New skin</UiButton>
            </div>
          </div>
        )}

        <div data-testid="skin-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "-4px", padding: 4, position: "relative" }}>
        {!hasSkins ? (
          <div data-testid="skin-empty" className="sk-empty-state">
            <div className="sk-start__head">
              <div>
                <h2>Make your first item model</h2>
                <p>Pick the kind of item, then import a picture of it. Each model gets its own custom model data number in your resource pack.</p>
              </div>
              <UiButton variant="primary" size="lg" icon={<ImagePlus size={18} aria-hidden="true" />} data-testid="skin-template-picture" onClick={() => onNewSkin()}>
                Import a picture
              </UiButton>
            </div>

            <div className="sk-start__main">
              <section aria-label="Start from">
                <h3 className="sk-start__label">Start from</h3>
                <div className="sk-start__cards">
                  {START_ITEMS.map((entry) => {
                    const Icon = entry.icon;
                    return (
                      <button key={entry.id} type="button" className="sk-start__card" data-testid="skin-template" onClick={() => onNewSkin(entry.id)}>
                        <span className="sk-start__thumb" aria-hidden="true"><Icon size={22} /></span>
                        <span className="sk-start__text">
                          <strong>{entry.name}</strong>
                          <span className="sk-start__sub">{entry.sub}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section aria-label="Example" className="sk-start__col">
                <h3 className="sk-start__label">What you get</h3>
                <div className="sk-start__preview" aria-hidden="true">
                  <div className="sk-start__tabs">
                    <span className="sk-start__tab">Selection</span>
                    <span className="sk-start__tab is-on">Thickness</span>
                    <span className="sk-start__tab">Preview</span>
                  </div>
                  <div className="sk-start__stage" style={{ background: CHECKERBOARD }}>
                    <PixelSword />
                  </div>
                  <div className="sk-start__bar">
                    <span>Thickness</span>
                    <span className="sk-start__track" />
                    <span>2 px</span>
                  </div>
                </div>
              </section>
            </div>

            <div>
              <h3 className="sk-start__label">How it works</h3>
              <ol className="sk-start__steps">
                {[
                  ["Import a picture", "Use a picture of the tool or weapon."],
                  ["Cut it out", "The background is removed automatically. Touch up the edges."],
                  ["Pick the item and thickness", "Choose what it is and how chunky it should be."],
                  ["Build the resource pack", "Each model gets a custom model data number. Give the pack to players or use it on a server."],
                ].map(([title, text], index) => (
                  <li key={title} className="sk-start__step">
                    <span className="sk-start__num">{index + 1}</span>
                    <span>
                      <strong>{title}</strong>
                      <span className="sk-start__sub">{text}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div data-testid="skin-empty" className="sk-empty">Nothing in this view. Pick another group or tick skins and use "Group selected".</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 10 }}>
            {visible.map((skin) => (
              <div
                key={skin.id}
                data-testid="skin-card"
                style={{
                  border: `1px solid ${selected.has(skin.id) ? "var(--color-accent-line)" : "var(--color-border)"}`,
                  borderRadius: 12,
                  padding: 10,
                  background: "var(--color-surface)",
                }}
              >
                <label style={{ display: "block", cursor: "pointer" }}>
                  <div style={{ background: CHECKERBOARD, borderRadius: 8, display: "flex", justifyContent: "center", padding: 6 }}>
                    <img
                      src={skin.thumb}
                      alt=""
                      width={88}
                      height={88}
                      style={{ imageRendering: "pixelated" }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${skin.name}`}
                      checked={selected.has(skin.id)}
                      onChange={() => toggle(skin.id)}
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                    <span style={{ color: "var(--color-text)", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {skin.name}
                    </span>
                  </div>
                </label>
                <div style={{ color: "var(--color-text-muted)", fontSize: 12, lineHeight: 1.6, margin: "4px 0 8px" }}>
                  <div>{findItem(skin.itemId).label}</div>
                  <div>{skin.textureWidth} x {skin.textureHeight} px, {skin.elementCount} elements</div>
                </div>

                <select
                  aria-label={`Group for ${skin.name}`}
                  value={skin.groupId ?? ""}
                  onChange={(event) =>
                    run(() => window.skinBuilderAPI.updateSkin(skin.id, { groupId: event.target.value || null }))
                  }
                  style={{ ...fieldStyle, padding: "6px 8px", fontSize: 12, marginBottom: 8 }}
                >
                  <option value="">Single</option>
                  {library.groups.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>

                {/* Square buttons with the app's usual symbols; what each does comes up on hover. */}
                <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                  <button className="sidebar-button" aria-label="Edit" data-tip="Edit: change the selection, item and thickness" style={squareButton} onClick={() => onEdit(skin)}>
                    <Pencil size={15} aria-hidden="true" />
                  </button>
                  <button className="sidebar-button" aria-label="Rename" data-tip="Rename this skin" style={squareButton} onClick={() => renameSkin(skin)}>
                    <TextCursorInput size={15} aria-hidden="true" />
                  </button>
                  <button
                    className="sidebar-button"
                    aria-label="Edit in Blockbench"
                    data-tip="Edit in Blockbench: change the model or paint it, then save it back here"
                    style={squareButton}
                    onClick={() => onEditInBlockbench(skin)}
                  >
                    <img src={blockbenchLogo} alt="" style={{ width: 16, height: 16 }} />
                  </button>
                  <button className="bin-button" aria-label="Delete" data-tip="Delete this skin" style={{ width: 28, height: 28, borderRadius: 8 }} onClick={() => deleteSkin(skin)}>
                    <BinIcon size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>

      <Modal
        open={packOpen}
        onClose={() => setPackOpen(false)}
        title="Build a resource pack"
        lead={packSource}
        size="sm"
      >
        <div data-testid="pack-builder" style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>

        <label style={{ display: "block", marginBottom: 8 }}>
          {fieldLabel("Pack name")}
          <input
            aria-label="Pack name"
            value={packName}
            maxLength={60}
            onChange={(event) => setPackName(event.target.value)}
            style={{ ...fieldStyle, padding: "8px 10px" }}
          />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            {fieldLabel("Minecraft version")}
            <SearchDropdown compact options={VERSION_OPTIONS} value={minVersion} placeholder="Search..." onChange={setMinVersion} />
          </div>
          <div style={{ minWidth: 0 }}>
            {fieldLabel("Up to")}
            <SearchDropdown
              compact
              options={UP_TO_OPTIONS}
              value={maxVersion || "Only this version"}
              placeholder="Search..."
              onChange={setMaxVersion}
            />
          </div>
        </div>
        {rangeBackwards && (
          <div style={{ color: "var(--color-danger-text)", fontSize: 12, margin: "-4px 0 10px" }}>
            "Up to" must be the same as or newer than the first version.
          </div>
        )}

        <label style={{ display: "block", marginBottom: 8 }}>
          {fieldLabel("First custom model data number")}
          <input
            type="number"
            aria-label="First custom model data number"
            min={1}
            value={firstCmd}
            onChange={(event) => setFirstCmd(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
            style={{ ...fieldStyle, padding: "8px 10px" }}
          />
        </label>

        <Slider
          label="Atlas budget"
          value={atlasBudget}
          min={0.1}
          max={3}
          step={0.1}
          format={(v) => `${v.toFixed(1)}%`}
          onChange={setAtlasBudget}
        />
        {packSkins.length > 0 && (
          <div
            data-testid="atlas-meter"
            style={{ fontSize: 12, margin: "-4px 0 10px", color: packAtlasShare > atlasBudget ? "var(--color-warning-text)" : "var(--color-success-text)" }}
          >
            These skins take {packAtlasShare < 0.01 ? "under 0.01" : packAtlasShare.toFixed(2)}% of the atlas.
            {packAtlasShare > atlasBudget ? " Their largest textures will shrink to fit." : ""}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", flexShrink: 0 }}>Output folder</span>
          <div
            data-testid="output-folder"
            title={outputFolder || undefined}
            style={{ flex: 1, minWidth: 0, fontSize: 12, color: outputFolder ? "var(--color-text-secondary)" : "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {outputFolder ? folderName : "Not chosen yet"}
          </div>
          <Button onClick={chooseFolder} style={{ ...small, flexShrink: 0 }}>
            {outputFolder ? "Change" : "Choose folder"}
          </Button>
        </div>

        <Button primary disabled={!canBuild || rangeBackwards} onClick={buildAndWrite} style={{ width: "100%", flexShrink: 0 }}>
          {building ? "Building..." : "Build pack"}
        </Button>

        {result && (
          <div data-testid="pack-result" style={{ marginTop: 12, fontSize: 13, color: "var(--color-text-secondary)", flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
            <div style={{ color: "var(--color-success-text)", marginBottom: 6 }}>Pack written.</div>
            <div style={{ wordBreak: "break-all", color: "var(--color-text-secondary)", fontSize: 12, marginBottom: 8 }}>{result.path}</div>
            <div style={{ color: "var(--color-text-secondary)", fontSize: 12, marginBottom: 8 }}>
              Adds {result.atlasPixels.toLocaleString()} px to the item atlas, {((result.atlasPixels / ATLAS_PIXELS) * 100).toFixed(2)}% of its maximum.
            </div>
            {result.shrunk.length > 0 && (
              <div style={{ color: "var(--color-text-secondary)", fontSize: 12, marginBottom: 8 }}>
                Shrunk to fit the budget: {result.shrunk.join(", ")}.
              </div>
            )}
            <Button onClick={() => window.skinBuilderAPI.revealPath(result.path)} style={{ width: "100%", marginBottom: 10 }}>
              Show in folder
            </Button>

            {result.warnings.map((warning) => (
              <div key={warning} style={{ color: "var(--color-warning-text)", fontSize: 12, marginBottom: 6 }}>{warning}</div>
            ))}

            <SectionTitle>Commands to get each skin</SectionTitle>
            {result.assignments.map((assignment) => (
              <div key={assignment.skinId} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 2 }}>{assignment.skinName}</div>
                <code
                  style={{
                    display: "block",
                    fontSize: 11,
                    padding: 6,
                    background: "var(--color-bg)",
                    color: "var(--color-accent-text)",
                    borderRadius: 6,
                    wordBreak: "break-all",
                  }}
                >
                  {assignment.command}
                </code>
                <Button
                  onClick={() => navigator.clipboard.writeText(assignment.command)}
                  style={{ padding: "4px 8px", fontSize: 12, marginTop: 4 }}
                >
                  Copy
                </Button>
                {assignment.stillCommand && (
                  <Button
                    onClick={() => navigator.clipboard.writeText(assignment.stillCommand ?? "")}
                    style={{ padding: "4px 8px", fontSize: 12, marginTop: 4, marginLeft: 6 }}
                  >
                    Copy still version
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        </div>
      </Modal>

      <PromptDialog request={request} />
    </div>
  );
}
