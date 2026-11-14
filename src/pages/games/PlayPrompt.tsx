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
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: "var(--color-scrim)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="play-prompt-title"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(540px, 100%)",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          boxShadow: "0 20px 60px var(--color-shadow)",
          padding: "22px 24px 20px",
          textAlign: "left",
          color: "var(--color-text-secondary)",
        }}
      >
        <div id="play-prompt-title" style={{ fontSize: 17, fontWeight: 600, color: "var(--color-accent-text)", marginBottom: 10 }}>
          {detail.name} has updated since you last played{versions}
        </div>
        <div style={{ fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.55, marginBottom: 14 }}>
          Game updates often break {safe.what}, and a broken one can crash the game every time it starts. Playing without them
          first is the safe way to check; turn them back on once their authors have updated them.
        </div>

        {risky.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "var(--color-warning-text)", marginBottom: 6 }}>
              {risky.length === 1 ? "This mod" : `These ${risky.length} mods`} may need updating:
            </div>
            <div style={{ maxHeight: 150, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {risky.map((mod) => (
                <div key={mod.key} style={{ fontSize: 13, color: "var(--color-text-secondary)", padding: "4px 8px", background: "var(--color-accent-subtle)", borderRadius: 6 }}>
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
            style={{ padding: "8px 16px", fontSize: 13, background: "var(--color-accent)", color: "var(--color-on-accent)", borderColor: "var(--color-accent-line)" }}
            onClick={() => onChoose("safe")}
          >
            {safe.button}
          </button>
        </div>
      </div>
    </div>
  );
}
