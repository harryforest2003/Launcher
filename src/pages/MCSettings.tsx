import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CircleCheck, CircleX, Cloud, Coffee, FolderOpen, LogOut, MemoryStick, Plus, TriangleAlert, UserRound } from "lucide-react";
import BackgroundLogo from "../components/BackgroundLogo";
import Sidebar from "../components/MCSidebar";
import StarterModsSettings from "../components/StarterModsSettings";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Notice from "../components/ui/Notice";
import SectionIndex, { type IndexEntry } from "../components/ui/SectionIndex";
import "../theme/appearance.css";

type Props = {
  onBack: () => void;

  goHome: () => void;
  goMinecraft: () => void;
  goDiscover: () => void;
  goLibrary: () => void;
  goSkinSelector: () => void;
  goSettings: () => void;
};

const SECTIONS: IndexEntry[] = [
  { id: "mc-memory", label: "Memory" },
  { id: "mc-java", label: "Java" },
  { id: "mc-accounts", label: "Accounts" },
  { id: "mc-starter", label: "Starter mods" },
  { id: "mc-cloud", label: "Cloud backup" },
];

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const clampRam = (gb: number, total: number) => Math.max(1, Math.min(total, Math.round(gb)));

/* Minecraft's settings: what every instance uses unless the instance sets its own. */
function MCSettings({ onBack, goHome, goMinecraft, goDiscover, goLibrary, goSkinSelector, goSettings }: Props) {
  const [settings, setSettings] = useState<LauncherSettings | null>(null);
  const [cloudFolders, setCloudFolders] = useState<CloudFolder[]>([]);
  const [accounts, setAccounts] = useState<MinecraftAccount[]>([]);
  const [javaRuntimes, setJavaRuntimes] = useState<{ majorVersion: number; component: string }[]>([]);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // What the settings file holds, so a field only saves when it really changed.
  const stored = useRef<LauncherSettings | null>(null);

  // Signing in happens in the browser; pressing again starts it over.
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const signInRun = useRef(0);
  const [confirmSignOut, setConfirmSignOut] = useState<string | null>(null);

  useEffect(() => window.instanceAPI.onAccountsChanged(setAccounts), []);

  useEffect(() => {
    window.instanceAPI.javaRuntimes().then(setJavaRuntimes).catch(() => {});
  }, []);

  // A sign-out waiting for its second press stands down after a few seconds.
  useEffect(() => {
    if (!confirmSignOut) return;
    const timer = setTimeout(() => setConfirmSignOut(null), 4000);
    return () => clearTimeout(timer);
  }, [confirmSignOut]);

  // Settings, the cloud folders found on this computer, and the signed-in accounts.
  const load = useCallback(
    () =>
      Promise.all([window.instanceAPI.getSettings(), window.instanceAPI.cloudDetect(), window.instanceAPI.listAccounts()]).then(
        ([s, folders, acct]) => {
          stored.current = s;
          setSettings(s);
          setCloudFolders(folders);
          setAccounts(acct);
        },
        (err) => setError(message(err))
      ),
    []
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Every change is written to disk straight away, so leaving the page never loses one.
  async function patch(update: Partial<LauncherSettings>) {
    const before = stored.current;
    if (before && (Object.keys(update) as (keyof LauncherSettings)[]).every((key) => before[key] === update[key])) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const next = await window.instanceAPI.setSettings(update);
      stored.current = next;
      setSettings(next);
      setNotice("Saved.");
    } catch (err) {
      setError(message(err));
    }

    setBusy(false);
  }

  async function signIn() {
    const run = ++signInRun.current;
    setSigningIn(true);
    setSignInError(null);
    try {
      await window.launcherAPI.loginMicrosoft();
      if (run !== signInRun.current) return;
      setAccounts(await window.instanceAPI.listAccounts());
    } catch (err) {
      if (run === signInRun.current) setSignInError(message(err));
    }
    if (run === signInRun.current) setSigningIn(false);
  }

  const total = settings?.system.totalRamGb ?? 1;
  const safe = settings?.system.maxRecommendedGb ?? total;
  const ram = settings?.defaultRam ?? 1;
  const span = Math.max(1, total - 1);
  const fill = `${((ram - 1) / span) * 100}%`;
  const safeAt = `${((safe - 1) / span) * 100}%`;

  const commitRam = (gb: number) => {
    if (!settings) return;
    const value = clampRam(gb, total);
    setSettings({ ...settings, defaultRam: value });
    patch({ defaultRam: value });
  };

  const commitText = (key: "javaPath" | "jvmArgs") => {
    if (settings) patch({ [key]: settings[key] });
  };

  const status = busy ? "Saving..." : error ? null : notice ?? "Changes save as you make them.";

  return (
    <div className="app-screen">
      <Sidebar
        currentPage="settings"
        goHome={goHome}
        goMinecraft={goMinecraft}
        goDiscover={goDiscover}
        goLibrary={goLibrary}
        goSkinSelector={goSkinSelector}
        goSettings={goSettings}
      />

      <main className="app-main">
        <div className="app-logo-tint">
          <BackgroundLogo />
        </div>

        <div className="app-page" ref={setScroller}>
          <Button variant="ghost" size="sm" className="set-back" icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={onBack}>
            Back to Minecraft
          </Button>

          <header className="page-header set-header">
            <div>
              <h1 className="page-title">Minecraft settings</h1>
              <p className="page-lead">Every instance uses these unless you change it in that instance's own settings.</p>
            </div>
            <span className="appearance-saved" role="status" aria-live="polite">
              {status && notice && !busy && <CircleCheck size={14} aria-hidden="true" />}
              {status}
            </span>
          </header>

          {error && (
            <Notice tone="danger" style={{ maxWidth: "var(--content-max)", marginBottom: "var(--space-6)" }}>
              {error}
            </Notice>
          )}

          {!settings ? (
            <p className="set-help">Loading settings...</p>
          ) : (
            <div className="page-with-index">
              <SectionIndex label="Minecraft settings sections" entries={SECTIONS} scroller={scroller} />

              <div className="page-sections set-sections">
                {/* ---------- Memory ---------- */}
                <section id="mc-memory" aria-labelledby="mc-memory-title" className="ui-panel set-panel">
                  <div className="set-panel-head">
                    <div>
                      <h2 id="mc-memory-title" className="set-panel-title">
                        <MemoryStick size={18} aria-hidden="true" />
                        Memory
                      </h2>
                      <p className="set-lead">
                        How much memory new instances get. Most modpacks run well with 6 to 8 GB; plain Minecraft needs 2 to 4 GB.
                      </p>
                    </div>
                    <span className="set-figure" aria-hidden="true">
                      {ram}
                      <small>GB</small>
                    </span>
                  </div>

                  <input
                    type="range"
                    className="set-range"
                    aria-label="Memory for new instances"
                    aria-valuetext={`${ram} GB`}
                    min={1}
                    max={total}
                    step={1}
                    value={ram}
                    style={{ width: "100%", ["--fill" as string]: fill, ["--safe" as string]: safeAt }}
                    onChange={(e) => setSettings({ ...settings, defaultRam: Number(e.target.value) })}
                    onPointerUp={(e) => commitRam(Number((e.target as HTMLInputElement).value))}
                    onKeyUp={(e) => commitRam(Number((e.target as HTMLInputElement).value))}
                    onBlur={(e) => commitRam(Number(e.target.value))}
                  />
                  <div className="set-scale" aria-hidden="true">
                    <span style={{ left: 0 }}>1 GB</span>
                    {safe < total && (
                      <span className="set-scale-safe" style={{ left: safeAt }}>
                        Safe up to {safe} GB
                      </span>
                    )}
                    <span className="set-scale-end">{total} GB</span>
                  </div>

                  <p className={`set-message ${ram > safe ? "set-message--warning" : "set-message--muted"}`} style={{ marginTop: "var(--space-3)" }}>
                    {ram > safe ? <TriangleAlert size={14} aria-hidden="true" /> : null}
                    {ram > safe
                      ? `Above the recommended maximum. This computer has ${total} GB, and giving Minecraft more than ${safe} GB leaves too little for everything else.`
                      : `This computer has ${total} GB. Up to ${safe} GB leaves enough for everything else.`}
                  </p>
                </section>

                {/* ---------- Java ---------- */}
                <section id="mc-java" aria-labelledby="mc-java-title" className="ui-panel set-panel">
                  <div className="set-panel-head">
                    <div>
                      <h2 id="mc-java-title" className="set-panel-title">
                        <Coffee size={18} aria-hidden="true" />
                        Java
                      </h2>
                      <p className="set-lead">Minecraft: Java Edition runs on Java. The launcher can look after it for you.</p>
                    </div>
                  </div>

                  <div className="set-row">
                    <div>
                      <h3 className="set-row-name">Java to use</h3>
                      <p className="set-help" id="java-help">
                        Leave it on automatic and each instance gets the Java its Minecraft version needs, downloaded from Mojang the
                        first time. Or choose one Java for every instance; an instance can still choose its own in its settings.
                      </p>
                    </div>
                    <div className="set-row-controls">
                      <div className="set-form">
                        <input
                          className="ui-input ui-input--mono"
                          aria-label="Java to use"
                          aria-describedby="java-help"
                          value={settings.javaPath}
                          placeholder="Automatic"
                          spellCheck={false}
                          onChange={(e) => setSettings({ ...settings, javaPath: e.target.value })}
                          onBlur={() => commitText("javaPath")}
                          onKeyDown={(e) => e.key === "Enter" && commitText("javaPath")}
                        />
                        <Button
                          icon={<FolderOpen size={16} aria-hidden="true" />}
                          disabled={busy}
                          onClick={async () => {
                            const picked = await window.instanceAPI.pickJava();
                            if (picked) await load();
                          }}
                        >
                          Browse...
                        </Button>
                      </div>
                      {settings.javaPath ? (
                        <p className="set-message set-message--muted">
                          Every instance uses this Java unless it picks its own.
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => patch({ javaPath: "" })}>
                            Use automatic
                          </Button>
                        </p>
                      ) : (
                        <p className="set-message set-message--success">
                          <CircleCheck size={14} aria-hidden="true" />
                          Automatic: the right Java for each Minecraft version.
                        </p>
                      )}
                      {javaRuntimes.length > 0 && (
                        <div className="set-actions" aria-label="Java downloaded so far">
                          <span className="set-help">Downloaded so far:</span>
                          {javaRuntimes.map((runtime) => (
                            <Badge key={runtime.component}>Java {runtime.majorVersion}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="set-row">
                    <div>
                      <h3 className="set-row-name">
                        Java arguments <Badge>Advanced</Badge>
                      </h3>
                      <p className="set-help" id="jvm-help">
                        Left empty, the Minecraft Launcher's own memory clean-up settings are used, for fewer stutters. Add a garbage
                        collector here (such as -XX:+UseZGC) to use that instead.
                      </p>
                    </div>
                    <div className="set-row-controls">
                      <input
                        className="ui-input ui-input--mono"
                        aria-label="Java arguments"
                        aria-describedby="jvm-help"
                        value={settings.jvmArgs}
                        placeholder="-XX:+UseG1GC"
                        spellCheck={false}
                        onChange={(e) => setSettings({ ...settings, jvmArgs: e.target.value })}
                        onBlur={() => commitText("jvmArgs")}
                        onKeyDown={(e) => e.key === "Enter" && commitText("jvmArgs")}
                      />
                    </div>
                  </div>
                </section>

                {/* ---------- Accounts ---------- */}
                <section id="mc-accounts" aria-labelledby="mc-accounts-title" className="ui-panel set-panel">
                  <div className="set-panel-head">
                    <div>
                      <h2 id="mc-accounts-title" className="set-panel-title">
                        <UserRound size={18} aria-hidden="true" />
                        Accounts
                      </h2>
                      <p className="set-lead">
                        The game launches as the account in use. You can also switch at the bottom of the sidebar. Bedrock uses these
                        same Microsoft accounts.
                      </p>
                    </div>
                    <Button
                      variant={accounts.length ? "secondary" : "primary"}
                      icon={<Plus size={16} aria-hidden="true" />}
                      onClick={signIn}
                    >
                      {signingIn ? "Start sign-in again" : accounts.length ? "Add another account" : "Sign in with Microsoft"}
                    </Button>
                  </div>

                  {accounts.length === 0 ? (
                    <Notice tone="warning">Not signed in, so instances launch in offline mode.</Notice>
                  ) : (
                    <ul data-testid="accounts" className="set-list">
                      {accounts.map((entry) => (
                        <li key={entry.uuid} data-testid="account-row" className={`set-item${entry.active ? " set-item--current" : ""}`}>
                          <span className="set-monogram" aria-hidden="true">
                            {entry.name.slice(0, 1).toUpperCase()}
                          </span>
                          <div className="set-item-text">
                            <div className="set-item-name">
                              <span>{entry.name}</span>
                              {entry.active && <Badge tone="success">In use</Badge>}
                            </div>
                          </div>
                          {!entry.active && (
                            <Button
                              size="sm"
                              onClick={async () => {
                                setAccounts(await window.instanceAPI.switchAccount(entry.uuid));
                                setNotice(`Now playing as ${entry.name}.`);
                              }}
                            >
                              Use
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant={confirmSignOut === entry.uuid ? "danger" : "ghost"}
                            icon={<LogOut size={14} aria-hidden="true" />}
                            aria-label={confirmSignOut === entry.uuid ? `Sign out ${entry.name}? Press again to confirm` : `Sign out ${entry.name}`}
                            onClick={async () => {
                              if (confirmSignOut !== entry.uuid) {
                                setConfirmSignOut(entry.uuid);
                                return;
                              }
                              setConfirmSignOut(null);
                              setAccounts(await window.instanceAPI.removeAccount(entry.uuid));
                              setNotice(`Signed ${entry.name} out.`);
                            }}
                          >
                            {confirmSignOut === entry.uuid ? "Sign out?" : "Sign out"}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {signingIn && (
                    <p className="set-message set-message--muted" style={{ marginTop: "var(--space-3)" }}>
                      Finish signing in in your browser.
                    </p>
                  )}
                  {signInError && (
                    <p role="alert" className="set-message set-message--danger" style={{ marginTop: "var(--space-3)" }}>
                      <CircleX size={14} aria-hidden="true" />
                      {signInError}
                    </p>
                  )}
                </section>

                {/* ---------- Starter mods ---------- */}
                <StarterModsSettings id="mc-starter" />

                {/* ---------- Cloud ---------- */}
                <section id="mc-cloud" aria-labelledby="mc-cloud-title" className="ui-panel set-panel">
                  <div className="set-panel-head">
                    <div>
                      <h2 id="mc-cloud-title" className="set-panel-title">
                        <Cloud size={18} aria-hidden="true" />
                        Cloud backup
                      </h2>
                      <p className="set-lead">
                        Instances are backed up as a single zip into a folder your cloud service already syncs, so they appear on your
                        other computers without signing in to anything.
                      </p>
                    </div>
                  </div>

                  <div className="set-stack">
                    <span className="set-label" id="cloud-label">
                      Backup folder
                    </span>
                    <div className="set-form">
                      <span
                        className={`set-value-box${settings.cloudFolder ? "" : " set-value-box--empty"}`}
                        aria-labelledby="cloud-label"
                        title={settings.cloudFolder || undefined}
                      >
                        {settings.cloudFolder || "No folder chosen"}
                      </span>
                      {cloudFolders.map((folder) => (
                        <Button key={folder.path} disabled={busy || settings.cloudFolder === folder.path} onClick={() => patch({ cloudFolder: folder.path })}>
                          Use {folder.label}
                        </Button>
                      ))}
                      <Button
                        icon={<FolderOpen size={16} aria-hidden="true" />}
                        disabled={busy}
                        onClick={async () => {
                          const picked = await window.instanceAPI.cloudPickFolder();
                          if (picked) await load();
                        }}
                      >
                        Choose folder...
                      </Button>
                      {settings.cloudFolder && (
                        <Button variant="ghost" disabled={busy} onClick={() => patch({ cloudFolder: "" })}>
                          Clear
                        </Button>
                      )}
                    </div>
                    {settings.cloudFolder ? (
                      <p className="set-message set-message--success">
                        <CircleCheck size={14} aria-hidden="true" />
                        Backups go to this folder.
                      </p>
                    ) : (
                      <p className="set-message set-message--warning">
                        <TriangleAlert size={14} aria-hidden="true" />
                        No folder chosen. Backups go to OneDrive if it's installed on this computer.
                      </p>
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default MCSettings;
