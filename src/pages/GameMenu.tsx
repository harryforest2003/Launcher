import BackgroundLogo from "../components/BackgroundLogo";
import { useEffect, useState } from "react";
import LauncherSidebar from "../components/LauncherSidebar";

type Props = {
  onMinecraft: () => void;
  onModManager: () => void;
  onSettings: () => void;
};

function HomeScreen({ onMinecraft, onModManager, onSettings }: Props) {
  // Real games found on this machine, rather than a hardcoded list.
  const [detected, setDetected] = useState<DetectedGame[]>([]);
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    window.modAPI
      .getGames()
      .then(setDetected)
      .catch(() => setDetected([]))
      .finally(() => setScanning(false));
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
      <LauncherSidebar current="home" onHome={() => {}} onModManager={onModManager} onSettings={onSettings} />

      {/* Main Content */}
      <div
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background Logo */}
        <BackgroundLogo />

        {/* Foreground, scrolling when the games don't all fit */}
        <div
          style={{
            position: "relative",
            zIndex: 1,
            padding: "30px",
            height: "100%",
            overflowY: "auto",
            boxSizing: "border-box",
          }}
        >
          <h2
            style={{
              color: "#c084fc",
              fontSize: "2rem",
              marginBottom: "40px",
            }}
          >
            Games
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fill,minmax(280px,1fr))",
              gap: "35px",
            }}
          >
            {/* Minecraft is always available — it has its own instance system. */}
            <div
              className="game-card"
              onClick={onMinecraft}
              style={{ cursor: "pointer" }}
            >
              <h3
                style={{
                  color: "#c084fc",
                  marginBottom: "15px",
                  fontSize: "1.35rem",
                }}
              >
                Minecraft
              </h3>

              <p style={{ color: "#aaa", lineHeight: "1.6" }}>
                Launch Minecraft, manage instances, mods, skins and accounts.
              </p>
            </div>

            {detected
              .filter((g) => !g.managedByInstances)
              .map((game) => (
                <div
                  key={game.id}
                  className="game-card"
                  onClick={onModManager}
                  style={{ cursor: "pointer" }}
                >
                  <h3
                    style={{
                      color: "#c084fc",
                      marginBottom: "15px",
                      fontSize: "1.35rem",
                    }}
                  >
                    {game.name}
                  </h3>

                  <p style={{ color: "#aaa", lineHeight: "1.6" }}>
                    Found via {game.source}. Browse, install, enable and
                    disable mods.
                  </p>
                </div>
              ))}

            {/* Entry point even when nothing was detected. */}
            <div
              className="game-card"
              onClick={onModManager}
              style={{ cursor: "pointer" }}
            >
              <h3
                style={{
                  color: "#c084fc",
                  marginBottom: "15px",
                  fontSize: "1.35rem",
                }}
              >
                Mod Manager
              </h3>

              <p style={{ color: "#aaa", lineHeight: "1.6" }}>
                {scanning
                  ? "Scanning for installed games..."
                  : detected.length === 0
                  ? "No games detected yet — open to rescan or install from a file."
                  : `${detected.length} game${
                      detected.length === 1 ? "" : "s"
                    } detected. Manage mods for all of them.`}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomeScreen;