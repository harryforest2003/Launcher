import logo from "../assets/logo.png";
import { useCallback, useEffect, useState } from "react";
import AccountSwitcher from "../components/AccountSwitcher";
import Sidebar from "../components/MCSidebar";
import StarterModsSettings from "../components/StarterModsSettings";

type Props = {
  onBack: () => void;

  goHome: () => void;
  goMinecraft: () => void;
  goDiscover: () => void;
  goLibrary: () => void;
  goSkinSelector: () => void;
  goSettings: () => void;
};

const card: React.CSSProperties = {
  background: "#151515",
  border: "1px solid #6d28d9",
  borderRadius: 12,
  padding: 20,
  maxWidth: 760,
};

function MCSettings({
  onBack,
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

  useEffect(() => window.instanceAPI.onAccountsChanged(setAccounts), []);
  const [javaRuntimes, setJavaRuntimes] = useState<{ majorVersion: number; component: string }[]>([]);

  useEffect(() => {
    window.instanceAPI.javaRuntimes().then(setJavaRuntimes).catch(() => {});
  }, []);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, folders, acct] = await Promise.all([
        window.instanceAPI.getSettings(),
        window.instanceAPI.cloudDetect(),
        window.instanceAPI.listAccounts(),
      ]);

      setSettings(s);
      setCloudFolders(folders);
      setAccounts(acct);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Every change is written to disk immediately, so navigating away no
  // longer discards it the way the old local-state version did.
  async function patch(update: Partial<LauncherSettings>) {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      setSettings(await window.instanceAPI.setSettings(update));
      setNotice("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    setBusy(false);
  }

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: "#0d0d0d",
        color: "white",
        fontFamily: "'Orbitron', sans-serif",
      }}
    >
      <Sidebar
        currentPage="settings"
        goHome={goHome}
        goMinecraft={goMinecraft}
        goDiscover={goDiscover}
        goLibrary={goLibrary}
        goSkinSelector={goSkinSelector}
        goSettings={goSettings}
        showBack
        onBack={onBack}
      />

      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <img
          src={logo}
          alt="Launcher Logo"
          style={{
            position: "absolute",
            top: "45%",
            left: "55%",
            transform: "translate(-50%, -50%) rotate(-18deg)",
            width: "90%",
            maxWidth: "1400px",
            opacity: 0.12,
            filter: "drop-shadow(0 0 40px rgba(168, 85, 247, 0.3))",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />

        <div
          style={{
            position: "relative",
            zIndex: 1,
            padding: "35px",
            height: "100%",
            overflowY: "auto",
          }}
        >
          <h1 style={{ color: "#c084fc", marginBottom: 10 }}>Settings</h1>

          <p style={{ color: "#9ca3af", marginBottom: 30 }}>
            Applied to every instance unless the instance overrides them.
          </p>

          {error && (
            <div
              style={{
                ...card,
                borderColor: "#ef4444",
                background: "#2a0d0d",
                color: "#fca5a5",
                marginBottom: 20,
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
                marginBottom: 20,
              }}
            >
              {notice}
            </div>
          )}

          {!settings ? (
            <p style={{ color: "#9ca3af" }}>Loading settings...</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

              {/* ---------- RAM ---------- */}
              <div style={card}>
                <h2 style={{ color: "#d8b4fe", marginBottom: 10 }}>
                  Default RAM: {settings.defaultRam} GB
                </h2>

                <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 14 }}>
                  Used for new instances. This machine has{" "}
                  {settings.system.totalRamGb} GB — allocating more than{" "}
                  {settings.system.maxRecommendedGb} GB leaves too little for
                  the operating system.
                </p>

                <input
                  type="range"
                  min={1}
                  max={settings.system.totalRamGb}
                  step={1}
                  value={settings.defaultRam}
                  disabled={busy}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      defaultRam: Number(e.target.value),
                    })
                  }
                  onMouseUp={(e) =>
                    patch({ defaultRam: Number((e.target as HTMLInputElement).value) })
                  }
                  style={{ width: "100%", accentColor: "#7c3aed" }}
                />

                {settings.defaultRam > settings.system.maxRecommendedGb && (
                  <p style={{ color: "#fcd34d", fontSize: 12, marginTop: 10 }}>
                    Above the recommended maximum for this machine.
                  </p>
                )}
              </div>

              {/* ---------- Java ---------- */}
              <div style={card}>
                <h2 style={{ color: "#d8b4fe", marginBottom: 10 }}>Java</h2>

                <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 14 }}>
                  Leave blank for automatic: each instance gets the Java its Minecraft version needs,
                  downloaded from Mojang the first time. Or choose one Java for every instance; an
                  instance can still choose its own in its settings.
                  {javaRuntimes.length > 0 &&
                    ` Downloaded so far: ${javaRuntimes.map((runtime) => `Java ${runtime.majorVersion}`).join(", ")}.`}
                </p>

                <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                  <input
                    value={settings.javaPath}
                    onChange={(e) =>
                      setSettings({ ...settings, javaPath: e.target.value })
                    }
                    onBlur={() => patch({ javaPath: settings.javaPath })}
                    placeholder="Automatic"
                    style={{
                      flex: 1,
                      padding: 12,
                      borderRadius: 10,
                      background: "#1b1b1b",
                      color: "white",
                      border: "1px solid #6d28d9",
                    }}
                  />

                  <button
                    className="sidebar-button"
                    disabled={busy}
                    onClick={async () => {
                      const picked = await window.instanceAPI.pickJava();
                      if (picked) await load();
                    }}
                  >
                    Browse...
                  </button>
                </div>

                <p style={{ color: "#d8b4fe", marginBottom: 8 }}>
                  Default JVM arguments
                </p>

                <input
                  value={settings.jvmArgs}
                  onChange={(e) =>
                    setSettings({ ...settings, jvmArgs: e.target.value })
                  }
                  onBlur={() => patch({ jvmArgs: settings.jvmArgs })}
                  placeholder="-XX:+UseG1GC"
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
              </div>

              {/* ---------- Cloud ---------- */}
              <div style={card}>
                <h2 style={{ color: "#d8b4fe", marginBottom: 10 }}>
                  Cloud folder
                </h2>

                <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 14 }}>
                  Instances are backed up as a single zip into a folder your
                  cloud provider already syncs, so they appear on your other
                  machines without signing in to anything.
                </p>

                <div
                  style={{
                    color: settings.cloudFolder ? "#86efac" : "#fcd34d",
                    fontSize: 12,
                    marginBottom: 14,
                    wordBreak: "break-all",
                  }}
                >
                  {settings.cloudFolder ||
                    "No folder chosen. Backups go to OneDrive if it's installed on this computer."}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {cloudFolders.map((folder) => (
                    <button
                      key={folder.path}
                      className="sidebar-button"
                      disabled={busy}
                      style={{ fontSize: 12 }}
                      onClick={() => patch({ cloudFolder: folder.path })}
                    >
                      Use {folder.label}
                    </button>
                  ))}

                  <button
                    className="sidebar-button"
                    disabled={busy}
                    style={{ fontSize: 12 }}
                    onClick={async () => {
                      const picked = await window.instanceAPI.cloudPickFolder();
                      if (picked) await load();
                    }}
                  >
                    Choose folder...
                  </button>

                  {settings.cloudFolder && (
                    <button
                      className="sidebar-button"
                      disabled={busy}
                      style={{ fontSize: 12, background: "#7f1d1d" }}
                      onClick={() => patch({ cloudFolder: "" })}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <StarterModsSettings />

              {/* ---------- Account ---------- */}
              <div style={card}>
                <h2 style={{ color: "#d8b4fe", marginBottom: 10 }}>Account</h2>

                <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 12 }}>
                  The game launches as the account in use. Switch quickly from the bottom of the
                  sidebar. Bedrock uses these same Microsoft accounts.
                </p>

                {accounts.length === 0 ? (
                  <p style={{ color: "#fcd34d", marginBottom: 12 }}>
                    Not signed in, so instances launch in offline mode.
                  </p>
                ) : (
                  <div data-testid="accounts" style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                    {accounts.map((entry) => (
                      <div key={entry.uuid} data-testid="account-row" style={{ display: "flex", gap: 10, alignItems: "center", background: "#1b1b1b", borderRadius: 10, padding: "8px 10px" }}>
                        <span style={{ flex: 1, color: entry.active ? "#86efac" : "#e4e4e7" }}>
                          {entry.name}
                          {entry.active && <span style={{ color: "#6b7280", fontSize: 12 }}> · in use</span>}
                        </span>
                        {!entry.active && (
                          <button
                            className="sidebar-button"
                            style={{ padding: "4px 12px", fontSize: 12 }}
                            onClick={async () => {
                              setAccounts(await window.instanceAPI.switchAccount(entry.uuid));
                              setNotice(`Now playing as ${entry.name}.`);
                            }}
                          >
                            Use
                          </button>
                        )}
                        <button
                          className="sidebar-button"
                          style={{ padding: "4px 12px", fontSize: 12, background: "#7f1d1d" }}
                          onClick={async () => {
                            setAccounts(await window.instanceAPI.removeAccount(entry.uuid));
                            setNotice(`Signed ${entry.name} out.`);
                          }}
                        >
                          Sign out
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <AccountSwitcher />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MCSettings;
