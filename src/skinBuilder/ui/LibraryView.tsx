import { useCallback, useEffect, useMemo, useState } from "react";
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
    <Button key={id} active={filter === id} onClick={() => setFilter(id)} style={{ textAlign: "left", width: "100%" }}>
      {label} ({count})
    </Button>
  );

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ ...panelStyle, flex: "0 0 210px", display: "flex", flexDirection: "column", gap: 8 }}>
        <Button primary onClick={onNewSkin} style={{ width: "100%", marginBottom: 8 }}>New skin</Button>
        {filterButton(ALL, "All skins", library.skins.length)}
        {filterButton(SINGLES, "Singles", library.skins.filter((skin) => !skin.groupId).length)}
        <SectionTitle>Groups</SectionTitle>
        {library.groups.map((group) =>
          filterButton(group.id, group.name, library.skins.filter((skin) => skin.groupId === group.id).length)
        )}
        <Button onClick={createGroup} style={{ width: "100%" }}>
          {selected.size > 0 ? "Group selected" : "New group"}
        </Button>
        {activeGroup && (
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={renameGroup} style={{ flex: 1 }}>Rename</Button>
            <Button danger onClick={deleteGroup} style={{ flex: 1 }}>Delete</Button>
          </div>
        )}
      </div>

      <div style={{ ...panelStyle, flex: "1 1 360px", minWidth: 300 }}>
        {notice && <div style={{ color: "#86efac", fontSize: 14, marginBottom: 12 }}>{notice}</div>}
        {error && <div style={{ marginBottom: 12 }}><ErrorNote>{error}</ErrorNote></div>}

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

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <Button onClick={() => onEdit(skin)} style={{ padding: "6px 8px", fontSize: 12 }}>Edit</Button>
                  <Button onClick={() => renameSkin(skin)} style={{ padding: "6px 8px", fontSize: 12 }}>Rename</Button>
                  <Button
                    onClick={() => onEditInBlockbench(skin)}
                    style={{ padding: "6px 8px", fontSize: 12 }}
                    title="Change the model or paint it in Blockbench, then save it back here"
                  >
                    Blockbench
                  </Button>
                  <Button danger onClick={() => deleteSkin(skin)} style={{ padding: "6px 8px", fontSize: 12 }}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...panelStyle, flex: "0 0 320px" }}>
        <div style={{ color: "#c084fc", fontSize: 16, marginBottom: 6 }}>Build a resource pack</div>
        <div style={{ color: "#aaa", fontSize: 13, marginBottom: 12 }}>{packSource}</div>

        <label style={{ display: "block", fontSize: 13, color: "#ccc", marginBottom: 10 }}>
          Pack name
          <input
            aria-label="Pack name"
            value={packName}
            maxLength={60}
            onChange={(event) => setPackName(event.target.value)}
            style={{ ...fieldStyle, marginTop: 4 }}
          />
        </label>

        <div style={{ fontSize: 13, color: "#ccc", marginBottom: 4 }}>Minecraft version</div>
        <SearchDropdown options={VERSION_OPTIONS} value={minVersion} placeholder="Search versions..." onChange={setMinVersion} />
        <div style={{ fontSize: 13, color: "#ccc", margin: "10px 0 4px" }}>Up to</div>
        <SearchDropdown
          options={UP_TO_OPTIONS}
          value={maxVersion || "Only this version"}
          placeholder="Search versions..."
          onChange={setMaxVersion}
        />
        {rangeBackwards && (
          <div style={{ color: "#fda4af", fontSize: 13, marginTop: 6 }}>
            "Up to" must be the same as or newer than the first version.
          </div>
        )}

        <label style={{ display: "block", fontSize: 13, color: "#ccc", margin: "10px 0" }}>
          First custom model data number
          <input
            type="number"
            aria-label="First custom model data number"
            min={1}
            value={firstCmd}
            onChange={(event) => setFirstCmd(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
            style={{ ...fieldStyle, marginTop: 4 }}
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
            style={{ fontSize: 12, marginBottom: 12, color: packAtlasShare > atlasBudget ? "#fbbf24" : "#86efac" }}
          >
            These skins take {packAtlasShare < 0.01 ? "under 0.01" : packAtlasShare.toFixed(2)}% of the atlas.
            {packAtlasShare > atlasBudget ? " Their largest textures will shrink to fit." : ""}
          </div>
        )}

        <div style={{ fontSize: 13, color: "#ccc", marginBottom: 4 }}>Output folder</div>
        <div
          data-testid="output-folder"
          style={{ fontSize: 12, color: outputFolder ? "#ddd" : "#888", wordBreak: "break-all", marginBottom: 6 }}
        >
          {outputFolder || "You'll choose this the first time you build."}
        </div>
        <Button onClick={chooseFolder} style={{ width: "100%", marginBottom: 12 }}>
          {outputFolder ? "Change folder" : "Choose folder"}
        </Button>

        <Button primary disabled={!canBuild || rangeBackwards} onClick={buildAndWrite} style={{ width: "100%" }}>
          {building ? "Building..." : "Build pack"}
        </Button>

        {result && (
          <div data-testid="pack-result" style={{ marginTop: 14, fontSize: 13, color: "#ddd" }}>
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

      <PromptDialog request={request} />
    </div>
  );
}
