import { useEffect, useState } from "react";
import logo from "../assets/logo.png";
import ApiKeyRow from "../components/ApiKeyRow";
import LauncherSidebar from "../components/LauncherSidebar";

type Props = {
  onHome: () => void;
  onModManager: () => void;
};

const card: React.CSSProperties = {
  background: "#151515",
  border: "1px solid #6d28d9",
  borderRadius: 12,
  padding: 20,
  maxWidth: 760,
};

/* Settings for the launcher as a whole, rather than for one game. */
export default function LauncherSettings({ onHome, onModManager }: Props) {
  const [apiKeys, setApiKeys] = useState<Awaited<ReturnType<typeof window.instanceAPI.getApiKeys>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.instanceAPI
      .getApiKeys()
      .then(setApiKeys)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        backgroundColor: "#0d0d0d",
        color: "white",
        fontFamily: "'Orbitron', sans-serif",
      }}
    >
      <LauncherSidebar current="settings" onHome={onHome} onModManager={onModManager} onSettings={() => {}} />

      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <img
          src={logo}
          alt=""
          style={{
            position: "absolute",
            top: "45%",
            left: "55%",
            transform: "translate(-50%, -50%) rotate(-18deg)",
            width: "90%",
            maxWidth: "1400px",
            opacity: 0.12,
            filter: "drop-shadow(0 0 40px rgba(168,85,247,0.3))",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />

        <div style={{ position: "relative", zIndex: 1, padding: "35px", height: "100%", overflowY: "auto", boxSizing: "border-box" }}>
          <h1 style={{ color: "#c084fc", marginBottom: 10 }}>Settings</h1>
          <p style={{ color: "#9ca3af", marginBottom: 30 }}>For the launcher as a whole. Minecraft has its own settings.</p>

          {error && (
            <p role="alert" style={{ color: "#fca5a5", marginBottom: 20 }}>
              {error}
            </p>
          )}

          <div style={card} data-testid="personal-tokens">
            <h2 style={{ color: "#d8b4fe", marginBottom: 6 }}>Personal API tokens</h2>

            <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 4 }}>
              Tokens from your own accounts. The launcher works without them; each one adds something
              for you. They're encrypted with your system's keychain, and each is only ever sent to the
              service it belongs to.
            </p>

            <ApiKeyRow
              name="modrinth"
              label="Modrinth"
              environmentVariable="MODRINTH_TOKEN"
              status={apiKeys?.modrinth}
              onChange={setApiKeys}
            >
              Lets the launcher see your own unlisted and draft projects. Browsing and installing don't
              need it. Create one at modrinth.com/settings/pats.
            </ApiKeyRow>

            <ApiKeyRow
              name="nexus"
              label="Nexus Mods"
              environmentVariable="NEXUS_API_KEY"
              status={apiKeys?.nexus}
              onChange={setApiKeys}
            >
              Needed to browse Nexus Mods in the Mod Manager. Find yours on nexusmods.com, in your
              account's API Keys settings.
            </ApiKeyRow>

            <ApiKeyRow
              name="github"
              label="GitHub"
              environmentVariable="GITHUB_TOKEN"
              status={apiKeys?.github}
              onChange={setApiKeys}
            >
              Installs from GitHub allow 60 lookups an hour without one, and 5,000 with one. Create one
              at github.com/settings/tokens; it needs no permissions.
            </ApiKeyRow>
          </div>
        </div>
      </div>
    </div>
  );
}
