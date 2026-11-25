import { useEffect, useState } from "react";
import { Bell, Download, FolderOpen, RefreshCw, RotateCcw, Trash2, Upload } from "lucide-react";
import { Button, Segmented, toast } from "./ui";
import { checkForUpdate, restartToUpdate, useAppUpdate } from "./appUpdate";
import { showWelcomeAgain } from "./welcomeState";

/*
 * Settings for the launcher itself: About (version and updates), Storage, Startup and
 * notifications, Downloads, and saving or loading every setting (window.appAPI).
 */

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const stack = { display: "flex", flexDirection: "column", gap: 14 } as const;
const row = { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" } as const;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const when = (iso?: string | null) => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

/* Loads and saves the launcher's settings, for the sections that change one. */
function useLauncherSettings() {
  const [settings, setSettings] = useState<LauncherSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    window.instanceAPI
      .getSettings()
      .then((loaded) => live && setSettings(loaded))
      .catch((err) => live && setError(message(err)));
    return () => {
      live = false;
    };
  }, []);
  const save = (patch: Partial<LauncherSettings>) => {
    setSettings((now) => (now ? { ...now, ...patch } : now));
    setError(null);
    window.instanceAPI
      .setSettings(patch)
      .then(setSettings)
      .catch((err) => setError(message(err)));
  };
  return { settings, error, save };
}

const STATUS_WORDS: Record<AppUpdateState["status"], string> = {
  unsupported: "This copy doesn't update itself: it runs from source, or can't replace itself here.",
  idle: "Checks for a newer version in the background.",
  checking: "Checking for a newer version…",
  current: "You have the newest version.",
  downloading: "Downloading the newest version…",
  ready: "A newer version is downloaded. Restart to put it in.",
  error: "The last check didn't finish.",
};

export function AboutSection() {
  const [about, setAbout] = useState<AppAbout | null>(null);
  const update = useAppUpdate();
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    window.appAPI?.about().then(setAbout, () => {});
  }, []);

  const check = async () => {
    setChecking(true);
    try {
      await checkForUpdate();
    } finally {
      setChecking(false);
    }
  };
  const progress = update.status === "downloading" && typeof update.progress === "number" ? ` ${Math.round(update.progress * 100)}%` : "";
  const latest = update.latest?.committed ? when(update.latest.committed) : null;

  return (
    <div style={stack} data-testid="about-launcher">
      <dl className="set-facts">
        <div>
          <dt>Version</dt>
          <dd>{about ? `${about.version}${about.commit ? ` (${about.commit.slice(0, 7)})` : ""}` : "…"}</dd>
        </div>
        <div>
          <dt>Built</dt>
          <dd>{about ? when(about.built) ?? (about.packaged ? "Unknown" : "Run from source") : "…"}</dd>
        </div>
        <div>
          <dt>System</dt>
          <dd>{about ? `${about.platform === "darwin" ? "macOS" : about.platform === "win32" ? "Windows" : "Linux"}, ${about.arch}` : "…"}</dd>
        </div>
        <div>
          <dt>Electron</dt>
          <dd>{about ? `${about.electron} (Chromium ${about.chrome}, Node ${about.node})` : "…"}</dd>
        </div>
      </dl>

      <div style={row}>
        <p className="set-message set-message--muted" role="status" style={{ margin: 0, flex: "1 1 240px" }} data-testid="about-update-status">
          <span>
            {STATUS_WORDS[update.status]}
            {progress}
            {update.status === "error" && update.message ? ` ${update.message}` : ""}
            {update.status === "ready" && latest ? ` (from ${latest})` : ""}
            {update.checkedAt && update.status !== "checking" ? ` Last checked ${when(update.checkedAt)}.` : ""}
          </span>
        </p>
        {update.status === "ready" ? (
          <Button size="sm" variant="primary" icon={<RotateCcw size={14} aria-hidden="true" />} onClick={() => void restartToUpdate()}>
            Restart to update
          </Button>
        ) : (
          <Button
            size="sm"
            icon={<RefreshCw size={14} aria-hidden="true" />}
            disabled={update.status === "unsupported" || update.status === "checking" || update.status === "downloading" || checking}
            onClick={() => void check()}
          >
            {update.status === "checking" || checking ? "Checking…" : "Check for updates"}
          </Button>
        )}
      </div>
      <p className="set-message set-message--muted" style={{ margin: 0 }}>
        <span>
          Every change is built and published on GitHub. The launcher downloads the newest build for this computer by itself and puts it in when you restart.{" "}
          <button type="button" className="set-textlink" onClick={() => void window.modAPI.openUrl("https://github.com/harryforest2003/Launcher/releases").catch(() => {})}>
            Release notes ↗
          </button>{" "}
          <button type="button" className="set-textlink" data-testid="show-welcome" onClick={showWelcomeAgain}>
            Show the welcome again
          </button>
        </span>
      </p>
    </div>
  );
}

