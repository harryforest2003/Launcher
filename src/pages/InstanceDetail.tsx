import { useCallback, useEffect, useRef, useState } from "react";
import GitHubInstall from "../components/GitHubInstall";
import InstanceLog from "../components/InstanceLog";
import { dependencyNote } from "../utils/dependencyNote";
import InstanceContentList from "../components/InstanceContentList";
import { useContentUpdates } from "../components/useContentUpdates";
import LoaderUpdate from "../components/LoaderUpdate";
import ModpackUpdate from "../components/ModpackUpdate";
import ShareCodeBox from "../components/ShareCodeBox";
import InstanceScreenshots from "../components/InstanceScreenshots";
import InstanceWorlds from "../components/InstanceWorlds";
import { GameWindowCard, LaunchCommandsCard } from "../components/InstanceLaunchSettings";
import { hooksDraftOf, hooksError, hooksFromDraft, windowDraftOf, windowFromDraft, windowSizeError, type HooksDraft, type WindowDraft } from "../utils/launchSettings";
import Pagination from "../components/Pagination";
import SourceDownloads from "../components/SourceDownloads";
import { Cloud, Folder, Gauge, Hammer, Play, Settings, Square } from "lucide-react";
import OptimisePanel from "../components/OptimisePanel";
import { Badge, Segmented, Tabs } from "../components/ui";
import InstanceArt from "../components/InstanceArt";
import { InstancePictureCard } from "../components/InstancePicture";
import ModDescription from "./ModDescription";
import "./library.css";
import { AccountClashNotice, PlayAsMenu } from "../components/PlayAs";
import { useAccountChoice } from "../components/playAsChoice";

const LOADER_NAMES: Record<string, string> = { fabric: "Fabric Loader", quilt: "Quilt Loader", forge: "Forge", neoforge: "NeoForge" };

type Props = {
  instanceName: string;
  onBack: () => void;
};

type Tab = "mods" | "browse" | "worlds" | "screenshots" | "log" | "settings";

type ProjectSource = "modrinth" | "curseforge";

