import { useContext, useRef } from "react";
import AccountSwitcher from "./AccountSwitcher";
import { SkinBuilderNavContext } from "../skinBuilder/navContext";
import { leaveBlockbench } from "./leaveBlockbench";

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

  // Every button here leaves the page, so each closes Blockbench first, as Done would:
  // with unsaved changes it asks whether to save them, and Cancel stays on the page.
  // A second press while it's still asking does nothing.
  const leaving = useRef(false);
  const go = (to: (() => void) | null | undefined) => async () => {
    if (!to || leaving.current) return;
    leaving.current = true;
    try {
      if (await leaveBlockbench()) to();
    } finally {
      leaving.current = false;
    }
  };

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
            onClick={go(onBack)}
            style={{ textAlign: "left" }}
          >
            ← Back
          </button>
        )}

        <button
          style={buttonStyle(currentPage === "minecraft")}
          onClick={go(goMinecraft)}
        >
          Home
        </button>

        <button
          style={buttonStyle(currentPage === "discover")}
          onClick={go(goDiscover)}
        >
          Discover Content
        </button>

        <button
          style={buttonStyle(currentPage === "skins")}
          onClick={go(goSkinSelector)}
        >
          Skin Selector
        </button>

        {goSkinBuilder && (
          <button
            style={buttonStyle(currentPage === "skinbuilder")}
            onClick={go(goSkinBuilder)}
          >
            Model Builder
          </button>
        )}

        <button
          style={buttonStyle(currentPage === "library")}
          onClick={go(goLibrary)}
        >
          Library
        </button>

        <button
          style={buttonStyle(currentPage === "settings")}
          onClick={go(goSettings)}
        >
          Settings
        </button>
      </div>

      <div style={{ position: "absolute", bottom: "78px", left: "20px", width: "260px" }}>
        <AccountSwitcher compact />
      </div>

      <button
        className="sidebar-button"
        onClick={go(goHome)}
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