export function StorageSection() {
  const [storage, setStorage] = useState<AppStorage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    window.appAPI?.storage().then(setStorage, (err) => setError(message(err)));
  }, []);

  const clear = async () => {
    if (!window.appAPI) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.appAPI.clearCache();
      setStorage(result);
      toast({ tone: "success", title: "Cache cleared", body: result.freedBytes ? `${formatBytes(result.freedBytes)} freed.` : "There was nothing to clear." });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={stack} data-testid="storage-settings">
      <dl className="set-facts">
        <div>
          <dt>Data folder</dt>
          <dd className="set-facts__path">{storage?.dataDir ?? "…"}</dd>
        </div>
        <div>
          <dt>Launcher data</dt>
          <dd>{storage ? formatBytes(storage.dataBytes) : "…"}</dd>
        </div>
        <div>
          <dt>Cache</dt>
          <dd>{storage ? formatBytes(storage.cacheBytes) : "…"}</dd>
        </div>
      </dl>
      <div style={row}>
        <Button size="sm" icon={<FolderOpen size={14} aria-hidden="true" />} onClick={() => void window.appAPI?.openDataFolder().catch((err) => setError(message(err)))}>
          Open data folder
        </Button>
        <Button size="sm" icon={<Trash2 size={14} aria-hidden="true" />} disabled={busy || !storage} onClick={() => void clear()}>
          {busy ? "Clearing…" : "Clear cache"}
        </Button>
      </div>
      <p className="set-message set-message--muted" style={{ margin: 0 }}>
        The cache holds pictures, pages and scans the launcher can fetch again. Clearing it never touches your instances, mods, saves or accounts.
        Instances and game mods are counted in Minecraft's settings and each game's page.
      </p>
      {error && <p className="set-message set-message--warning" role="alert">{error}</p>}
    </div>
  );
}

export function StartupSection() {
  const { settings, error, save } = useLauncherSettings();
  const [startup, setStartup] = useState<{ supported: boolean; openAtLogin: boolean } | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  useEffect(() => {
    window.appAPI?.startup().then(setStartup, () => {});
  }, []);

  const changeStartup = (openAtLogin: boolean) => {
    setStartupError(null);
    window.appAPI
      ?.setStartup({ openAtLogin })
      .then(setStartup)
      .catch((err) => setStartupError(message(err)));
  };
  const notifications = Boolean(settings?.notifications);

  return (
    <div style={stack} data-testid="startup-settings">
      <div style={stack}>
        <Segmented
          label="Open with your computer"
          value={startup?.openAtLogin ? "on" : "off"}
          onChange={(value) => changeStartup(value === "on")}
          options={[
            { value: "off", label: "Off" },
            { value: "on", label: "On" },
          ]}
        />
        <p className="set-message set-message--muted" style={{ margin: 0 }}>
          {startup && !startup.supported
            ? "Only the installed launcher on macOS or Windows can open when you sign in to your computer."
            : "Opens the launcher when you sign in to your computer."}
        </p>
        {startupError && <p className="set-message set-message--warning" role="alert">{startupError}</p>}
      </div>

      <div style={stack}>
        <Segmented
          label="Desktop notifications"
          value={notifications ? "on" : "off"}
          onChange={(value) => save({ notifications: value === "on" })}
          options={[
            { value: "off", label: "Off" },
            { value: "on", label: "On" },
          ]}
        />
        <div style={row}>
          <p className="set-message set-message--muted" style={{ margin: 0, flex: "1 1 240px" }}>
            Tells you when a launcher update is ready and when a game you started here closes, with how long you played.
          </p>
          <Button
            size="sm"
            icon={<Bell size={14} aria-hidden="true" />}
            disabled={!notifications}
            onClick={() => void window.appAPI?.testNotification().catch((err) => toast({ tone: "danger", title: "No notification", body: message(err) }))}
          >
            Send a test
          </Button>
        </div>
        {error && <p className="set-message set-message--warning" role="alert">{error}</p>}
      </div>
    </div>
  );
}

