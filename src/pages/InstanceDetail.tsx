import { useCallback, useEffect, useRef, useState } from "react";
import GitHubInstall from "../components/GitHubInstall";
import InstanceLog from "../components/InstanceLog";
import ModUpdatesPanel from "../components/ModUpdatesPanel";
import InstanceScreenshots from "../components/InstanceScreenshots";
import InstanceWorlds from "../components/InstanceWorlds";
import Pagination from "../components/Pagination";
import SourceDownloads from "../components/SourceDownloads";

type Props = {
  instanceName: string;
  onBack: () => void;
};

type Tab = "mods" | "browse" | "worlds" | "screenshots" | "log" | "settings";

// What the instance folder opens in, by system.
const FILE_MANAGER = navigator.userAgent.includes("Mac") ? "Finder" : navigator.userAgent.includes("Windows") ? "File Explorer" : "your file manager";

const CONTENT_TABS: { type: ContentType; label: string; singular: string }[] = [
  { type: "mod", label: "Mods", singular: "mod" },
  { type: "resourcepack", label: "Resource Packs", singular: "resource pack" },
  { type: "shader", label: "Shaders", singular: "shader" },
  { type: "datapack", label: "Data Packs", singular: "data pack" },
];

const NO_CONTENT: InstanceContent = {
  mod: [],
  resourcepack: [],
  shader: [],
  datapack: [],
  worlds: [],
};

