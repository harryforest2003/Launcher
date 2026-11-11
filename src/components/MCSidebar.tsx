import { useContext } from "react";
import { SkinBuilderNavContext } from "../skinBuilder/navContext";

type Props = {
  currentPage:
    | "minecraft"
    | "discover"
    | "library"
    | "skins"
    | "skinbuilder"
    | "settings";

  goHome: () => void;
  goMinecraft: () => void;
  goDiscover: () => void;
  goLibrary: () => void;
  goSkinSelector: () => void;
  goSettings: () => void;

  showBack?: boolean;
  onBack?: () => void;
};

function MCSidebar({
  currentPage,
  goHome,
  goMinecraft,
  goDiscover,
  goLibrary,
  goSkinSelector,
  goSettings,
  showBack = false,
  onBack,
}: Props) {
  const goSkinBuilder = useContext(SkinBuilderNavContext);

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
        background: "#161616",
        borderRight: "1px solid #6d28d9",
        padding: "20px",
        position: "relative",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <h1
        style={{
          color: "#a855f7",
          lineHeight: "1.1",
          marginBottom: "60px",
        }}
      >
        Unity
        <br />
        Launcher
      </h1>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "15px",
        }}
      >
        {showBack && onBack && (
          <button
            className="sidebar-button"
            onClick={onBack}
            style={{ textAlign: "left" }}
          >
            ← Back
          </button>
        )}

        <button
          style={buttonStyle(currentPage === "minecraft")}
          onClick={goMinecraft}
        >
          Home
        </button>

        <button
          style={buttonStyle(currentPage === "discover")}
          onClick={goDiscover}
        >
          Discover Content
        </button>

        <button
          style={buttonStyle(currentPage === "skins")}
          onClick={goSkinSelector}
        >
          Skin Selector
        </button>

        {goSkinBuilder && (
          <button
            style={buttonStyle(currentPage === "skinbuilder")}
            onClick={goSkinBuilder}
          >
            Model Builder
          </button>
        )}

        <button
          style={buttonStyle(currentPage === "library")}
          onClick={goLibrary}
        >
          Library
        </button>

        <button
          style={buttonStyle(currentPage === "settings")}
          onClick={goSettings}
        >
          Settings
        </button>
      </div>

      <button
        className="sidebar-button"
        onClick={goHome}
        style={{
          position: "absolute",
          bottom: "20px",
          left: "20px",
          width: "260px",
        }}
      >
        ← Back to Launcher
      </button>
    </div>
  );
}

export default MCSidebar;