const CONCURRENCY = [
  { value: "4", label: "4" },
  { value: "8", label: "8" },
  { value: "16", label: "16" },
  { value: "32", label: "32" },
];

export function DownloadsSection({ onOpenDownloads }: { onOpenDownloads?: () => void }) {
  const { settings, error, save } = useLauncherSettings();
  const current = String(settings?.downloadConcurrency ?? 16);
  return (
    <div style={stack} data-testid="download-settings">
      <Segmented
        label="Files at once"
        value={CONCURRENCY.some((o) => o.value === current) ? current : "16"}
        onChange={(value) => save({ downloadConcurrency: Number(value) })}
        options={CONCURRENCY}
      />
      <p className="set-message set-message--muted" style={{ margin: 0 }}>
        How many files the launcher downloads at the same time when it installs Minecraft, modpacks and mods. Fewer is gentler on a slow or shared connection; more
        finishes sooner on a fast one.
      </p>
      {onOpenDownloads && (
        <div style={row}>
          <Button size="sm" icon={<Download size={14} aria-hidden="true" />} onClick={onOpenDownloads}>
            Open Downloads
          </Button>
        </div>
      )}
      {error && <p className="set-message set-message--warning" role="alert">{error}</p>}
    </div>
  );
}

/* The page's own preferences that a backup carries (see electron/launcherApp.cjs). */
const PREF_PREFIXES = ["unity.", "theme", "appearance"];

export function BackupSection() {
  const [busy, setBusy] = useState<"save" | "load" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportAll = async () => {
    if (!window.appAPI) return;
    setBusy("save");
    setError(null);
    try {
      const prefs: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && PREF_PREFIXES.some((p) => key.startsWith(p))) prefs[key] = localStorage.getItem(key) ?? "";
      }
      const file = await window.appAPI.exportSettings(prefs);
      if (file) toast({ tone: "success", title: "Settings saved", body: file });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  const importAll = async () => {
    if (!window.appAPI) return;
    setBusy("load");
    setError(null);
    try {
      const result = await window.appAPI.importSettings();
      if (!result) return;
      for (const [key, value] of Object.entries(result.prefs)) {
        if (PREF_PREFIXES.some((p) => key.startsWith(p))) localStorage.setItem(key, value);
      }
      toast({ tone: "success", title: "Settings loaded", body: "Reloading to put them in place." });
      window.setTimeout(() => location.reload(), 900);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={stack} data-testid="backup-settings">
      <div style={row}>
        <Button size="sm" icon={<Upload size={14} aria-hidden="true" />} disabled={busy !== null} onClick={() => void exportAll()}>
          {busy === "save" ? "Saving…" : "Save settings to a file"}
        </Button>
        <Button size="sm" icon={<Download size={14} aria-hidden="true" />} disabled={busy !== null} onClick={() => void importAll()}>
          {busy === "load" ? "Loading…" : "Load settings from a file"}
        </Button>
      </div>
      <p className="set-message set-message--muted" style={{ margin: 0 }}>
        One file with your colours, layout, Minecraft defaults (memory, Java flags, window size) and Discord status, to move to another computer or keep safe.
        Sign-ins and mod site keys stay out of it: they're kept encrypted on this computer only. A Java path or cloud folder from another computer isn't loaded.
      </p>
      {error && <p className="set-message set-message--warning" role="alert">{error}</p>}
    </div>
  );
}
