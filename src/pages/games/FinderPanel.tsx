import { useState } from "react";
import { Bug, Play } from "lucide-react";
import { smallButton } from "./shared";

type Props = {
  detail: GameDetail;
  finder: GameFinder;
  busy: boolean;
  playing: string | null;
  onPlay: () => void;
  onAnswer: (happened: boolean) => void;
  onStop: (keepOff: string | null) => void;
};

const box: React.CSSProperties = {
  padding: 16,
  borderRadius: 12,
  background: "var(--color-surface)",
  border: "1px solid var(--color-accent-line)",
  boxShadow: "0 0 18px var(--color-accent-glow)",
};

const answer: React.CSSProperties = { ...smallButton, padding: "10px 16px" };

/*
 * Finding the mod that breaks the game, a round at a time: play, try whatever went
 * wrong, and say whether it happened. Shown at the top of the Mods page until it's done.
 */
export default function FinderPanel({ detail, finder, busy, playing, onPlay, onAnswer, onStop }: Props) {
  const [showList, setShowList] = useState(false);
  const { phase } = finder;

  return (
    <div style={box} data-testid="finder">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <Bug size={20} color="var(--color-accent-text)" />
        <span style={{ fontSize: 16, fontWeight: 600, color: "var(--color-accent-text)", flex: 1 }}>
          {phase === "found" ? "Found it" : phase === "not-mods" ? "It isn't one of your mods" : `Finding a broken mod: round ${finder.round! + 1}`}
        </span>
        {phase !== "found" && phase !== "not-mods" && (
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            about {finder.roundsLeft} round{finder.roundsLeft === 1 ? "" : "s"} to go
          </span>
        )}
      </div>

      {phase === "baseline" && (
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          Every mod is off for now ({finder.total}). Play, try whatever went wrong before, then close the game and say whether it happened.
          {finder.backedUp ? " Your saves were backed up first." : ""}
        </div>
      )}
      {phase === "split" && (
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          {finder.testing!.length} of the {finder.suspects!.length} mods it could still be {finder.testing!.length === 1 ? "is" : "are"} on;{" "}
          {finder.suspects!.length - finder.testing!.length === 1 ? "the other is" : "the others are"} off. Play, try it again, then close
          the game and say whether it happened.{" "}
          <button onClick={() => setShowList((now) => !now)} style={{ background: "none", border: "none", padding: 0, color: "var(--color-accent-text)", cursor: "pointer", font: "inherit", textDecoration: "underline" }}>
            {showList ? "Hide which" : "Show which"}
          </button>
          {showList && (
            <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--color-success-text)", marginBottom: 4 }}>On this round</div>
                {finder.testing!.map((name) => (
                  <div key={name} style={{ color: "var(--color-text-secondary)" }}>
                    {name}
                  </div>
                ))}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--color-danger-text)", marginBottom: 4 }}>Off this round</div>
                {finder.suspects!.filter((name) => !finder.testing!.includes(name)).map((name) => (
                  <div key={name} style={{ color: "var(--color-text-secondary)" }}>
                    {name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {phase === "found" && (
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          <b style={{ color: "var(--color-warning-text)" }}>{finder.found}</b> is the one: the problem happens with it on and not without it. Leave it off until its author
          updates it (or remove it), and put the rest back as they were.
        </div>
      )}
      {phase === "not-mods" && (
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          It happened with every mod off, so it's the game itself (or something outside the launcher: a mod it doesn't manage, or the game's own
          files). Put your mods back; verifying the game's files in Steam or the EA app is worth a try.
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        {(phase === "baseline" || phase === "split") && (
          <>
            <button className="sidebar-button" style={{ ...answer, display: "flex", alignItems: "center", gap: 8, background: "var(--color-accent)", color: "var(--color-on-accent)", borderColor: "var(--color-accent-line)" }} onClick={onPlay}>
              <Play size={16} fill="currentColor" />
              {playing ?? `Play ${detail.name}`}
            </button>
            <button className="sidebar-button" data-testid="finder-happened" style={answer} onClick={() => !busy && onAnswer(true)}>
              It happened
            </button>
            <button className="sidebar-button" data-testid="finder-fine" style={answer} onClick={() => !busy && onAnswer(false)}>
              It didn't happen
            </button>
            <span style={{ flex: 1 }} />
            <button className="sidebar-button" style={answer} onClick={() => !busy && onStop(null)}>
              Stop and put everything back
            </button>
          </>
        )}
        {phase === "found" && (
          <>
            <button className="sidebar-button" data-testid="finder-keep-off" style={{ ...answer, background: "var(--color-accent)", color: "var(--color-on-accent)", borderColor: "var(--color-accent-line)" }} onClick={() => !busy && onStop(finder.foundKey ?? null)}>
              Keep it off, put the rest back
            </button>
            <button className="sidebar-button" style={answer} onClick={() => !busy && onStop(null)}>
              Put everything back
            </button>
          </>
        )}
        {phase === "not-mods" && (
          <button className="sidebar-button" style={{ ...answer, background: "var(--color-accent)", color: "var(--color-on-accent)", borderColor: "var(--color-accent-line)" }} onClick={() => !busy && onStop(null)}>
            Put my mods back
          </button>
        )}
      </div>
    </div>
  );
}
