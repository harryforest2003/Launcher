import { useEffect, useState } from "react";
import ImportPanel from "./ImportPanel";
import SearchDropdown from "./SearchDropdown";

type Props = {
  /** Called once an instance has been made or imported. */
  onDone: () => void;
  onCancel: () => void;
};

type MinecraftVersion = { id: string; type: string };
type LoaderOption = { id: string; name: string };
type LoaderVersion = { version?: string; version_number?: string; loader?: { version?: string } };

const field: React.CSSProperties = {
  padding: "15px",
  borderRadius: "10px",
  border: "1px solid #6d28d9",
  background: "#1a1a1a",
  color: "white",
  fontSize: "15px",
};

const loaderVersionOf = (v: LoaderVersion) => v.version || v.loader?.version || v.version_number || "";

// The listing to install from: Modrinth's when a pack is on both sites and allows it.
const installableSource = (item: CatalogItem) => {
  const usable = item.sources.filter((source) => source.installable);
  return usable.find((source) => source.source === "modrinth") ?? usable[0] ?? null;
};

const formatDownloads = (count: number) =>
  count >= 1e6 ? `${(count / 1e6).toFixed(1)}M` : count >= 1e3 ? `${Math.round(count / 1e3)}K` : String(count);

/* Making a new instance, or importing one, inside the Library. */
export default function CreateInstancePanel({ onDone, onCancel }: Props) {
  // Starts at the Default RAM from Settings once that has loaded.
  const [ram, setRam] = useState(4);
  const [instanceName, setInstanceName] = useState("");
  const [version, setVersion] = useState("");
  // "" matches the "Select Loader" option.
  const [loader, setLoader] = useState("");
  const [versions, setVersions] = useState<MinecraftVersion[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [loaders, setLoaders] = useState<LoaderOption[]>([]);
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([]);
  const [loaderVersion, setLoaderVersion] = useState("");
  const [jvmArgs, setJvmArgs] = useState("");

  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Starting from a modpack instead: what's searched, found and chosen.
  const [startFrom, setStartFrom] = useState<"blank" | "modpack">("blank");
  const [packQuery, setPackQuery] = useState("");
  const [packResults, setPackResults] = useState<CatalogItem[] | null>(null);
  const [searchingPacks, setSearchingPacks] = useState(false);
  const [pack, setPack] = useState<CatalogItem | null>(null);
  const [packNotice, setPackNotice] = useState<string | null>(null);

  // Popular packs at first, then whatever's typed, a moment after typing stops.
  useEffect(() => {
    if (startFrom !== "modpack") return;
    let current = true;
    const timer = setTimeout(async () => {
      setSearchingPacks(true);
      try {
        const page = await window.launcherAPI.browseCatalog({
          query: packQuery.trim(),
          type: "modpack",
          sort: packQuery.trim() ? "relevance" : "downloads",
          page: 1,
        });
        if (current) setPackResults(page.items.slice(0, 8));
      } catch (err) {
        if (current) setCreateError(err instanceof Error ? err.message : String(err));
      }
      if (current) setSearchingPacks(false);
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [startFrom, packQuery]);

  // Starter mods: the list from Settings, whether to add them, and what happened.
  const [starterList, setStarterList] = useState<StarterMod[]>([]);
  const [addStarter, setAddStarter] = useState(true);
  const [starterResult, setStarterResult] = useState<{ name: string; version: string; summary: StarterSummary } | null>(null);

  useEffect(() => {
    window.instanceAPI.starterModsList().then(setStarterList).catch(() => {});
    window.instanceAPI
      .getSettings()
      .then((settings) => setRam(settings.defaultRam))
      .catch(() => {});
    window.launcherAPI.getLoaders().then(setLoaders).catch(() => {});
    window.launcherAPI.getMinecraftVersions().then(setVersions).catch(() => {});
  }, []);

  // Mods need a loader; resource packs and the like don't.
  const hasLoader = loader !== "" && loader !== "vanilla";
  const starterCount = starterList.filter((entry) => entry.enabled && (hasLoader || entry.type !== "mod")).length;

  // Live install progress from the main process.
  useEffect(() => window.instanceAPI.onProgress(setProgress), []);

  useEffect(() => {
    let current = true;
    const versionsFor: Record<string, ((mc: string) => Promise<LoaderVersion[]>) | undefined> = {
      fabric: window.launcherAPI.getFabricVersions,
      quilt: window.launcherAPI.getQuiltVersions,
      forge: window.launcherAPI.getForgeVersions,
      neoforge: window.launcherAPI.getNeoForgeVersions,
    };
    const fetchVersions = loader && version ? versionsFor[loader] : undefined;

    (fetchVersions ? fetchVersions(version) : Promise.resolve([]))
      .then((list) => current && setLoaderVersions(list ?? []))
      .catch(() => current && setLoaderVersions([]));

    return () => {
      current = false;
    };
  }, [loader, version]);

  const shownVersions = versions.filter((v) => showSnapshots || v.type === "release");

  async function createFromPack(chosen: CatalogItem) {
    const source = installableSource(chosen);
    if (!source) return setCreateError(`${chosen.name}'s authors don't allow launchers to download it.`);

    setCreating(true);
    setCreateError(null);
    setProgress(null);
    setPackNotice(null);

    try {
      const created = await window.instanceAPI.installModpack({
        source: source.source,
        projectId: source.id,
        name: instanceName.trim() || chosen.name,
      });
      const blocked = created.pack?.blocked?.length ?? 0;

      if (blocked) {
        // Stay, to say which files need downloading by hand.
        setPackNotice(
          `Made ${created.name}: Minecraft ${created.version}, ${created.loader} ${created.loaderVersion}. ` +
            `${blocked} file${blocked === 1 ? "" : "s"} couldn't be downloaded automatically, as their authors don't allow it.`
        );
      } else {
        onDone();
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err));
    }

    setCreating(false);
  }

  async function create() {
    if (startFrom === "modpack") {
      if (!pack) return setCreateError("Choose a modpack first.");
      return createFromPack(pack);
    }

    const name = instanceName.trim();

    if (!name) return setCreateError("Give the instance a name first.");
    if (!version) return setCreateError("Pick a Minecraft version first.");

    setCreating(true);
    setCreateError(null);
    setProgress(null);
    setStarterResult(null);

    try {
      // Leaving loaderVersion empty makes the backend pick the latest build for this version.
      const created = await window.instanceAPI.create({
        name,
        version,
        loader: loader || "vanilla",
        loaderVersion,
        ram,
        jvmArgs,
        starterMods: addStarter && starterCount > 0,
      });

      // Stay to say how the starter mods went; otherwise there's nothing to add.
      if (created.starter) {
        setStarterResult({ name: created.name, version: created.version, summary: created.starter });
      } else {
        onDone();
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "Instance creation failed.");
    }

    setCreating(false);
  }

  return (
    <>
      <div className="game-card" style={{ maxWidth: "1000px", marginBottom: "25px" }}>
        <h2 style={{ color: "#d8b4fe", marginBottom: "20px" }}>Import Existing Instance</h2>
        <p style={{ color: "#9ca3af", marginBottom: "20px", lineHeight: "1.7" }}>
          Import Minecraft instances from other launchers, backups, ZIP files or cloud storage.
        </p>
        <ImportPanel onImported={onDone} />
      </div>

      <div className="game-card" style={{ maxWidth: "1000px", marginBottom: "200px" }} data-testid="create-instance">
        <h2 style={{ color: "#d8b4fe", marginBottom: "25px" }}>Create New Instance</h2>

        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <input
            value={instanceName}
            onChange={(e) => setInstanceName(e.target.value)}
            placeholder="Instance Name"
            aria-label="Instance name"
            style={field}
          />

          <div role="radiogroup" aria-label="Start from" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {(
              [
                ["blank", "Choose a version and loader"],
                ["modpack", "Start from a modpack"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                role="radio"
                aria-checked={startFrom === value}
                className="sidebar-button"
                style={{ flex: "1 1 220px", background: startFrom === value ? "#7c3aed" : undefined }}
                onClick={() => {
                  setStartFrom(value);
                  setCreateError(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {startFrom === "modpack" && (
            <div data-testid="modpack-picker" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                value={packQuery}
                onChange={(e) => setPackQuery(e.target.value)}
                placeholder="Search Modrinth and CurseForge modpacks..."
                aria-label="Search modpacks"
                style={field}
              />

              {searchingPacks && <div style={{ color: "#9ca3af", fontSize: 13 }}>Searching...</div>}
              {packResults && !searchingPacks && packResults.length === 0 && (
                <div style={{ color: "#9ca3af", fontSize: 13 }}>No modpacks found.</div>
              )}

              {packResults?.map((item) => {
                const source = installableSource(item);
                const chosen = pack?.id === item.id && pack.source === item.source;
                return (
                  <button
                    key={`${item.source}:${item.id}`}
                    data-testid="modpack-result"
                    disabled={!source}
                    title={source ? undefined : "Its authors don't allow launchers to download it."}
                    onClick={() => {
                      setPack(item);
                      if (!instanceName.trim() || instanceName === pack?.name) setInstanceName(item.name);
                    }}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      textAlign: "left",
                      padding: 10,
                      borderRadius: 10,
                      cursor: source ? "pointer" : "not-allowed",
                      opacity: source ? 1 : 0.5,
                      background: chosen ? "#2e1065" : "#1a1a1a",
                      border: `1px solid ${chosen ? "#a855f7" : "#333"}`,
                      color: "white",
                    }}
                  >
                    {item.icon ? (
                      <img src={item.icon} alt="" width={40} height={40} style={{ borderRadius: 8, flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 40, height: 40, borderRadius: 8, background: "#2b1d47", flexShrink: 0 }} />
                    )}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", color: "#ede9fe", fontSize: 14 }}>
                        {item.name}
                        {chosen ? " ✓" : ""}
                      </span>
                      <span style={{ display: "block", color: "#6b7280", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.sources.map((entry) => (entry.source === "modrinth" ? "Modrinth" : "CurseForge")).join(" + ")} •{" "}
                        {formatDownloads(item.downloads)} downloads • {item.summary}
                      </span>
                    </span>
                  </button>
                );
              })}

              <p style={{ color: "#6b7280", fontSize: 12, margin: 0 }}>
                The pack sets the Minecraft version, loader and mods, and its recommended RAM. You can
                change the RAM and Java in the instance's settings afterwards.
              </p>
            </div>
          )}

          {startFrom === "blank" && (
          <>
          <SearchDropdown
            value={version}
            onChange={setVersion}
            placeholder="Search Minecraft version..."
            options={shownVersions.map((v) => ({ value: v.id, label: v.type === "release" ? v.id : `${v.id} (${v.type.replace("_", " ")})` }))}
          />

          <label style={{ display: "flex", alignItems: "center", gap: "10px", color: "#d1d5db" }}>
            <input type="checkbox" checked={showSnapshots} onChange={(e) => setShowSnapshots(e.target.checked)} />
            Show snapshots and old versions
          </label>

          <select
            className="sidebar-button"
            style={{ width: "100%" }}
            value={loader}
            aria-label="Mod loader"
            onChange={(e) => setLoader(e.target.value)}
          >
            <option value="">Select Loader</option>
            {loaders.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>

          <select
            className="sidebar-button"
            style={{ width: "100%" }}
            value={loaderVersion}
            aria-label="Loader version"
            onChange={(e) => setLoaderVersion(e.target.value)}
            disabled={!hasLoader}
          >
            <option value="">Latest</option>
            {loaderVersions.map((v) => (
              <option key={loaderVersionOf(v)} value={loaderVersionOf(v)}>
                {loaderVersionOf(v)}
              </option>
            ))}
          </select>

          <hr style={{ border: "none", borderTop: "1px solid #333", margin: "15px 0" }} />

          <h2 style={{ color: "#d8b4fe", marginBottom: "10px" }}>Advanced</h2>

          <div>
            <p style={{ color: "#d8b4fe", marginBottom: "10px" }}>Allocated RAM: {ram} GB</p>
            <input
              type="range"
              min={1}
              max={32}
              step={1}
              value={ram}
              aria-label="Allocated RAM"
              onChange={(e) => setRam(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#7c3aed" }}
            />
          </div>

          <textarea
            rows={3}
            value={jvmArgs}
            onChange={(e) => setJvmArgs(e.target.value)}
            placeholder="Additional JVM arguments (optional)"
            aria-label="Additional JVM arguments"
            style={{ ...field, resize: "vertical" }}
          />

          <p style={{ color: "#6b7280", fontSize: 12, margin: "-10px 0 0" }}>
            The right Java for this version is downloaded automatically. You can choose a different one
            in the instance's settings.
          </p>

          <label data-testid="starter-toggle" style={{ display: "flex", alignItems: "center", gap: "10px", color: "#d1d5db" }}>
            <input
              type="checkbox"
              checked={addStarter && starterCount > 0}
              disabled={starterCount === 0}
              onChange={(event) => setAddStarter(event.target.checked)}
            />
            <span>
              Add starter mods ({starterCount})
              <span style={{ color: "#6b7280", fontSize: 12 }}>
                {!hasLoader && starterList.some((entry) => entry.enabled && entry.type === "mod")
                  ? " · mods need a mod loader, so only packs are added"
                  : " · choose which in Settings"}
              </span>
            </span>
          </label>
          </>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "15px", marginTop: "20px" }}>
            <button className="sidebar-button" onClick={onCancel}>
              Cancel
            </button>
            <button className="sidebar-button" style={{ background: "#7c3aed" }} disabled={creating} onClick={create}>
              {creating ? "Installing..." : "Create Instance"}
            </button>
          </div>

          {packNotice && (
            <div style={{ background: "#1a1a1a", border: "1px solid #b45309", borderRadius: 12, padding: 15, color: "#fcd34d" }}>
              {packNotice}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                <button className="sidebar-button" style={{ background: "#7c3aed" }} onClick={onDone}>
                  Done
                </button>
              </div>
            </div>
          )}

          {createError && (
            <div
              role="alert"
              style={{
                background: "#2a0d0d",
                border: "1px solid #ef4444",
                borderRadius: 12,
                padding: 15,
                color: "#fca5a5",
                whiteSpace: "pre-wrap",
              }}
            >
              {createError}
            </div>
          )}

          {starterResult && (
            <div
              data-testid="starter-result"
              style={{
                background: "#1a1a1a",
                border: "1px solid #6d28d9",
                borderRadius: 12,
                padding: 15,
                color: "#d4d4d8",
                fontSize: 14,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ color: "#86efac" }}>
                Made {starterResult.name}. Added {starterResult.summary.added.length} starter
                {starterResult.summary.added.length === 1 ? " mod" : " mods"}
                {starterResult.summary.dependencies.length ? `, plus ${starterResult.summary.dependencies.length} they need` : ""}.
              </div>

              {starterResult.summary.unavailable.length > 0 && (
                <div>
                  <span style={{ color: "#fcd34d" }}>No build for Minecraft {starterResult.version} yet, so skipped:</span>{" "}
                  {starterResult.summary.unavailable.join(", ")}
                </div>
              )}

              {starterResult.summary.failed.length > 0 && (
                <div style={{ color: "#fca5a5" }}>
                  Couldn't add: {starterResult.summary.failed.map((item) => `${item.name} (${item.reason})`).join("; ")}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="sidebar-button" style={{ background: "#7c3aed" }} onClick={onDone}>
                  Done
                </button>
              </div>
            </div>
          )}

          {creating && progress && (
            <div style={{ background: "#1a1a1a", border: "1px solid #6d28d9", borderRadius: 12, padding: 15 }}>
              <div style={{ color: "#d8b4fe", marginBottom: 10 }}>
                {progress.detail ?? progress.stage} ({progress.percent}%)
              </div>
              <div style={{ height: 8, background: "#333", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${progress.percent}%`, height: "100%", background: "#7c3aed", transition: "width .2s" }} />
              </div>
              <div style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}>
                {progress.stage === "starter"
                  ? "Adding your starter mods and what they need."
                  : "Downloading Minecraft, libraries and assets. The first install of a version takes a few minutes."}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
