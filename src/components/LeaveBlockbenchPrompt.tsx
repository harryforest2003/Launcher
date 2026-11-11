import { useEffect, useState } from "react";
import blockbenchLogo from "../assets/blockbench-logo.svg";
import { setLeaveAsker, type LeaveChoice } from "./leaveBlockbench";

/*
 * Asks whether to save Blockbench's changes before leaving it, in the launcher's own
 * style rather than the system's. Mounted once, beside the app; leaveBlockbench asks it.
 * Save changes has the focus, so Enter saves; Escape stays.
 */
export default function LeaveBlockbenchPrompt() {
  const [answer, setAnswer] = useState<((choice: LeaveChoice) => void) | null>(null);

  useEffect(
    () =>
      setLeaveAsker(
        () =>
          new Promise<LeaveChoice>((resolve) =>
            setAnswer(() => (choice: LeaveChoice) => {
              setAnswer(null);
              resolve(choice);
            })
          )
      ),
    []
  );

  useEffect(() => {
    if (!answer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") answer("cancel");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer]);

  if (!answer) return null;

  return (
    <div
      data-testid="leave-blockbench"
      onClick={() => answer("cancel")}
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0, 0, 0, 0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-blockbench-title"
        aria-describedby="leave-blockbench-detail"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(460px, 100%)",
          background: "#17141f",
          border: "1px solid #6d28d9",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.6)",
          padding: "22px 24px 20px",
          textAlign: "left",
          color: "#e4e4e7",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <img src={blockbenchLogo} alt="" style={{ width: 30, height: 30, flexShrink: 0 }} />
          <div id="leave-blockbench-title" style={{ fontSize: 17, fontWeight: 600, color: "#e9d5ff" }}>
            Save your changes before leaving Blockbench?
          </div>
        </div>
        <div id="leave-blockbench-detail" style={{ fontSize: 13, color: "#9ca3af", marginBottom: 20 }}>
          They haven't been saved back to Unity Launcher yet.
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="sidebar-button" style={{ padding: "8px 16px", fontSize: 13 }} onClick={() => answer("cancel")}>
            Cancel
          </button>
          <button
            className="sidebar-button"
            style={{ padding: "8px 16px", fontSize: 13, borderColor: "#b91c4b", color: "#fda4af" }}
            onClick={() => answer("discard")}
          >
            Exit without saving
          </button>
          <button
            className="sidebar-button"
            autoFocus
            style={{ padding: "8px 16px", fontSize: 13, background: "#7c3aed", borderColor: "#a78bfa" }}
            onClick={() => answer("save")}
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
