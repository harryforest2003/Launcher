import { useEffect } from "react";
import { SAFE_PLAY } from "./shared";

type Props = {
  detail: GameDetail;
  /* Mods that hook into the game's code and are older than its update. */
  risky: GameMod[];
  onChoose: (choice: "safe" | "normal" | "cancel") => void;
};

/*
 * Before playing a game that's updated since it was last played: updates are what break
 * the mods that hook into a game's code, and a broken one can crash it at every start.
 * So this says so, names the mods most likely to need updating, and offers to play
 * without them. Play with them off has the focus; Escape cancels.
 */
export default function PlayPrompt({ detail, risky, onChoose }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onChoose("cancel");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onChoose]);

  const safe = SAFE_PLAY[detail.id];
  const versions = detail.updated?.from && detail.updated?.to ? ` (${detail.updated.from} → ${detail.updated.to})` : "";

  return (
    <div
      data-testid="play-prompt"
      onClick={() => onChoose("cancel")}
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0, 0, 0, 0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="play-prompt-title"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(540px, 100%)",
          background: "#17141f",
          border: "1px solid #6d28d9",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.6)",
          padding: "22px 24px 20px",
          textAlign: "left",
          color: "#e4e4e7",
        }}
      >
        <div id="play-prompt-title" style={{ fontSize: 17, fontWeight: 600, color: "#e9d5ff", marginBottom: 10 }}>
          {detail.name} has updated since you last played{versions}
        </div>
        <div style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.55, marginBottom: 14 }}>
          Game updates often break {safe.what}, and a broken one can crash the game every time it starts. Playing without them
          first is the safe way to check; turn them back on once their authors have updated them.
        </div>

        {risky.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "#fcd34d", marginBottom: 6 }}>
              {risky.length === 1 ? "This mod" : `These ${risky.length} mods`} may need updating:
            </div>
            <div style={{ maxHeight: 150, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {risky.map((mod) => (
                <div key={mod.key} style={{ fontSize: 13, color: "#e4e4e7", padding: "4px 8px", background: "#211c2b", borderRadius: 6 }}>
                  {mod.name}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="sidebar-button" style={{ padding: "8px 16px", fontSize: 13 }} onClick={() => onChoose("cancel")}>
            Cancel
          </button>
          <button className="sidebar-button" style={{ padding: "8px 16px", fontSize: 13 }} onClick={() => onChoose("normal")}>
            Play anyway
          </button>
          <button
            className="sidebar-button"
            autoFocus
            style={{ padding: "8px 16px", fontSize: 13, background: "#7c3aed", borderColor: "#a78bfa" }}
            onClick={() => onChoose("safe")}
          >
            {safe.button}
          </button>
        </div>
      </div>
    </div>
  );
}
