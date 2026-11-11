import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, TextCursorInput } from "lucide-react";
import blockbenchLogo from "../../assets/blockbench-logo.svg";
import BackgroundLogo from "../../components/BackgroundLogo";
import { BinIcon } from "../../components/Icons";
import SearchDropdown from "../../components/SearchDropdown";
import { findItem } from "../catalog";
import { ATLAS_PIXELS, buildPack, type BuiltPack, type PackSkin } from "../pack";
import type { DisplayTable, GlowInfo, ModelElement, SkinLibrary, SkinMeta } from "../types";
import { MC_VERSIONS, NEWEST_VERSION, findVersion } from "../versions";
import { usePrompt } from "./prompt";
import { Button, ErrorNote, PromptDialog, SectionTitle, Slider } from "./shared";
import { CHECKERBOARD, fieldStyle, panelStyle } from "./styles";

type Props = {
  onNewSkin: () => void;
  onEdit: (skin: SkinMeta) => void;
  onEditInBlockbench: (skin: SkinMeta) => void;
  notice: string | null;
};

// The size of the square buttons on each skin's card, like the instance page's.
const squareButton = { width: 38, height: 38, boxSizing: "border-box" as const, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" };

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
  const fieldLabel = (text: string) => <div style={{ fontSize: 12, color: "#bbb", marginBottom: 4 }}>{text}</div>;
  const folderName = outputFolder.split(/[\\/]/).filter(Boolean).pop() ?? outputFolder;

  /*
   * The models fill the page and scroll on their own; on the right, choosing what to see
   * sits above building a pack, both sized to fit the window.
   */
  return (
    <div style={{ display: "flex", gap: 18, flex: 1, minHeight: 0, minWidth: 0, alignItems: "stretch" }}>
      <div
        data-testid="skin-list"
        // No panel of its own: just the skin cards, with the page (and its logo) behind them.
        style={{ flex: 1, minWidth: 300, minHeight: 0, display: "flex", flexDirection: "column", boxSizing: "border-box", position: "relative" }}
      >
        <BackgroundLogo />
        {notice && <div style={{ color: "#86efac", fontSize: 14, marginBottom: 12, flexShrink: 0, position: "relative" }}>{notice}</div>}
        {error && <div style={{ marginBottom: 12, flexShrink: 0, position: "relative" }}><ErrorNote>{error}</ErrorNote></div>}

        <div data-testid="skin-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "-4px", padding: 4, position: "relative" }}>
        {visible.length === 0 ? (
          <div style={{ color: "#999", padding: "50px 10px", textAlign: "center", fontSize: 14 }}>
            No skins here yet.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {visible.map((skin) => (
              <div
                key={skin.id}
                data-testid="skin-card"
                style={{
                  border: `1px solid ${selected.has(skin.id) ? "#c084fc" : "#2b2140"}`,
                  borderRadius: 12,
                  padding: 10,
                  background: "#1a1a1a",
                }}
              >
                <label style={{ display: "block", cursor: "pointer" }}>
                  <div style={{ background: CHECKERBOARD, borderRadius: 8, display: "flex", justifyContent: "center", padding: 8 }}>
                    <img
                      src={skin.thumb}
                      alt=""
                      width={112}
                      height={112}
                      style={{ imageRendering: "pixelated" }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${skin.name}`}
                      checked={selected.has(skin.id)}
                      onChange={() => toggle(skin.id)}
                      style={{ accentColor: "#a855f7" }}
                    />
                    <span style={{ color: "white", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {skin.name}
                    </span>
                  </div>
                </label>
                <div style={{ color: "#999", fontSize: 12, lineHeight: 1.6, margin: "4px 0 8px" }}>
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
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                  <button className="sidebar-button" aria-label="Edit" data-tip="Edit: change the selection, item and thickness" style={squareButton} onClick={() => onEdit(skin)}>
                    <Pencil size={18} aria-hidden="true" />
                  </button>
                  <button className="sidebar-button" aria-label="Rename" data-tip="Rename this skin" style={squareButton} onClick={() => renameSkin(skin)}>
                    <TextCursorInput size={18} aria-hidden="true" />
                  </button>
                  <button
                    className="sidebar-button"
                    aria-label="Edit in Blockbench"
                    data-tip="Edit in Blockbench: change the model or paint it, then save it back here"
                    style={squareButton}
                    onClick={() => onEditInBlockbench(skin)}
                  >
                    <img src={blockbenchLogo} alt="" style={{ width: 19, height: 19 }} />
                  </button>
                  <button className="bin-button" aria-label="Delete" data-tip="Delete this skin" style={{ width: 38, height: 38, borderRadius: 10 }} onClick={() => deleteSkin(skin)}>
                    <BinIcon size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>

      <div style={{ flex: "0 0 360px", minHeight: 0, display: "flex", flexDirection: "column", gap: 10, textAlign: "left" }}>
        <div data-testid="skin-filters" style={{ ...panelStyle, padding: 14, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <Button primary onClick={onNewSkin} style={{ flex: 1 }}>New skin</Button>
            <Button onClick={createGroup} style={{ flex: 1 }}>
              {selected.size > 0 ? "Group selected" : "New group"}
            </Button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {filterButton(ALL, "All skins", library.skins.length)}
            {filterButton(SINGLES, "Singles", library.skins.filter((skin) => !skin.groupId).length)}
          </div>
          {/* However many groups there are, they take one line: search for one and pick it. */}
          {library.groups.length > 0 && (
            <div data-testid="group-picker">
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
          {activeGroup && (
            <div style={{ display: "flex", gap: 6 }}>
              <Button onClick={renameGroup} style={{ ...small, flex: 1 }}>Rename group</Button>
              <Button danger onClick={deleteGroup} style={{ ...small, flex: 1 }}>Delete group</Button>
            </div>
          )}
        </div>

        <div
          data-testid="pack-builder"
          // Never smaller than its form; a long result after building scrolls inside it instead.
          style={{ ...panelStyle, padding: 16, flex: "0 1 auto", minHeight: result ? 0 : undefined, display: "flex", flexDirection: "column" }}
        >
        <div style={{ color: "#c084fc", fontSize: 16, marginBottom: 2 }}>Build a resource pack</div>
        <div style={{ color: "#aaa", fontSize: 12, marginBottom: 10 }}>{packSource}</div>

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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
          <div>
            {fieldLabel("Minecraft version")}
            <SearchDropdown compact options={VERSION_OPTIONS} value={minVersion} placeholder="Search..." onChange={setMinVersion} />
          </div>
          <div>
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
          <div style={{ color: "#fda4af", fontSize: 12, margin: "-4px 0 10px" }}>
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
            style={{ fontSize: 12, margin: "-4px 0 10px", color: packAtlasShare > atlasBudget ? "#fbbf24" : "#86efac" }}
          >
            These skins take {packAtlasShare < 0.01 ? "under 0.01" : packAtlasShare.toFixed(2)}% of the atlas.
            {packAtlasShare > atlasBudget ? " Their largest textures will shrink to fit." : ""}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: "#bbb", flexShrink: 0 }}>Output folder</span>
          <div
            data-testid="output-folder"
            title={outputFolder || undefined}
            style={{ flex: 1, minWidth: 0, fontSize: 12, color: outputFolder ? "#ddd" : "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
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
          <div data-testid="pack-result" style={{ marginTop: 12, fontSize: 13, color: "#ddd", flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
            <div style={{ color: "#86efac", marginBottom: 6 }}>Pack written.</div>
            <div style={{ wordBreak: "break-all", color: "#aaa", fontSize: 12, marginBottom: 8 }}>{result.path}</div>
            <div style={{ color: "#aaa", fontSize: 12, marginBottom: 8 }}>
              Adds {result.atlasPixels.toLocaleString()} px to the item atlas, {((result.atlasPixels / ATLAS_PIXELS) * 100).toFixed(2)}% of its maximum.
            </div>
            {result.shrunk.length > 0 && (
              <div style={{ color: "#aaa", fontSize: 12, marginBottom: 8 }}>
                Shrunk to fit the budget: {result.shrunk.join(", ")}.
              </div>
            )}
            <Button onClick={() => window.skinBuilderAPI.revealPath(result.path)} style={{ width: "100%", marginBottom: 10 }}>
              Show in folder
            </Button>

            {result.warnings.map((warning) => (
              <div key={warning} style={{ color: "#fbbf24", fontSize: 12, marginBottom: 6 }}>{warning}</div>
            ))}

            <SectionTitle>Commands to get each skin</SectionTitle>
            {result.assignments.map((assignment) => (
              <div key={assignment.skinId} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: "#ccc", marginBottom: 2 }}>{assignment.skinName}</div>
                <code
                  style={{
                    display: "block",
                    fontSize: 11,
                    padding: 6,
                    background: "#0d0d0d",
                    color: "#c084fc",
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
      </div>

      <PromptDialog request={request} />
    </div>
  );
}
