import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleCheck,
  CircleX,
  Cloud,
  Coffee,
  FolderOpen,
  LogOut,
  MemoryStick,
  Package,
  Plus,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import BackgroundLogo from "../components/BackgroundLogo";
import Sidebar from "../components/MCSidebar";
import StarterModsSettings from "../components/StarterModsSettings";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Notice from "../components/ui/Notice";
import Segmented from "../components/ui/Segmented";
import SettingsLayout, { SettingsHeader } from "../components/SettingsLayout";
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

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );

const clampRam = (gb: number, total: number) =>
  Math.max(1, Math.min(total, Math.round(gb)));

/* Minecraft's settings: what every instance uses unless the instance sets its own. */
function MCSettings({
  goHome,
  goMinecraft,
  goDiscover,
  goLibrary,
  goSkinSelector,
  goSettings,
}: Props) {
  const [settings, setSettings] = useState<LauncherSettings | null>(null);
  const [cloudFolders, setCloudFolders] = useState<CloudFolder[]>([]);
  const [accounts, setAccounts] = useState<MinecraftAccount[]>([]);
  const [backups, setBackups] = useState<CloudInstance[]>([]);
  const [javaRuntimes, setJavaRuntimes] = useState<
    { majorVersion: number; component: string }[]
  >([]);

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
    window.instanceAPI
      .javaRuntimes()
      .then(setJavaRuntimes)
      .catch(() => {});
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
      Promise.all([
        window.instanceAPI.getSettings(),
        window.instanceAPI.cloudDetect(),
        window.instanceAPI.listAccounts(),
        window.instanceAPI
          .cloudList()
          .catch(() => ({ folder: "", instances: [] as CloudInstance[] })),
      ]).then(
        ([s, folders, acct, cloud]) => {
          setBackups(cloud.instances);
          stored.current = s;
          setSettings(s);
          setCloudFolders(folders);
          setAccounts(acct);
        },
        (err) => setError(message(err)),
      ),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Every change is written to disk straight away, so leaving the page never loses one.
  async function patch(update: Partial<LauncherSettings>) {
    const before = stored.current;
    if (
      before &&
      (Object.keys(update) as (keyof LauncherSettings)[]).every(
        (key) => before[key] === update[key],
      )
    )
      return;

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

  const status = busy ? "Saving..." : error ? null : notice;

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

        <div className="app-page">
          <SettingsHeader
            title="Minecraft settings"
            lead="Every instance uses these unless its own settings say otherwise."
            status={status}
          />

          {error && (
            <Notice
              tone="danger"
              style={{
                maxWidth: "var(--content-max)",
                marginBottom: "var(--space-6)",
              }}
            >
              {error}
            </Notice>
          )}

          {!settings ? (
            <p className="set-help">Loading settings...</p>
          ) : (
            <SettingsLayout
              label="Minecraft settings categories"
              categories={[
                {
                  id: "mc-java",
                  label: "Java",
                  group: "Game",
                  icon: <Coffee size={16} aria-hidden="true" />,
                  content: (
                    <>
                      <section aria-label="Java" className="ui-panel set-panel">
                        <div
                          id="mc-java"
                          role="group"
                          aria-labelledby="mc-java-title"
                          className="set-section"
                        >
                          <div className="set-panel-head">
                            <div>
                              <h2
                                id="mc-java-title"
                                className="set-panel-title"
                              >
                                <Coffee size={18} aria-hidden="true" />
                                Java
                              </h2>
                              <p className="set-lead">
                                Minecraft: Java Edition runs on Java. The
                                launcher can look after it for you.
                              </p>
                            </div>
                          </div>

                          <div className="set-row">
                            <div>
                              <h3 className="set-row-name">Java to use</h3>
                              <p className="set-help" id="java-help">
                                Leave it on automatic and each instance gets the
                                Java its Minecraft version needs, downloaded
                                from Mojang the first time. Or choose one Java
                                for every instance; an instance can still choose
                                its own in its settings.
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
                                  onChange={(e) =>
                                    setSettings({
                                      ...settings,
                                      javaPath: e.target.value,
                                    })
                                  }
                                  onBlur={() => commitText("javaPath")}
                                  onKeyDown={(e) =>
                                    e.key === "Enter" && commitText("javaPath")
                                  }
                                />
                                <Button
                                  icon={
                                    <FolderOpen size={16} aria-hidden="true" />
                                  }
                                  disabled={busy}
                                  onClick={async () => {
                                    const picked =
                                      await window.instanceAPI.pickJava();
                                    if (picked) await load();
                                  }}
                                >
                                  Browse...
                                </Button>
                              </div>
                              {settings.javaPath ? (
                                <p className="set-message set-message--muted">
                                  Every instance uses this Java unless it picks
                                  its own.
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => patch({ javaPath: "" })}
                                  >
                                    Use automatic
                                  </Button>
                                </p>
                              ) : (
                                <p className="set-message set-message--success">
                                  <CircleCheck size={14} aria-hidden="true" />
                                  Automatic: the right Java for each Minecraft
                                  version.
                                </p>
                              )}
                              {javaRuntimes.length > 0 && (
                                <div
                                  className="set-actions"
                                  aria-label="Java downloaded so far"
                                >
                                  <span className="set-help">
                                    Downloaded so far:
                                  </span>
                                  {javaRuntimes.map((runtime) => (
                                    <Badge key={runtime.component}>
                                      Java {runtime.majorVersion}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="set-row">
                            <div>
                              <h3 className="set-row-name" id="java-tuning-title">Java flags</h3>
                              <p className="set-help" id="java-tuning-help">
                                {(settings.javaTuning ?? "performance") === "performance"
                                  ? "The Minecraft Launcher's settings, plus no freezes when a mod asks Java to clean up and room for more compiled code in big modpacks. Picture quality doesn't change. For more frames, add speed mods with Optimise."
                                  : "The Minecraft Launcher's own memory clean-up settings."}
                              </p>
                            </div>
                            <div className="set-row-controls">
                              <Segmented
                                label="Java flags"
                                value={settings.javaTuning ?? "performance"}
                                onChange={(value) => {
                                  setSettings({ ...settings, javaTuning: value });
                                  patch({ javaTuning: value });
                                }}
                                options={[
                                  { value: "performance", label: "Performance" },
                                  { value: "standard", label: "Standard" },
                                ]}
                              />
                            </div>
                          </div>

                          <div className="set-row">
                            <div>
                              <h3 className="set-row-name">
                                Java arguments <Badge>Advanced</Badge>
                              </h3>
                              <p className="set-help" id="jvm-help">
                                Added after the Java flags above, so yours win.
                                Add a garbage collector here (such as
                                -XX:+UseZGC) to use it instead of either.
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
                                onChange={(e) =>
                                  setSettings({
                                    ...settings,
                                    jvmArgs: e.target.value,
                                  })
                                }
                                onBlur={() => commitText("jvmArgs")}
                                onKeyDown={(e) =>
                                  e.key === "Enter" && commitText("jvmArgs")
                                }
                              />
                            </div>
                          </div>
                        </div>
                      </section>
                    </>
                  ),
                },
                {
                  id: "mc-memory",
                  label: "Memory",
                  icon: <MemoryStick size={16} aria-hidden="true" />,
                  content: (
                    <>
                      <section id="mc-memory" aria-label="Memory" className="ui-panel set-panel">
                        <div
                          role="group"
                          aria-labelledby="mc-memory-title"
                          className="set-section"
                        >
                          <div className="set-panel-head">
                            <div>
                              <h2
                                id="mc-memory-title"
                                className="set-panel-title"
                              >
                                <MemoryStick size={18} aria-hidden="true" />
                                Memory
                              </h2>
                              <p className="set-lead">
                                How much memory new instances get. Most modpacks
                                run well with 6 to 8 GB; plain Minecraft needs 2
                                to 4 GB.
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
                            style={{
                              width: "100%",
                              ["--fill" as string]: fill,
                              ["--safe" as string]: safeAt,
                            }}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                defaultRam: Number(e.target.value),
                              })
                            }
                            onPointerUp={(e) =>
                              commitRam(
                                Number((e.target as HTMLInputElement).value),
                              )
                            }
                            onKeyUp={(e) =>
                              commitRam(
                                Number((e.target as HTMLInputElement).value),
                              )
                            }
                            onBlur={(e) => commitRam(Number(e.target.value))}
                          />
                          <div className="set-scale" aria-hidden="true">
                            <span>1 GB</span>
                            {safe < total && (
                              <span
                                className="set-scale-tick"
                                style={{ left: safeAt }}
                              />
                            )}
                            <span className="set-scale-end">{total} GB</span>
                          </div>
                          {safe < total && (
                            <p className="set-scale-note">
                              Safe up to {safe} GB
                            </p>
                          )}

                          <div
                            className="set-quick"
                            role="group"
                            aria-label="Quick picks"
                          >
                            <span className="set-help">Quick picks</span>
                            <div className="ui-segmented">
                              {[2, 4, 6, 8]
                                .filter((gb) => gb <= total)
                                .map((gb) => (
                                  <button
                                    key={gb}
                                    type="button"
                                    className="ui-segmented__option"
                                    aria-pressed={ram === gb}
                                    onClick={() => {
                                      setSettings({
                                        ...settings,
                                        defaultRam: gb,
                                      });
                                      commitRam(gb);
                                    }}
                                  >
                                    {gb} GB
                                  </button>
                                ))}
                            </div>
                          </div>

                          <p
                            className={`set-message ${ram > safe ? "set-message--warning" : "set-message--muted"}`}
                            style={{ marginTop: "var(--space-3)" }}
                          >
                            {ram > safe ? (
                              <TriangleAlert size={14} aria-hidden="true" />
                            ) : null}
                            {ram > safe
                              ? `Above the recommended maximum. This computer has ${total} GB, and giving Minecraft more than ${safe} GB leaves too little for everything else.`
                              : `This computer has ${total} GB. Up to ${safe} GB leaves enough for everything else.`}
                          </p>
                        </div>

                      </section>
                    </>
                  ),
                },
                {
                  id: "mc-accounts",
                  label: "Accounts",
                  group: "Account",
                  icon: <UserRound size={16} aria-hidden="true" />,
                  content: (
                    <>
                      <section
                        id="mc-accounts"
                        aria-labelledby="mc-accounts-title"
                        className="ui-panel set-panel"
                      >
                        <div className="set-panel-head">
                          <div>
                            <h2
                              id="mc-accounts-title"
                              className="set-panel-title"
                            >
                              <UserRound size={18} aria-hidden="true" />
                              Accounts
                            </h2>
                            <p className="set-lead">
                              The game launches as the account in use. You can
                              also switch at the bottom of the sidebar. Bedrock
                              uses these same Microsoft accounts.
                            </p>
                          </div>
                          <Button
                            variant={accounts.length ? "secondary" : "primary"}
                            icon={<Plus size={16} aria-hidden="true" />}
                            onClick={signIn}
                          >
                            {signingIn
                              ? "Start sign-in again"
                              : accounts.length
                                ? "Add another account"
                                : "Sign in with Microsoft"}
                          </Button>
                        </div>

                        {accounts.length === 0 ? (
                          <Notice tone="warning">
                            Not signed in, so instances launch in offline mode.
                          </Notice>
                        ) : (
                          <ul data-testid="accounts" className="set-list">
                            {accounts.map((entry) => (
                              <li
                                key={entry.uuid}
                                data-testid="account-row"
                                className={`set-item${entry.active ? " set-item--current" : ""}`}
                              >
                                <span
                                  className="set-monogram"
                                  aria-hidden="true"
                                >
                                  {entry.name.slice(0, 1).toUpperCase()}
                                </span>
                                <div className="set-item-text">
                                  <div className="set-item-name">
                                    <span>{entry.name}</span>
                                    {entry.active && (
                                      <Badge tone="success">In use</Badge>
                                    )}
                                  </div>
                                  <div className="set-item-meta">
                                    {entry.active
                                      ? "Minecraft launches as this account."
                                      : "Signed in on this computer."}
                                  </div>
                                </div>
                                {!entry.active && (
                                  <Button
                                    size="sm"
                                    onClick={async () => {
                                      setAccounts(
                                        await window.instanceAPI.switchAccount(
                                          entry.uuid,
                                        ),
                                      );
                                      setNotice(
                                        `Now playing as ${entry.name}.`,
                                      );
                                    }}
                                  >
                                    Use
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant={
                                    confirmSignOut === entry.uuid
                                      ? "danger"
                                      : "ghost"
                                  }
                                  icon={<LogOut size={14} aria-hidden="true" />}
                                  aria-label={
                                    confirmSignOut === entry.uuid
                                      ? `Sign out ${entry.name}? Press again to confirm`
                                      : `Sign out ${entry.name}`
                                  }
                                  onClick={async () => {
                                    if (confirmSignOut !== entry.uuid) {
                                      setConfirmSignOut(entry.uuid);
                                      return;
                                    }
                                    setConfirmSignOut(null);
                                    setAccounts(
                                      await window.instanceAPI.removeAccount(
                                        entry.uuid,
                                      ),
                                    );
                                    setNotice(`Signed ${entry.name} out.`);
                                  }}
                                >
                                  {confirmSignOut === entry.uuid
                                    ? "Sign out?"
                                    : "Sign out"}
                                </Button>
                              </li>
                            ))}
                          </ul>
                        )}

                        {signingIn && (
                          <p
                            className="set-message set-message--muted"
                            style={{ marginTop: "var(--space-3)" }}
                          >
                            Finish signing in in your browser.
                          </p>
                        )}
                        {signInError && (
                          <p
                            role="alert"
                            className="set-message set-message--danger"
                            style={{ marginTop: "var(--space-3)" }}
                          >
                            <CircleX size={14} aria-hidden="true" />
                            {signInError}
                          </p>
                        )}
                      </section>

                    </>
                  ),
                },
                {
                  id: "mc-starter",
                  label: "Starter mods",
                  icon: <Package size={16} aria-hidden="true" />,
                  content: (
                    <>
                      <StarterModsSettings id="mc-starter" />

                    </>
                  ),
                },
                {
                  id: "mc-cloud",
                  label: "Cloud backup",
                  icon: <Cloud size={16} aria-hidden="true" />,
                  content: (
                    <>
                      <section
                        id="mc-cloud"
                        aria-labelledby="mc-cloud-title"
                        className="ui-panel set-panel"
                      >
                        <div className="set-panel-head">
                          <div>
                            <h2 id="mc-cloud-title" className="set-panel-title">
                              <Cloud size={18} aria-hidden="true" />
                              Cloud backup
                            </h2>
                            <p className="set-lead">
                              Instances are backed up as a single zip into a
                              folder your cloud service already syncs, so they
                              appear on your other computers without signing in
                              to anything.
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
                              <Button
                                key={folder.path}
                                disabled={
                                  busy || settings.cloudFolder === folder.path
                                }
                                onClick={() =>
                                  patch({ cloudFolder: folder.path })
                                }
                              >
                                Use {folder.label}
                              </Button>
                            ))}
                            <Button
                              icon={<FolderOpen size={16} aria-hidden="true" />}
                              disabled={busy}
                              onClick={async () => {
                                const picked =
                                  await window.instanceAPI.cloudPickFolder();
                                if (picked) await load();
                              }}
                            >
                              Choose folder...
                            </Button>
                            {settings.cloudFolder && (
                              <Button
                                variant="ghost"
                                disabled={busy}
                                onClick={() => patch({ cloudFolder: "" })}
                              >
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
                              No folder chosen. Backups go to OneDrive if it's
                              installed on this computer.
                            </p>
                          )}
                        </div>

                        {settings.cloudFolder && (
                          <>
                            <h3 className="set-subhead">Backed up instances</h3>
                            {backups.length === 0 ? (
                              <p className="set-help">
                                No instances are backed up to this folder yet.
                              </p>
                            ) : (
                              <ul
                                data-testid="cloud-backups"
                                className="set-list"
                              >
                                {backups.map((entry) => (
                                  <li key={entry.file} className="set-item">
                                    <span
                                      className="set-monogram"
                                      aria-hidden="true"
                                    >
                                      <Cloud size={16} />
                                    </span>
                                    <div className="set-item-text">
                                      <div className="set-item-name">
                                        <span>{entry.name}</span>
                                        {entry.notDownloaded && (
                                          <Badge>Not on this computer</Badge>
                                        )}
                                      </div>
                                      <div className="set-item-meta">
                                        {entry.modified
                                          ? `Backed up ${new Date(entry.modified).toLocaleDateString()}`
                                          : "Backed up"}
                                        {" \u00b7 "}
                                        {(entry.size / 1048576).toFixed(1)} MB
                                      </div>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}
                      </section>
                    </>
                  ),
                },
              ]}
            />
          )}
        </div>
      </main>
    </div>
  );
}

export default MCSettings;