function itemKey(item: ContentRef) {
  return `${item.type}/${item.world ?? ""}/${item.fileName}`;
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

const card: React.CSSProperties = {
  background: "#151515",
  border: "1px solid #6d28d9",
  borderRadius: 12,
  padding: 16,
};

export default function InstanceDetail({ instanceName, onBack }: Props) {
  const [instance, setInstance] = useState<Instance | null>(null);
  const [content, setContent] = useState<InstanceContent>(NO_CONTENT);
  const [contentType, setContentType] = useState<ContentType>("mod");
  const [installWorld, setInstallWorld] = useState<string | null>(null);
  // Worlds are listed most recently played first, so that is the default choice.
  const targetWorld = installWorld ?? content.worlds[0] ?? "";
  const [tab, setTab] = useState<Tab>("mods");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /* ---------------- loading ---------------- */

  const refresh = useCallback(async () => {
    try {
      const [inst, list] = await Promise.all([
        window.instanceAPI.get(instanceName),
        window.instanceAPI.content(instanceName),
      ]);

      setInstance(inst);
      setContent(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [instanceName]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /* ---------------- repair progress ---------------- */

  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);

  const loadLastBackup = useCallback(async () => {
    const { instances } = await window.instanceAPI.cloudList();
    setLastBackup(instances.find((entry) => entry.name === instanceName)?.modified ?? null);
  }, [instanceName]);

  useEffect(() => {
    loadLastBackup().catch(() => {});
  }, [loadLastBackup]);

  /* ---------------- per-instance settings ---------------- */
  const [ramDraft, setRamDraft] = useState<number | null>(null);
  const [jvmDraft, setJvmDraft] = useState<string | null>(null);
  // What an exported modpack includes beyond mods and config.
  const [exportWorlds, setExportWorlds] = useState(false);
  const [exportOptions, setExportOptions] = useState(false);
  // The name typed for a copy, or null for the suggested one.
  const [copyName, setCopyName] = useState<string | null>(null);
  const [system, setSystem] = useState<LauncherSettings["system"] | null>(null);
  // The Java chosen in Settings for every instance, if any, and what automatic would use here.
  const [globalJava, setGlobalJava] = useState("");
  const [javaInfo, setJavaInfo] = useState<{ majorVersion: number; downloaded: boolean } | null>(null);

  useEffect(() => {
    window.instanceAPI.javaInfo(instanceName).then(setJavaInfo).catch(() => setJavaInfo(null));
  }, [instanceName, instance?.versionId]);

  useEffect(() => {
    window.instanceAPI
      .getSettings()
      .then((s) => {
        setSystem(s.system);
        setGlobalJava(s.javaPath ?? "");
      })
      .catch(() => setSystem(null));
  }, []);

  // Seed the drafts once the instance loads.
  useEffect(() => {
    if (!instance) return;

    setRamDraft((current) => (current === null ? instance.ram : current));
    setJvmDraft((current) => (current === null ? (instance.jvmArgs ?? "") : current));
  }, [instance]);

  useEffect(() => {
    return window.instanceAPI.onProgress((p) => {
      if (p.name === instanceName) setProgress(p);
    });
  }, [instanceName]);

  useEffect(() => {
    return window.instanceAPI.onExit(({ name, code }) => {
      if (name !== instanceName) return;
      refresh();
      if (code !== 0) setTab("log");
    });
  }, [instanceName, refresh]);

  /* ---------------- actions ---------------- */

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    setNotice(null);

    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    setBusy(null);
  }

  async function launch() {
    setBusy("launch");
    setError(null);
    setNotice(null);

    try {
      setProgress(null);
      setTab("log");
      const result = await window.instanceAPI.launch(instanceName);

      setNotice(
        result.online
          ? `Launched as ${result.playerName}.`
          : `Launched in offline mode as ${result.playerName} — sign in on the ` +
            `Minecraft screen to play online.`
      );

      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    setBusy(null);
  }

  async function toggleItem(item: InstanceMod) {
    await run(itemKey(item), () =>
      window.instanceAPI.contentToggle(instanceName, item, !item.enabled)
    );
  }

  async function deleteItem(item: InstanceMod) {
    if (!confirm(`Delete "${item.name}"?`)) return;

    await run(itemKey(item), () =>
      window.instanceAPI.contentDelete(instanceName, item)
    );
  }

  async function addToWorld(item: InstanceMod, world: string) {
    await run(itemKey(item), async () => {
      await window.instanceAPI.copyDatapack(instanceName, item.fileName, world);
      setNotice(`Added ${item.name} to ${world}.`);
    });
  }

  /* ---------------- browse ---------------- */

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [browsed, setBrowsed] = useState<CatalogPage | null>(null);
  const results = browsed?.items ?? [];
  const browseTop = useRef<HTMLDivElement>(null);

  // A chosen page belongs to the search it was chosen in, so any new search starts
  // at page 1 without first asking for that page of the new results.
  const browseKey = `${contentType}/${debounced}`;
  const [chosenPage, setChosenPage] = useState({ browseKey, page: 1 });
  const browsePage = chosenPage.browseKey === browseKey ? chosenPage.page : 1;
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showGitHub, setShowGitHub] = useState(false);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const isVanilla = instance?.loader === "vanilla";
  const cantUseThisType = isVanilla && contentType === "mod";

  useEffect(() => {
    if (tab !== "browse" || !instance || cantUseThisType) return;

    let active = true;
    setSearching(true);

    window.instanceAPI
      .modSearch(instanceName, { query: debounced, type: contentType, page: browsePage })
      .then((r) => {
        if (!active) return;
        setBrowsed(r);
        setWarnings(r.warnings);
      })
      .catch((err) => {
        if (!active) return;
        setBrowsed(null);
        setWarnings([err instanceof Error ? err.message : String(err)]);
      })
      .finally(() => {
        if (active) setSearching(false);
      });

    return () => {
      active = false;
    };
  }, [tab, debounced, instanceName, instance, contentType, cantUseThisType, browsePage]);

  useEffect(() => {
    browseTop.current?.scrollIntoView({ block: "start" });
  }, [browsePage]);

  async function install(mod: (typeof results)[number]) {
    setInstalling(mod.id);
    setError(null);
    setNotice(null);

    // Where a project is on both sites, the second is tried if the first has no
    // file for this instance or its author restricts downloads there.
    const tryInstall = async (remaining: typeof mod.sources): Promise<Awaited<ReturnType<typeof window.instanceAPI.modInstall>>> => {
      const [next, ...rest] = remaining;
      try {
        return await window.instanceAPI.modInstall({
          name: instanceName,
          source: next.source,
          projectId: next.id,
          modName: mod.name,
          iconUrl: mod.icon,
          type: contentType,
          world: contentType === "datapack" ? targetWorld || undefined : undefined,
        });
      } catch (err) {
        if (rest.length === 0) throw err;
        return tryInstall(rest);
      }
    };

    try {
      const result = await tryInstall(mod.sources.filter((entry) => entry.installable));

      setNotice(
        `Installed ${result.name} in ${result.folder}.` +
          (result.dependencies.length
            ? ` Also added what it needs: ${result.dependencies.join(", ")}.`
            : "")
      );

      await refresh();
      // A data pack sold as a mod lands with the mods, so show where it really went.
      setContentType(result.type);
      setTab("mods");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    setInstalling(null);
  }

  /* ---------------- render ---------------- */

  if (!instance) {
    return (
      <div style={{ flex: 1, padding: 30, color: "white" }}>
        <button className="sidebar-button" onClick={onBack}>
          ← Back
        </button>
        <p style={{ marginTop: 20, color: error ? "#fca5a5" : "#9ca3af" }}>
          {error ?? "Loading instance..."}
        </p>
      </div>
    );
  }

  const allItems = CONTENT_TABS.flatMap(({ type }) => content[type]);
  const installedIds = new Set(allItems.map((m) => m.projectId).filter(Boolean));
  const items = content[contentType];
  const currentTab = CONTENT_TABS.find(({ type }) => type === contentType) ?? CONTENT_TABS[0];
  const hasShaderMod = content.mod.some((m) => /iris|optifine/i.test(`${m.name} ${m.fileName}`));

  const contentTabs = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
      {CONTENT_TABS.map(({ type, label }) => (
        <button
          key={type}
          className="sidebar-button"
          onClick={() => setContentType(type)}
          style={{
            padding: "6px 12px",
            fontSize: 13,
            background: contentType === type ? "#6d28d9" : undefined,
          }}
        >
          {label} ({content[type].length})
        </button>
      ))}
    </div>
  );

  const loaderLabel =
    instance.loader === "vanilla"
      ? "Vanilla"
      : `${instance.loader} ${instance.loaderVersion}`;

  return (
    <div style={{ flex: 1, padding: 30, overflowY: "auto", color: "white" }}>
      <button
        className="sidebar-button"
        onClick={onBack}
        style={{ marginBottom: 20 }}
      >
        ← Library
      </button>

      <h1 style={{ color: "#c084fc", marginBottom: 6 }}>{instance.name}</h1>

      <p style={{ color: "#9ca3af", marginBottom: 4 }}>
        Minecraft {instance.version} • {loaderLabel} • {instance.ram} GB RAM
      </p>

      <p style={{ color: "#6b7280", fontSize: 12, marginBottom: 18 }}>
        {content.mod.length} mod{content.mod.length === 1 ? "" : "s"} •{" "}
        {content.resourcepack.length} resource pack{content.resourcepack.length === 1 ? "" : "s"} •{" "}
        {content.shader.length} shader{content.shader.length === 1 ? "" : "s"} •{" "}
        {content.datapack.length} data pack{content.datapack.length === 1 ? "" : "s"}
        {instance.lastPlayed
          ? ` • last played ${new Date(instance.lastPlayed).toLocaleString()}`
          : ""}
        <span data-testid="last-backup">
          {lastBackup
            ? ` • last backed up ${new Date(lastBackup).toLocaleString()}`
            : " • not backed up yet"}
        </span>
      </p>

      {!instance.installed && (
        <div
          style={{
            ...card,
            borderColor: "#b45309",
            background: "#2a1a05",
            color: "#fcd34d",
            marginBottom: 16,
          }}
        >
          This instance is not fully installed
          {instance.error ? `: ${instance.error}` : "."} Use Repair to finish it.
        </div>
      )}

      {progress && progress.stage !== "done" && (busy === "repair" || busy === "cloud" || (busy === "launch" && progress.stage === "java")) && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ color: "#d8b4fe", marginBottom: 8 }}>
            {progress.detail ?? progress.stage} ({progress.percent}%)
          </div>
          <div style={{ height: 6, background: "#333", borderRadius: 3 }}>
            <div
              style={{
                width: `${progress.percent}%`,
                height: "100%",
                background: "#7c3aed",
                borderRadius: 3,
                transition: "width .2s",
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            ...card,
            borderColor: "#ef4444",
            background: "#2a0d0d",
            color: "#fca5a5",
            marginBottom: 16,
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          style={{
            ...card,
            borderColor: "#166534",
            background: "#0d2a12",
            color: "#86efac",
            marginBottom: 16,
          }}
        >
          {notice}
        </div>
      )}

      {/* ACTIONS */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <button
          className="sidebar-button"
          style={{ background: "#7c3aed" }}
          disabled={busy === "launch" || instance.running}
          onClick={launch}
        >
          {instance.running
            ? "Running"
            : busy === "launch"
            ? "Launching..."
            : "Launch"}
        </button>

        {instance.running && (
          <button
            className="sidebar-button"
            style={{ background: "#7f1d1d" }}
            onClick={() => run("stop", () => window.instanceAPI.stop(instanceName))}
          >
            Stop
          </button>
        )}

        <button
          className="sidebar-button"
          onClick={() => setTab("mods")}
          style={{ opacity: tab === "mods" ? 1 : 0.6 }}
        >
          Content ({allItems.length})
        </button>

        <button
          className="sidebar-button"
          onClick={() => setTab("browse")}
          style={{ opacity: tab === "browse" ? 1 : 0.6 }}
        >
          Add Content
        </button>

        <button
          className="sidebar-button"
          onClick={() => setTab("worlds")}
          style={{ opacity: tab === "worlds" ? 1 : 0.6 }}
        >
          Worlds
        </button>

        <button
          className="sidebar-button"
          onClick={() => setTab("screenshots")}
          style={{ opacity: tab === "screenshots" ? 1 : 0.6 }}
        >
          Screenshots
        </button>

        <button
          className="sidebar-button"
          onClick={() => setTab("log")}
          style={{ opacity: tab === "log" ? 1 : 0.6 }}
        >
          Log
        </button>

        <button
          className="sidebar-button"
          onClick={() => setTab("settings")}
          style={{ opacity: tab === "settings" ? 1 : 0.6 }}
        >
          Settings
        </button>

        <button
          className="sidebar-button"
          onClick={() =>
            run("cloud", async () => {
              setProgress(null);
              const result = await window.instanceAPI.cloudExport(instanceName);
              setNotice(
                `Backed up ${result.files.toLocaleString()} files (${formatBytes(result.bytes)}) to your cloud folder. ` +
                "It reaches your other devices once your cloud service has synced it."
              );
              await loadLastBackup();
            })
          }
          disabled={busy === "cloud"}
        >
          {busy === "cloud" ? "Backing up..." : "Back up to cloud"}
        </button>

        <button
          className="sidebar-button"
          disabled={busy === "repair"}
          onClick={() =>
            run("repair", () => window.instanceAPI.repair(instanceName))
          }
        >
          {busy === "repair" ? "Repairing..." : "Repair"}
        </button>

      </div>

      {/* ---------------- CONTENT ---------------- */}
      {tab === "mods" && (
        <>
          <ModUpdatesPanel instanceName={instanceName} onUpdated={refresh} />

          {contentTabs}

          {items.length === 0 ? (
            <div style={{ ...card, color: "#9ca3af" }}>
              No {currentTab.label.toLowerCase()} yet. Use <b>Add Content</b> to find
              ones that work on Minecraft {instance.version}.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {items.map((item) => {
                const key = itemKey(item);

                return (
                  <div
                    key={key}
                    data-testid="content-item"
                    style={{
                      ...card,
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      opacity: item.enabled ? 1 : 0.55,
                      borderColor: item.enabled ? "#6d28d9" : "#3f3f46",
                    }}
                  >
                    {item.iconUrl && (
                      <img
                        src={item.iconUrl}
                        alt=""
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 8,
                          objectFit: "cover",
                          flexShrink: 0,
                        }}
                      />
                    )}

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "#c084fc", fontWeight: 600 }}>{item.name}</div>

                      <div style={{ fontSize: 12, color: "#888", wordBreak: "break-all" }}>
                        {item.fileName}
                      </div>

                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                        {item.kind === "folder" ? "Folder" : formatBytes(item.size)}
                        {item.type === "datapack"
                          ? ` • ${item.world ? `World: ${item.world}` : "Not in a world yet"}`
                          : ""}
                        {item.versionNumber ? ` • ${item.versionNumber}` : ""}
                        {item.source ? ` • ${item.source}` : ""}
                        {item.enabled ? "" : " • disabled"}
                      </div>
                    </div>

                    {item.type === "datapack" && !item.world && content.worlds.length > 0 && (
                      <button
                        className="sidebar-button"
                        disabled={busy === key}
                        onClick={() => addToWorld(item, targetWorld || content.worlds[0])}
                      >
                        Add to {targetWorld || content.worlds[0]}
                      </button>
                    )}

                    {item.kind === "file" && (
                      <button
                        className="sidebar-button"
                        disabled={busy === key}
                        onClick={() => toggleItem(item)}
                        style={{
                          minWidth: 100,
                          background: item.enabled ? "#6d28d9" : "#3f3f46",
                        }}
                      >
                        {busy === key ? "..." : item.enabled ? "Disable" : "Enable"}
                      </button>
                    )}

                    <button
                      className="sidebar-button"
                      disabled={busy === key}
                      onClick={() => deleteItem(item)}
                      style={{ background: "#7f1d1d" }}
                    >
                      Delete
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "worlds" && <InstanceWorlds instanceName={instanceName} />}

      {tab === "screenshots" && <InstanceScreenshots instanceName={instanceName} />}

      {tab === "log" && <InstanceLog instanceName={instanceName} />}

      {/* ---------------- SETTINGS ---------------- */}
      {tab === "settings" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 620 }}>
          <div style={card} data-testid="instance-files">
            <p style={{ color: "#d8b4fe", marginBottom: 10 }}>This instance</p>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
              <button
                className="sidebar-button"
                onClick={() => window.instanceAPI.openFolder(instanceName).catch((err) => setError(String(err)))}
              >
                Show Files
              </button>
              <span style={{ color: "#6b7280", fontSize: 12 }}>Opens its folder in {FILE_MANAGER}.</span>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                value={copyName ?? `${instance.name} (copy)`}
                onChange={(e) => setCopyName(e.target.value)}
                aria-label="Name for the copy"
                style={{
                  flex: "1 1 220px",
                  padding: 10,
                  borderRadius: 10,
                  background: "#1b1b1b",
                  color: "white",
                  border: "1px solid #6d28d9",
                }}
              />
              <button
                className="sidebar-button"
                disabled={busy === "duplicate" || instance.running}
                title={instance.running ? "Stop it first" : undefined}
                onClick={() =>
                  run("duplicate", async () => {
                    const copy = await window.instanceAPI.duplicate(instanceName, (copyName ?? `${instance.name} (copy)`).trim());
                    setCopyName(null);
                    setNotice(`Made a copy called "${copy.name}". It's in the Library.`);
                  })
                }
              >
                {busy === "duplicate" ? "Copying..." : "Duplicate"}
              </button>
            </div>
            <p style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}>
              A copy with the same mods, worlds and settings, under a new name. Logs and play history
              aren't copied.
            </p>
          </div>

          <div style={card} data-testid="instance-export">
            <p style={{ color: "#d8b4fe", marginBottom: 6 }}>Export as a modpack</p>
            <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 10 }}>
              Saves it as a Modrinth modpack (.mrpack) to share, which the Modrinth App, Prism and this
              launcher can install. Mods on Modrinth are linked, so it stays small; others, and its
              config, go inside it. Disabled mods are left out.
            </p>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ color: "#d4d4d8", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={exportWorlds} onChange={(e) => setExportWorlds(e.target.checked)} />
                Include worlds
              </label>
              <label style={{ color: "#d4d4d8", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={exportOptions} onChange={(e) => setExportOptions(e.target.checked)} />
                Include game settings (options.txt)
              </label>
              <button
                className="sidebar-button"
                style={{ marginLeft: "auto" }}
                disabled={busy === "export"}
                onClick={() =>
                  run("export", async () => {
                    const done = await window.instanceAPI.exportModpack(instanceName, { worlds: exportWorlds, options: exportOptions });
                    if (!done) return;
                    setNotice(
                      `Saved ${done.file.split(/[\\/]/).pop()} (${formatBytes(done.bytes)}): ${done.linked} linked from Modrinth` +
                        (done.included.length ? `, ${done.included.length} packed in` : "") +
                        (done.configFiles ? `, plus ${done.configFiles} config file${done.configFiles === 1 ? "" : "s"}` : "") +
                        "."
                    );
                  })
                }
              >
                {busy === "export" ? "Exporting..." : "Export..."}
              </button>
            </div>
          </div>

          <div style={card} data-testid="instance-java">
            <p style={{ color: "#d8b4fe", marginBottom: 6 }}>Java</p>
            <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 12 }}>
              {instance.javaPath
                ? `Uses its own Java: ${instance.javaPath}`
                : globalJava
                  ? `Uses the Java chosen in Settings for every instance: ${globalJava}`
                  : javaInfo
                    ? `Automatic: Java ${javaInfo.majorVersion}, which Minecraft ${instance.version} needs${javaInfo.downloaded ? "." : ". It's downloaded the first time this launches."}`
                    : "Automatic: the Java this version needs, downloaded the first time it launches."}
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="sidebar-button"
                disabled={busy === "java"}
                onClick={() =>
                  run("java", async () => {
                    const picked = await window.instanceAPI.pickInstanceJava(instanceName);
                    if (picked) setNotice(`${instance.name} now uses ${picked}.`);
                  })
                }
              >
                Choose a Java...
              </button>
              {instance.javaPath && (
                <button
                  className="sidebar-button"
                  disabled={busy === "java"}
                  onClick={() =>
                    run("java", async () => {
                      await window.instanceAPI.update(instanceName, { javaPath: "" });
                      setNotice("Back to automatic Java.");
                    })
                  }
                >
                  Use Automatic
                </button>
              )}
            </div>
          </div>

          <div style={card}>
            <p style={{ color: "#d8b4fe", marginBottom: 6 }}>
              Allocated RAM: {ramDraft ?? instance.ram} GB
            </p>

            <p style={{ color: "#6b7280", fontSize: 12, marginBottom: 12 }}>
              {system
                ? `This machine has ${system.totalRamGb} GB; allocating more than ` +
                  `${system.maxRecommendedGb} GB leaves too little for the system.`
                : "Applied to this instance the next time it launches."}
            </p>

            <input
              type="range"
              min={1}
              max={system?.totalRamGb ?? 32}
              step={1}
              value={ramDraft ?? instance.ram}
              onChange={(e) => setRamDraft(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#7c3aed" }}
            />

            {system && (ramDraft ?? instance.ram) > system.maxRecommendedGb && (
              <p style={{ color: "#fcd34d", fontSize: 12, marginTop: 8 }}>
                Above the recommended maximum for this machine.
              </p>
            )}
          </div>

          <div style={card}>
            <p style={{ color: "#d8b4fe", marginBottom: 10 }}>
              JVM arguments for this instance
            </p>

            <input
              value={jvmDraft ?? ""}
              onChange={(e) => setJvmDraft(e.target.value)}
              placeholder="Leave blank to use the launcher default"
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 10,
                background: "#1b1b1b",
                color: "white",
                border: "1px solid #6d28d9",
                boxSizing: "border-box",
              }}
            />

            <p style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}>
              Added before Minecraft's own arguments, e.g.
              <code style={{ color: "#c084fc" }}> -XX:+UseG1GC</code>
            </p>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="sidebar-button"
              style={{ background: "#7c3aed" }}
              disabled={busy === "save"}
              onClick={() =>
                run("save", async () => {
                  await window.instanceAPI.update(instanceName, {
                    ram: ramDraft ?? instance.ram,
                    jvmArgs: jvmDraft ?? "",
                  });

                  setNotice("Settings saved — they apply on the next launch.");
                })
              }
            >
              {busy === "save" ? "Saving..." : "Save Settings"}
            </button>

            <button
              className="sidebar-button"
              onClick={() => {
                setRamDraft(instance.ram);
                setJvmDraft(instance.jvmArgs ?? "");
              }}
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {/* ---------------- BROWSE ---------------- */}
      {tab === "browse" && (
        <>
          {contentTabs}

          <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 10 }}>
            Showing only {currentTab.label.toLowerCase()} that work on Minecraft{" "}
            {instance.version}
            {contentType === "mod" ? ` with ${loaderLabel}` : ""}. Anything they
            require installs automatically.
          </p>

          {contentType === "shader" && !hasShaderMod && (
            <div
              style={{
                ...card,
                borderColor: "#b45309",
                background: "#2a1a05",
                color: "#fcd34d",
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              Shaders need a mod to run them, such as Iris. This instance doesn't appear to have one.
            </div>
          )}

          {contentType === "datapack" && (
            <label style={{ display: "block", color: "#9ca3af", fontSize: 13, marginBottom: 10 }}>
              Install data packs into{" "}
              <select
                aria-label="World to install into"
                value={targetWorld}
                onChange={(e) => setInstallWorld(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: "#1b1b1b",
                  color: "white",
                  border: "1px solid #6d28d9",
                }}
              >
                {content.worlds.map((world) => (
                  <option key={world} value={world}>
                    {world}
                  </option>
                ))}
                <option value="">No world yet (keep for later)</option>
              </select>
            </label>
          )}

          <button
            className="sidebar-button"
            data-testid="github-toggle"
            onClick={() => setShowGitHub((shown) => !shown)}
            style={{ padding: "6px 12px", fontSize: 12, marginBottom: 10 }}
          >
            {showGitHub ? "Hide GitHub" : "Install from GitHub"}
          </button>

          {showGitHub && (
            <GitHubInstall
              instanceName={instanceName}
              contentType={contentType}
              world={contentType === "datapack" ? targetWorld || undefined : undefined}
              onInstalled={async (result) => {
                setNotice(`Installed ${result.name} from GitHub, in ${result.folder}.`);
                await refresh();
                setContentType(result.type);
                setTab("mods");
              }}
            />
          )}

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${currentTab.label.toLowerCase()} on Modrinth and CurseForge...`}
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 10,
              background: "#1b1b1b",
              color: "white",
              border: "1px solid #6d28d9",
              boxSizing: "border-box",
              marginBottom: 12,
            }}
          />

          <div ref={browseTop} />

          {browsed && !cantUseThisType && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              <div data-testid="page-summary" style={{ fontSize: 12, color: "#9ca3af" }}>
                {browsed.totals.modrinth.toLocaleString()} on Modrinth •{" "}
                {browsed.totals.curseforge.toLocaleString()}
                {browsed.totals.curseforgeCapped ? "+" : ""} on CurseForge • Page {browsed.page.toLocaleString()} of{" "}
                {browsed.pageCount.toLocaleString()}
              </div>
              <Pagination
                page={browsed.page}
                pageCount={browsed.pageCount}
                disabled={searching}
                onChange={(page) => setChosenPage({ browseKey, page })}
              />
              {browsed.totals.curseforgeCapped && (
                <div data-testid="curseforge-limit" style={{ fontSize: 11, color: "#6b7280" }}>
                  CurseForge only lets apps reach the first 10,000 results of a search. Search to get to the rest.
                </div>
              )}
            </div>
          )}

          {warnings.map((w, i) => (
            <div
              key={i}
              style={{
                ...card,
                borderColor: "#b45309",
                background: "#2a1a05",
                color: "#fcd34d",
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {w}
            </div>
          ))}

          {cantUseThisType ? (
            <div style={{ ...card, color: "#9ca3af" }}>
              Vanilla can't load mods. Create an instance with a mod loader to use them.
            </div>
          ) : searching ? (
            <div style={{ color: "#9ca3af" }}>Searching...</div>
          ) : results.length === 0 ? (
            <div style={{ ...card, color: "#9ca3af" }}>
              No {currentTab.label.toLowerCase()} found for Minecraft {instance.version}
              {contentType === "mod" ? ` on ${loaderLabel}` : ""}.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {results.map((mod) => {
                const already = mod.sources.some((entry) => installedIds.has(entry.id));
                const canInstall = mod.sources.some((entry) => entry.installable);

                return (
                  <div
                    key={`${mod.source}-${mod.id}`}
                    data-testid="browse-result"
                    style={{ ...card, display: "flex", gap: 14, alignItems: "center" }}
                  >
                    {mod.icon && (
                      <img
                        src={mod.icon}
                        alt=""
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 8,
                          objectFit: "cover",
                          flexShrink: 0,
                        }}
                      />
                    )}

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "#c084fc", fontWeight: 600 }}>
                        {mod.name}
                      </div>

                      <div style={{ fontSize: 12, color: "#aaa" }}>
                        {mod.summary?.slice(0, 140)}
                      </div>

                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                        {mod.author ? `${mod.author} • ` : ""}
                        <SourceDownloads sources={mod.sources} />
                      </div>
                    </div>

                    {already ? (
                      <button className="sidebar-button" disabled style={{ minWidth: 100 }}>
                        Installed
                      </button>
                    ) : canInstall ? (
                      <button
                        className="sidebar-button"
                        disabled={installing === mod.id}
                        onClick={() => install(mod)}
                        style={{ minWidth: 100, background: "#7c3aed" }}
                      >
                        {installing === mod.id ? "..." : "Install"}
                      </button>
                    ) : (
                      <button
                        className="sidebar-button"
                        style={{ minWidth: 100 }}
                        title="This author disabled third-party downloads"
                        onClick={() =>
                          mod.url && window.modAPI.openUrl(mod.url).catch(() => {})
                        }
                      >
                        Open Site
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