// Clicks on a row's own controls do their own thing, not open the project's page.
const fromControl = (event: React.MouseEvent) => Boolean((event.target as Element).closest("button, input, label, a, select"));

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
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
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
  // Project pages opened from this instance, the last one showing; kept per instance.
  const [trail, setTrail] = useState<{ instance: string; pages: { source: ProjectSource; id: string }[] }>({ instance: instanceName, pages: [] });
  const pages = trail.instance === instanceName ? trail.pages : [];
  const openProject = useCallback(
    (source: ProjectSource, id: string) =>
      setTrail((current) => ({ instance: instanceName, pages: [...(current.instance === instanceName ? current.pages : []), { source, id }] })),
    [instanceName]
  );
  const closeProject = () => setTrail({ instance: instanceName, pages: pages.slice(0, -1) });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Who the game plays as; an account already in another game is offered the free ones.
  const choice = useAccountChoice();

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

  // Checked for updates as soon as the page opens, like the Modrinth app.
  const updates = useContentUpdates(instanceName, content, refresh);

  /* ---------------- repair progress ---------------- */

  const [progress, setProgress] = useState<InstallProgress | null>(null);
  // The Optimise panel is open.
  const [optimising, setOptimising] = useState(false);
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
  const [windowDraft, setWindowDraft] = useState<WindowDraft | null>(null);
  const [hooksDraft, setHooksDraft] = useState<HooksDraft | null>(null);
  // The game window in Settings, which instances without their own follow.
  const [globalWindow, setGlobalWindow] = useState<GameWindow | null>(null);
  // What an exported modpack includes beyond mods and config.
  const [exportWorlds, setExportWorlds] = useState(false);
  const [exportOptions, setExportOptions] = useState(false);
  const [shareCode, setShareCode] = useState<{ for: string; code: string; linked: number; missing: string[] } | null>(null);
  const [exportFormat, setExportFormat] = useState<"modrinth" | "curseforge">("modrinth");
  // The name typed for a copy, or null for the suggested one.
  const [copyName, setCopyName] = useState<string | null>(null);
  const [system, setSystem] = useState<LauncherSettings["system"] | null>(null);
  // The Java chosen in Settings for every instance, if any, and what automatic would use here.
  const [globalJava, setGlobalJava] = useState("");
  const [globalTuning, setGlobalTuning] = useState<JavaTuning>("performance");
  const [globalJvmArgs, setGlobalJvmArgs] = useState("");
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
        setGlobalTuning(s.javaTuning ?? "performance");
        setGlobalJvmArgs(s.jvmArgs ?? "");
        setGlobalWindow({ width: s.windowWidth ?? null, height: s.windowHeight ?? null, fullscreen: Boolean(s.fullscreen) });
      })
      .catch(() => setSystem(null));
  }, []);

  // Seed the drafts once the instance loads.
  useEffect(() => {
    if (!instance) return;

    setRamDraft((current) => (current === null ? instance.ram : current));
    setJvmDraft((current) => (current === null ? (instance.jvmArgs ?? "") : current));
    setWindowDraft((current) => current ?? windowDraftOf(instance.window));
    setHooksDraft((current) => current ?? hooksDraftOf(instance.launchHooks));
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

  // Why the settings can't be saved as typed, if they can't.
  const draftProblem =
    (windowDraft?.own && !windowDraft.fullscreen ? windowSizeError(windowDraft.width, windowDraft.height) : null) ?? (hooksDraft ? hooksError(hooksDraft) : null);

  // The -XX: flags typed for this instance (or in Settings, if it has none): they override the sets.
  const ownFlags = (instance?.jvmArgs || globalJvmArgs).split(/\s+/).filter((arg) => arg.startsWith("-XX:"));

  /* Picks a Java flags set ("settings" follows Settings). The main process removes the -XX:
     flags typed for this instance with it, or they'd override the set. */
  function pickTuning(value: JavaTuning | "settings") {
    if (!instance) return;
    const before = instance.jvmArgs ?? "";
    void run("java", async () => {
      const updated = await window.instanceAPI.update(instanceName, { javaTuning: value === "settings" ? "" : value });
      const cleared = (updated.jvmArgs ?? "") !== before;
      if (cleared) setJvmDraft(updated.jvmArgs ?? "");
      const set = value === "settings" ? "the Java flags in Settings" : `the ${value === "performance" ? "Performance" : "Standard"} Java flags`;
      setNotice(`${instance.name} uses ${set} from its next launch.${cleared ? " The -XX: flags in its JVM arguments were removed so they don't override them." : ""}`);
    });
  }

  // Where the latest Play was headed, so picking another account after a clash goes there too.
  const quickPlayRef = useRef<QuickPlay | undefined>(undefined);

  /* Starts it alongside any other open games: as accountId, or the active account, opening a world or server if given. */
  async function launch(accountId?: string, quickPlay?: QuickPlay) {
    quickPlayRef.current = quickPlay;
    if (!choice.check(instanceName, accountId)) return;
    setBusy("launch");
    setError(null);
    setNotice(null);

    try {
      setProgress(null);
      setTab("log");
      const result = await window.instanceAPI.launch(instanceName, accountId, quickPlay ? { quickPlay } : undefined);

      setNotice(
        result.online
          ? `Launched as ${result.playerName}.`
          : `Launched in offline mode as ${result.playerName} — sign in on the ` +
            `Minecraft screen to play online.`
      );

      await refresh();
    } catch (err) {
      if (!(await choice.explain(instanceName, accountId))) setError(err instanceof Error ? err.message : String(err));
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
  // What installing each result added, shown on its card.
  const [added, setAdded] = useState<Record<string, string>>({});

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

      // Stays on Add Content: the result says it's installed, and what else came with it.
      const note = `Installed in ${result.folder}. ${dependencyNote(result)}`.trim();
      setAdded((current) => ({ ...current, [mod.id]: note }));

      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    setInstalling(null);
  }

  /* ---------------- render ---------------- */

  if (!instance) {
    return (
      <div style={{ flex: 1, padding: 30, color: "var(--color-text)", position: "relative" }}>
        <button className="sidebar-button" onClick={onBack}>
          ← Back
        </button>
        <p style={{ marginTop: 20, color: error ? "var(--color-danger-text)" : "var(--color-text-muted)" }}>
          {error ?? "Loading instance..."}
        </p>
      </div>
    );
  }

  const allItems = CONTENT_TABS.flatMap(({ type }) => content[type]);
  const installedIds = new Set(allItems.map((m) => m.projectId).filter(Boolean));
  const currentTab = CONTENT_TABS.find(({ type }) => type === contentType) ?? CONTENT_TABS[0];
  const hasShaderMod = content.mod.some((m) => /iris|optifine/i.test(`${m.name} ${m.fileName}`));

  // What kind of content Add Content searches for.
  const contentTabs = () => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
      {CONTENT_TABS.map(({ type, label }) => (
        <button
          key={type}
          className="sidebar-button"
          onClick={() => setContentType(type)}
          style={{
            padding: "6px 12px",
            fontSize: 13,
            background: contentType === type ? "var(--color-accent-subtle)" : undefined,
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
      : `${LOADER_NAMES[instance.loader] ?? instance.loader} ${instance.loaderVersion}`;

  const page = pages[pages.length - 1];

  return (
    <>
    {page && (
      <div key={`${page.source}/${page.id}/${pages.length}`} style={{ flex: 1, minWidth: 0, padding: 30, overflowY: "auto", color: "var(--color-text)", position: "relative" }}>
        <ModDescription
          embedded
          backLabel={pages.length > 1 ? "Back" : `Back to ${instance.name}`}
          source={page.source}
          projectId={page.id}
          openProject={openProject}
          onBack={closeProject}
          instanceName={instanceName}
          onInstalled={(name) => name === instanceName && refresh()}
        />
      </div>
    )}
    {/* Kept, hidden, under a project page, so the search and tab are as they were on the way back. */}
    <div style={{ flex: 1, minWidth: 0, padding: 30, overflowY: "auto", color: "var(--color-text)", position: "relative", display: page ? "none" : undefined }}>
      <div className="id-hero">
        <InstanceArt name={instance.name} cols={8} rows={8} />
        <div className="id-hero-text">
          <h1 className="id-title">{instance.name}</h1>
          <div className="id-meta">
            <Badge tone="accent">Minecraft {instance.version}</Badge>
            <Badge>{loaderLabel}</Badge>
            {instance.loader !== "vanilla" && instance.installed && (
              <LoaderUpdate
                instanceName={instance.name}
                loaderVersion={instance.loaderVersion}
                onDone={(result) => {
                  setTab("mods");
                  void updates.finish(result);
                }}
              />
            )}
            {instance.modpack && instance.installed && (
              <ModpackUpdate instance={instance} busy={busy === "modpack"} run={run} onNotice={setNotice} />
            )}
            <Badge>{instance.ram} GB RAM</Badge>
            <span className="id-meta-played">{instance.lastPlayed ? `Played ${new Date(instance.lastPlayed).toLocaleDateString()}` : "Not played yet"}</span>
          </div>
        </div>
        <div className="id-actions">
          <button
            className="ui-button ui-button--ghost ui-button--sm"
            aria-label="Open folder"
            data-tip="Open this instance's folder"
            onClick={() => window.instanceAPI.openFolder(instanceName).catch(() => {})}
          >
            <Folder size={16} aria-hidden="true" />
            Folder
          </button>

          <button
            className="ui-button ui-button--ghost ui-button--sm"
            aria-label="Repair"
            data-tip={busy === "repair" ? "Repairing..." : "Repair: download anything this instance is missing, and fix broken files"}
            aria-disabled={busy === "repair" || undefined}
            onClick={() => busy !== "repair" && run("repair", () => window.instanceAPI.repair(instanceName))}
          >
            <Hammer size={16} aria-hidden="true" />
            Repair
          </button>

          <button
            className="ui-button ui-button--ghost ui-button--sm"
            aria-label="Back up to cloud"
            data-tip={busy === "cloud" ? "Backing up..." : "Back up this instance to your cloud folder"}
            aria-disabled={busy === "cloud" || undefined}
            onClick={() =>
            busy !== "cloud" &&
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
          >
            <Cloud size={16} aria-hidden="true" />
            Back up
          </button>

          <button
            className="ui-button ui-button--ghost ui-button--sm"
            data-testid="optimise"
            aria-label="Optimise"
            data-tip="Optimise: find what's slowing this instance down, and fix it"
            onClick={() => setOptimising(true)}
          >
            <Gauge size={16} aria-hidden="true" />
            Optimise
          </button>

          {instance.running && (
            <button className="ui-button ui-button--danger" onClick={() => run("stop", () => window.instanceAPI.stop(instanceName))}>
              <Square size={14} fill="currentColor" aria-hidden="true" />
              Stop
            </button>
          )}

          <button
            className="ui-button ui-button--primary ui-button--lg"
            data-testid="play"
            disabled={busy === "launch" || instance.running}
            onClick={() => launch()}
          >
            <Play size={16} fill="currentColor" aria-hidden="true" />
            {instance.running ? (instance.playingAs ? `Running as ${instance.playingAs.name}` : "Running") : busy === "launch" ? "Starting..." : "Play"}
          </button>
          {!instance.running && busy !== "launch" && <PlayAsMenu choice={choice} instance={instanceName} onPlayAs={(id) => launch(id)} />}

          <button
            className="ui-button ui-button--ghost ui-button--icon"
            aria-label="Settings"
            title="This instance's settings"
            aria-pressed={tab === "settings"}
            onClick={() => setTab("settings")}
          >
            <Settings size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <p className="id-facts">
        {content.mod.length} mod{content.mod.length === 1 ? "" : "s"} •{" "}
        {content.resourcepack.length} resource pack{content.resourcepack.length === 1 ? "" : "s"} •{" "}
        {content.shader.length} shader{content.shader.length === 1 ? "" : "s"} •{" "}
        {content.datapack.length} data pack{content.datapack.length === 1 ? "" : "s"}
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
            borderColor: "var(--color-warning-border)",
            background: "var(--color-warning-bg)",
            color: "var(--color-warning-text)",
            marginBottom: 16,
          }}
        >
          This instance is not fully installed
          {instance.error ? `: ${instance.error}` : "."} Use Repair to finish it.
        </div>
      )}

      {progress && progress.stage !== "done" && (busy === "repair" || busy === "cloud" || busy === "modpack" || (busy === "launch" && progress.stage === "java")) && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ color: "var(--color-accent-text)", marginBottom: 8 }}>
            {progress.detail ?? progress.stage} ({progress.percent}%)
          </div>
          <div style={{ height: 6, background: "var(--color-surface-raised)", borderRadius: 3 }}>
            <div
              style={{
                width: `${progress.percent}%`,
                height: "100%",
                background: "var(--color-accent)", color: "var(--color-on-accent)",
                borderRadius: 3,
                transition: "width .2s",
              }}
            />
          </div>
        </div>
      )}

      <AccountClashNotice choice={choice} instance={instanceName} className="play-as__clash--spaced" onPlayAs={(id) => launch(id, quickPlayRef.current)} />

      {error && (
        <div
          style={{
            ...card,
            borderColor: "var(--color-danger-border)",
            background: "var(--color-danger-bg)",
            color: "var(--color-danger-text)",
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
            borderColor: "var(--color-success-border)",
            background: "var(--color-success-bg)",
            color: "var(--color-success-text)",
            marginBottom: 16,
          }}
        >
          {notice}
        </div>
      )}

      {optimising && (
        <OptimisePanel
          instanceName={instanceName}
          onChanged={() => {
            refresh();
            updates.recheck();
          }}
          onClose={() => setOptimising(false)}
        />
      )}

      {/* One line: the tabs on the left, the instance's own buttons on the right */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        {/* The tabs share the space left of the instance's buttons equally. */}
        <div style={{ flex: "1 1 360px", minWidth: 0 }}>
          <Tabs
            label="Instance"
            idBase="instance"
            value={tab === "browse" ? "mods" : tab}
            onChange={(id) => setTab(id)}
            tabs={[
              { value: "mods", label: "Content", count: allItems.length },
              { value: "worlds", label: "Worlds" },
              { value: "screenshots", label: "Screenshots" },
              { value: "log", label: "Log" },
            ]}
          />
        </div>

      </div>

      {/* ---------------- CONTENT ---------------- */}
      {tab === "mods" && (
        <InstanceContentList
          instanceName={instanceName}
          mcVersion={instance.version}
          content={content}
          updates={updates}
          busyKey={busy}
          targetWorld={targetWorld}
          onToggle={toggleItem}
          onDelete={deleteItem}
          onAddToWorld={addToWorld}
          onAddContent={() => setTab("browse")}
          onOpenProject={openProject}
        />
      )}

      {tab === "worlds" && (
        <InstanceWorlds
          instanceName={instanceName}
          mcVersion={instance.version}
          running={Boolean(instance.running) || busy === "launch"}
          onPlay={(quickPlay) => launch(undefined, quickPlay)}
          backupBeforeUpdates={Boolean(instance.backupWorldsBeforeUpdates)}
          onBackupBeforeUpdates={(on) => run("backups", () => window.instanceAPI.update(instanceName, { backupWorldsBeforeUpdates: on }))}
        />
      )}

      {tab === "screenshots" && <InstanceScreenshots instanceName={instanceName} />}

      {tab === "log" && (
        <InstanceLog
          instanceName={instanceName}
          onRepair={() => run("repair", () => window.instanceAPI.repair(instanceName))}
          onOpenTab={setTab}
        />
      )}

      {/* ---------------- SETTINGS ---------------- */}
      {tab === "settings" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 620 }}>
          <InstancePictureCard instanceName={instanceName} onError={setError} />

          <div style={card} data-testid="instance-files">
            <p style={{ color: "var(--color-accent-text)", marginBottom: 10 }}>This instance</p>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
              <button
                className="sidebar-button"
                onClick={() => window.instanceAPI.openFolder(instanceName).catch((err) => setError(String(err)))}
              >
                Show Files
              </button>
              <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>Opens its folder in {FILE_MANAGER}.</span>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
              <button
                className="sidebar-button"
                data-testid="desktop-shortcut"
                onClick={() =>
                  window.instanceAPI
                    .desktopShortcut(instanceName)
                    .then((made) => setNotice(made.replaced ? "Replaced its desktop shortcut." : "Added a shortcut to your desktop. Opening it plays this instance."))
                    .catch((err) => setError(String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")))
                }
              >
                Add to desktop
              </button>
              <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>A shortcut that starts the launcher and plays it.</span>
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
                  background: "var(--color-surface-sunken)",
                  color: "var(--color-text)",
                  border: "1px solid var(--color-border)",
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
            <p style={{ color: "var(--color-text-muted)", fontSize: 12, marginTop: 8 }}>
              A copy with the same mods, worlds and settings, under a new name. Logs and play history
              aren't copied.
            </p>
          </div>

          <div style={card} data-testid="instance-export">
            <p style={{ color: "var(--color-accent-text)", marginBottom: 6 }}>Export as a modpack</p>
            <div style={{ marginBottom: 8 }} data-testid="export-format">
              <Segmented
                label="Modpack format"
                value={exportFormat}
                onChange={setExportFormat}
                options={[
                  { value: "modrinth", label: "Modrinth (.mrpack)" },
                  { value: "curseforge", label: "CurseForge (.zip)" },
                ]}
              />
            </div>
            <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 10 }}>
              {exportFormat === "modrinth"
                ? "Saves it as a Modrinth modpack (.mrpack) to share, which the Modrinth App, Prism and this launcher can install. Mods on Modrinth are linked, so it stays small; others, and its config, go inside it."
                : "Saves it as a CurseForge modpack (.zip), which the CurseForge app, Prism and this launcher can install. Mods on CurseForge are linked; others, and its config, go inside it."}{" "}
              Disabled mods are left out.
            </p>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ color: "var(--color-text-secondary)", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={exportWorlds} onChange={(e) => setExportWorlds(e.target.checked)} />
                Include worlds
              </label>
              <label style={{ color: "var(--color-text-secondary)", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={exportOptions} onChange={(e) => setExportOptions(e.target.checked)} />
                Include game settings (options.txt)
              </label>
              <button
                className="sidebar-button"
                style={{ marginLeft: "auto" }}
                disabled={busy === "export"}
                onClick={() =>
                  run("export", async () => {
                    const settings = { worlds: exportWorlds, options: exportOptions };
                    const done =
                      exportFormat === "curseforge"
                        ? await window.instanceAPI.exportCurseForge(instanceName, settings)
                        : await window.instanceAPI.exportModpack(instanceName, settings);
                    if (!done) return;
                    setNotice(
                      `Saved ${done.file.split(/[\\/]/).pop()} (${formatBytes(done.bytes)}): ${done.linked} linked from ${exportFormat === "curseforge" ? "CurseForge" : "Modrinth"}` +
                        (done.included.length ? `, ${done.included.length} packed in` : "") +
                        (done.configFiles ? `, plus ${done.configFiles} config file${done.configFiles === 1 ? "" : "s"}` : "") +
                        "." +
                        ("partial" in done && done.partial ? " CurseForge's file lookup wasn't reachable, so only mods installed from CurseForge could be linked." : "")
                    );
                  })
                }
              >
                {busy === "export" ? "Exporting..." : "Export..."}
              </button>
            </div>
          </div>

          <div style={card} data-testid="instance-share">
            <p style={{ color: "var(--color-accent-text)", marginBottom: 6 }}>Share code</p>
            <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 10 }}>
              A line of text to paste to a friend. Pasting it into Import, under From a share code, makes the same instance and
              downloads its mods, resource packs and shaders from Modrinth and CurseForge. No file to send, and nothing is uploaded.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                className="sidebar-button"
                data-testid="make-share-code"
                disabled={busy === "share"}
                onClick={() =>
                  run("share", async () => setShareCode({ for: instanceName, ...(await window.instanceAPI.shareCode(instanceName)) }))
                }
              >
                {busy === "share" ? "Making..." : shareCode?.for === instanceName ? "Make again" : "Make share code"}
              </button>
            </div>
            {shareCode?.for === instanceName && (
              <ShareCodeBox
                code={shareCode.code}
                note={
                  `${shareCode.linked} file${shareCode.linked === 1 ? "" : "s"} linked.` +
                  (shareCode.missing.length ? ` Not on Modrinth or CurseForge, so send these yourself: ${shareCode.missing.join(", ")}.` : "") +
                  " Config and worlds aren't included."
                }
              />
            )}
          </div>

          {instance.loader !== "vanilla" && (
            <div style={card} data-testid="instance-server-pack">
              <p style={{ color: "var(--color-accent-text)", marginBottom: 6 }}>Server pack</p>
              <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 10 }}>
                A .zip to run this instance as a server: its mods (client-only ones like minimaps and
                shaders left out), config, the {loaderLabel} server installer, and start scripts for
                macOS, Linux and Windows.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  className="sidebar-button"
                  data-testid="export-server-pack"
                  disabled={busy === "server-pack"}
                  onClick={() =>
                    run("server-pack", async () => {
                      const done = await window.instanceAPI.exportServerPack(instanceName);
                      if (!done) return;
                      setNotice(
                        `Saved ${done.file.split(/[\\/]/).pop()} (${formatBytes(done.bytes)}) with ${done.mods} mod${done.mods === 1 ? "" : "s"}` +
                          (done.skipped.length ? `. Left out as client-only: ${done.skipped.join(", ")}` : "") +
                          ". Its README says how to start it."
                      );
                    })
                  }
                >
                  {busy === "server-pack" ? "Exporting..." : "Export server pack..."}
                </button>
              </div>
            </div>
          )}

          <div style={card} data-testid="instance-java">
            <p style={{ color: "var(--color-accent-text)", marginBottom: 6 }}>Java</p>
            <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 12 }}>
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
            <p style={{ color: "var(--color-text-muted)", fontSize: 13, margin: "14px 0 8px" }} id="instance-java-flags">
              Java flags: {(instance.javaTuning || globalTuning) === "performance"
                ? "Performance. The Minecraft Launcher's settings, plus no freezes when a mod asks Java to clean up and room for more compiled code. Picture quality doesn't change."
                : "Standard, the Minecraft Launcher's own settings."}
            </p>
            {ownFlags.length > 0 && (
              <p
                role="note"
                style={{
                  fontSize: 12,
                  margin: "0 0 10px",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--color-warning-border)",
                  background: "var(--color-warning-bg)",
                  color: "var(--color-warning-text)",
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                {instance.jvmArgs
                  ? `This instance's JVM arguments below set ${ownFlags.length} Java flag${ownFlags.length === 1 ? "" : "s"} of their own (-XX:), so these sets aren't used. `
                  : `The Java arguments in Settings set ${ownFlags.length} Java flag${ownFlags.length === 1 ? "" : "s"} of their own (-XX:), so these sets aren't used. Pick a set in Settings to remove them.`}
                {instance.jvmArgs && (
                  <button className="sidebar-button" disabled={busy === "java"} onClick={() => pickTuning(instance.javaTuning || "settings")}>
                    Remove them
                  </button>
                )}
              </p>
            )}
            <Segmented
              label="Java flags for this instance"
              value={instance.javaTuning || "settings"}
              onChange={(value) => pickTuning(value)}
              options={[
                { value: "settings", label: `As in Settings (${globalTuning === "performance" ? "Performance" : "Standard"})` },
                { value: "performance", label: "Performance" },
                { value: "standard", label: "Standard" },
              ]}
            />
          </div>

          {windowDraft && <GameWindowCard draft={windowDraft} onChange={setWindowDraft} settings={globalWindow} />}

          <div style={card}>
            <p style={{ color: "var(--color-accent-text)", marginBottom: 6 }}>
              Allocated RAM: {ramDraft ?? instance.ram} GB
            </p>

            <p style={{ color: "var(--color-text-muted)", fontSize: 12, marginBottom: 12 }}>
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
              style={{ width: "100%", accentColor: "var(--color-accent)" }}
            />

            {system && (ramDraft ?? instance.ram) > system.maxRecommendedGb && (
              <p style={{ color: "var(--color-warning-text)", fontSize: 12, marginTop: 8 }}>
                Above the recommended maximum for this machine.
              </p>
            )}
          </div>

          <div style={card}>
            <p style={{ color: "var(--color-accent-text)", marginBottom: 4 }}>
              JVM arguments for this instance
            </p>
            <p style={{ color: "var(--color-text-muted)", fontSize: 12, marginBottom: 10 }}>
              Added after the Java flags above, so yours win. Choose a garbage collector here (such as -XX:+UseZGC) to use it instead of either.
            </p>

            <input
              value={jvmDraft ?? ""}
              onChange={(e) => setJvmDraft(e.target.value)}
              placeholder="Leave blank to use the launcher default"
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 10,
                background: "var(--color-surface-sunken)",
                color: "var(--color-text)",
                border: "1px solid var(--color-border)",
                boxSizing: "border-box",
              }}
            />

            <p style={{ color: "var(--color-text-muted)", fontSize: 12, marginTop: 8 }}>
              Added before Minecraft's own arguments, e.g.
              <code style={{ color: "var(--color-accent-text)" }}> -XX:+UseG1GC</code>
            </p>
          </div>

          {hooksDraft && <LaunchCommandsCard draft={hooksDraft} onChange={setHooksDraft} windows={system?.platform === "win32"} />}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="sidebar-button"
              style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
              disabled={busy === "save" || Boolean(draftProblem)}
              title={draftProblem ?? undefined}
              onClick={() =>
                run("save", async () => {
                  await window.instanceAPI.update(instanceName, {
                    ram: ramDraft ?? instance.ram,
                    jvmArgs: jvmDraft ?? "",
                    ...(windowDraft ? { window: windowFromDraft(windowDraft) } : {}),
                    ...(hooksDraft ? { launchHooks: hooksFromDraft(hooksDraft) } : {}),
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
                setWindowDraft(windowDraftOf(instance.window));
                setHooksDraft(hooksDraftOf(instance.launchHooks));
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
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <button className="sidebar-button" data-testid="back-to-content" onClick={() => setTab("mods")} style={{ padding: "6px 12px", fontSize: 13 }}>
              ← Back to Content
            </button>
            <span style={{ color: "var(--color-accent-text)", fontSize: 15 }}>Add Content</span>
          </div>

          {contentTabs()}

          <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 10 }}>
            Showing only {currentTab.label.toLowerCase()} that work on Minecraft{" "}
            {instance.version}
            {contentType === "mod" ? ` with ${loaderLabel}` : ""}. Anything they
            require installs automatically.
          </p>

          {contentType === "shader" && !hasShaderMod && (
            <div
              style={{
                ...card,
                borderColor: "var(--color-warning-border)",
                background: "var(--color-warning-bg)",
                color: "var(--color-warning-text)",
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              Shaders need a mod to run them, such as Iris. This instance doesn't appear to have one.
            </div>
          )}

          {contentType === "datapack" && (
            <label style={{ display: "block", color: "var(--color-text-muted)", fontSize: 13, marginBottom: 10 }}>
              Install data packs into{" "}
              <select
                aria-label="World to install into"
                value={targetWorld}
                onChange={(e) => setInstallWorld(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: "var(--color-surface-sunken)",
                  color: "var(--color-text)",
                  border: "1px solid var(--color-border)",
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
                setNotice(`Installed ${result.name} from GitHub, in ${result.folder}. ${dependencyNote(result)}`.trim());
                await refresh();
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
              background: "var(--color-surface-sunken)",
              color: "var(--color-text)",
              border: "1px solid var(--color-border)",
              boxSizing: "border-box",
              marginBottom: 12,
            }}
          />

          <div ref={browseTop} />

          {browsed && !cantUseThisType && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              <div data-testid="page-summary" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
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
                <div data-testid="curseforge-limit" style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
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
                borderColor: "var(--color-warning-border)",
                background: "var(--color-warning-bg)",
                color: "var(--color-warning-text)",
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {w}
            </div>
          ))}

          {cantUseThisType ? (
            <div style={{ ...card, color: "var(--color-text-muted)" }}>
              Vanilla can't load mods. Create an instance with a mod loader to use them.
            </div>
          ) : searching ? (
            <div style={{ color: "var(--color-text-muted)" }}>Searching...</div>
          ) : results.length === 0 ? (
            <div style={{ ...card, color: "var(--color-text-muted)" }}>
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
                    className="id-result"
                    onClick={(event) => !fromControl(event) && openProject(mod.source, mod.id)}
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
                      <button
                        type="button"
                        className="id-result-name"
                        data-testid="browse-open"
                        title={`Open ${mod.name}'s page`}
                        onClick={() => openProject(mod.source, mod.id)}
                      >
                        {mod.name}
                      </button>

                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                        {mod.summary?.slice(0, 140)}
                      </div>

                      <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>
                        {mod.author ? `${mod.author} • ` : ""}
                        <SourceDownloads sources={mod.sources} />
                      </div>

                      {added[mod.id] && (
                        <div data-testid="browse-added" style={{ fontSize: 12, color: "var(--color-success-text)", marginTop: 4 }}>
                          {added[mod.id]}
                        </div>
                      )}
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
                        style={{ minWidth: 100, background: "var(--color-accent)", color: "var(--color-on-accent)" }}
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
    </>
  );
}
