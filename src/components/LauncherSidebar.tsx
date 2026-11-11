/*
 * The sidebar of the launcher's own pages (not a game's): the home screen, the Mod
 * Manager and the launcher's Settings.
 */
type Props = {
  current: "home" | "settings";
  onHome: () => void;
  onModManager: () => void;
  onSettings: () => void;
};

const selected: React.CSSProperties = { background: "#6d28d9", borderColor: "#a855f7" };

export default function LauncherSidebar({ current, onHome, onModManager, onSettings }: Props) {
  return (
    <div
      style={{
        width: "300px",
        flexShrink: 0,
        backgroundColor: "#161616",
        borderRight: "1px solid #6d28d9",
        padding: "20px",
      }}
    >
      <h1
        style={{
          color: "#a855f7",
          lineHeight: "1.1",
          letterSpacing: "1px",
          marginBottom: "60px",
        }}
      >
        Unity
        <br />
        Launcher
      </h1>

      <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
        <button
          className="sidebar-button"
          aria-current={current === "home" ? "page" : undefined}
          style={current === "home" ? selected : undefined}
          onClick={onHome}
        >
          Home
        </button>
        <button className="sidebar-button" onClick={onModManager}>
          Mod Manager
        </button>
        <button className="sidebar-button">Cloud Profiles</button>
        <button className="sidebar-button">Downloads</button>
        <button
          className="sidebar-button"
          aria-current={current === "settings" ? "page" : undefined}
          style={current === "settings" ? selected : undefined}
          onClick={onSettings}
        >
          Settings
        </button>
      </div>
    </div>
  );
}
