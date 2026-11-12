export type GamePage = "mods" | "discover" | "settings";

type Props = {
  game: string;
  current: GamePage | null;
  go: (page: GamePage) => void;
  showBack?: boolean;
  onBack?: () => void;
  onLauncher: () => void;
};

/* The sidebar of a game's section: its mods, finding more, and its settings. */
export default function GameSidebar({ game, current, go, showBack = false, onBack, onLauncher }: Props) {
  const buttonStyle = (active: boolean): React.CSSProperties => ({
    background: active ? "#6d28d9" : "#232323",
    color: "white",
    border: "1px solid #6d28d9",
    borderRadius: "10px",
    padding: "12px",
    cursor: "pointer",
    textAlign: "left",
    transition: "0.2s",
    width: "100%",
  });

  return (
    <div
      style={{
        width: "300px",
        flexShrink: 0,
        background: "#161616",
        borderRight: "1px solid #6d28d9",
        padding: "20px",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      }}
    >
      <h1 style={{ color: "#a855f7", lineHeight: "1.1", marginBottom: "14px" }}>
        Unity
        <br />
        Launcher
      </h1>
      <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 36 }}>{game}</div>

      <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
        {showBack && onBack && (
          <button className="sidebar-button" onClick={onBack} style={{ textAlign: "left" }}>
            ← Back
          </button>
        )}
        <button style={buttonStyle(current === "mods")} onClick={() => go("mods")} aria-current={current === "mods" ? "page" : undefined}>
          Mods
        </button>
        <button style={buttonStyle(current === "discover")} onClick={() => go("discover")} aria-current={current === "discover" ? "page" : undefined}>
          Discover Mods
        </button>
        <button style={buttonStyle(current === "settings")} onClick={() => go("settings")} aria-current={current === "settings" ? "page" : undefined}>
          Settings
        </button>
      </div>

      <button className="sidebar-button" onClick={onLauncher} style={{ position: "absolute", bottom: "20px", left: "20px", width: "260px" }}>
        ← Back to Launcher
      </button>
    </div>
  );
}
