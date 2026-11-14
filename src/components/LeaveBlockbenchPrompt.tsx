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
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: "var(--color-scrim)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-blockbench-title"
        aria-describedby="leave-blockbench-detail"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(460px, 100%)",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          boxShadow: "0 20px 60px var(--color-shadow)",
          padding: "22px 24px 20px",
          textAlign: "left",
          color: "var(--color-text-secondary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <img src={blockbenchLogo} alt="" style={{ width: 30, height: 30, flexShrink: 0 }} />
          <div id="leave-blockbench-title" style={{ fontSize: 17, fontWeight: 600, color: "var(--color-accent-text)" }}>
            Save your changes before leaving Blockbench?
          </div>
        </div>
        <div id="leave-blockbench-detail" style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 20 }}>
          They haven't been saved back to Unity Launcher yet.
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="sidebar-button" style={{ padding: "8px 16px", fontSize: 13 }} onClick={() => answer("cancel")}>
            Cancel
          </button>
          <button
            className="sidebar-button"
            style={{ padding: "8px 16px", fontSize: 13, borderColor: "var(--color-danger-border)", color: "var(--color-danger-text)" }}
            onClick={() => answer("discard")}
          >
            Exit without saving
          </button>
          <button
            className="sidebar-button"
            autoFocus
            style={{ padding: "8px 16px", fontSize: 13, background: "var(--color-accent)", color: "var(--color-on-accent)", borderColor: "var(--color-accent-line)" }}
            onClick={() => answer("save")}
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
