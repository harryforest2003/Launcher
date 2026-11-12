import BackgroundLogo from "../components/BackgroundLogo";
import { useEffect, useState } from "react";
import LauncherSidebar from "../components/LauncherSidebar";

type Props = {
  onMinecraft: () => void;
  onGame: (id: GameId) => void;
  onModManager: () => void;
  onSettings: () => void;
};

// These have their own sections; the Mod Manager ("More Games") covers the rest.
const OWN_SECTIONS = new Set(["sims4", "gtav", "skyrimse", "fallout4", "cyberpunk2077", "stardew"]);

/* What needs looking at, in a few words: "3 updates · load order problem". */
function needsLooking(status: GameStatus | undefined) {
  if (!status) return [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    status.crashes ? (status.crashes === 1 ? "crashed" : plural(status.crashes, "crash report", "crash reports")) : "",
    status.loadOrder ? "load order problem" : "",
    status.health ? plural(status.health, "mod folder problem", "mod folder problems") : "",
    status.requirements ? `${status.requirements} missing` : "",
    status.updates ? plural(status.updates, "update", "updates") : "",
  ].filter(Boolean);
}

function gameStatus(game: GameSummary, platform: string) {
  if (game.found) {
    const mods = `${game.modCount} mod${game.modCount === 1 ? "" : "s"} on`;
    return game.updated ? `Updated since you last played • ${mods}` : `Found via ${game.source} • ${mods}`;
  }
  if (game.windowsOnly && platform !== "Win32") return "Not found: it runs on Windows, or in CrossOver or Whisky on a Mac";
  return "Not found on this computer: open to choose its folder";
}

function HomeScreen({ onMinecraft, onGame, onModManager, onSettings }: Props) {
  // Real games found on this machine, rather than a hardcoded list.
  const [detected, setDetected] = useState<DetectedGame[]>([]);
  const [scanning, setScanning] = useState(true);
  const [games, setGames] = useState<GameSummary[]>([]);
  // What needs looking at in each game, filled in as each is worked out.
  const [statuses, setStatuses] = useState<Partial<Record<GameId, GameStatus>>>({});

  useEffect(() => {
    window.modAPI
      .getGames()
      .then((found) => setDetected(found.filter((game) => !game.managedByInstances && !OWN_SECTIONS.has(game.id))))
      .catch(() => setDetected([]))
      .finally(() => setScanning(false));
    window.gamesAPI
      .list()
      .then((found) => {
        setGames(found);
        for (const game of found.filter((g) => g.found)) {
          window.gamesAPI
            .status(game.id)
            .then((status) => setStatuses((now) => ({ ...now, [game.id]: status })))
            .catch(() => {});
        }
      })
      .catch(() => setGames([]));
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

            {games.map((game) => (
              <div
                key={game.id}
                className="game-card"
                data-testid="home-game"
                role="button"
                tabIndex={0}
                onClick={() => onGame(game.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onGame(game.id);
                  }
                }}
                style={{ cursor: "pointer" }}
              >
                <h3 style={{ color: "#c084fc", marginBottom: "15px", fontSize: "1.35rem" }}>{game.name}</h3>
                <p style={{ color: "#aaa", lineHeight: "1.6" }}>{game.tagline}. Play it, turn mods on and off, and find more.</p>
                <p style={{ color: game.updated ? "#fcd34d" : "#6b7280", fontSize: 12, marginTop: 10, fontFamily: "system-ui, sans-serif" }}>
                  {gameStatus(game, navigator.platform)}
                </p>
                {needsLooking(statuses[game.id]).length > 0 && (
                  <p
                    data-testid="home-game-status"
                    style={{
                      color: needsLooking(statuses[game.id]).some((t) => !/update/.test(t)) ? "#fcd34d" : "#c4b5fd",
                      fontSize: 12,
                      marginTop: 4,
                      fontFamily: "system-ui, sans-serif",
                    }}
                  >
                    {needsLooking(statuses[game.id]).join(" · ")}
                  </p>
                )}
              </div>
            ))}

            {/* Every other game the Mod Manager knows about. */}
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
                More Games
              </h3>

              <p style={{ color: "#aaa", lineHeight: "1.6" }}>
                {scanning
                  ? "Scanning for installed games..."
                  : detected.length === 0
                  ? "Palworld, Terraria, Baldur's Gate 3, Valheim and RimWorld: none found yet."
                  : `${detected.map((game) => game.name).join(", ")}. Manage their mods.`}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomeScreen;