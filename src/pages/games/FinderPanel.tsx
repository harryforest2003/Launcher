import { useState } from "react";
import { Bug, Play } from "lucide-react";
import { Button } from "../../components/ui";

type Props = {
  detail: GameDetail;
  finder: GameFinder;
  busy: boolean;
  playing: string | null;
  onPlay: () => void;
  onAnswer: (happened: boolean) => void;
  onStop: (keepOff: string | null) => void;
};

/*
 * Finding the mod that breaks the game, a round at a time: play, try whatever went
 * wrong, and say whether it happened. Shown at the top of the Mods page until it's done.
 */
export default function FinderPanel({ detail, finder, busy, playing, onPlay, onAnswer, onStop }: Props) {
  const [showList, setShowList] = useState(false);
  const { phase } = finder;

  return (
    <div className="gm-finder" data-testid="finder">
      <div className="gm-finder__head">
        <Bug size={18} aria-hidden="true" />
        <span className="gm-finder__title">
          {phase === "found" ? "Found it" : phase === "not-mods" ? "It isn't one of your mods" : `Finding a broken mod: round ${finder.round! + 1}`}
        </span>
        {phase !== "found" && phase !== "not-mods" && (
          <span className="gm-finder__meta">
            about {finder.roundsLeft} round{finder.roundsLeft === 1 ? "" : "s"} to go
          </span>
        )}
      </div>

      {phase === "baseline" && (
        <div className="gm-finder__text">
          Every mod is off for now ({finder.total}). Play, try whatever went wrong before, then close the game and say whether it happened.
          {finder.backedUp ? " Your saves were backed up first." : ""}
        </div>
      )}
      {phase === "split" && (
        <div className="gm-finder__text">
          {finder.testing!.length} of the {finder.suspects!.length} mods it could still be {finder.testing!.length === 1 ? "is" : "are"} on;{" "}
          {finder.suspects!.length - finder.testing!.length === 1 ? "the other is" : "the others are"} off. Play, try it again, then close
          the game and say whether it happened.{" "}
          <button type="button" className="gm-link" onClick={() => setShowList((now) => !now)}>
            {showList ? "Hide which" : "Show which"}
          </button>
          {showList && (
            <div className="gm-finder__lists">
              <div>
                <div className="gm-finder__list-title gm-finder__list-title--on">On this round</div>
                {finder.testing!.map((name) => (
                  <div key={name}>{name}</div>
                ))}
              </div>
              <div>
                <div className="gm-finder__list-title gm-finder__list-title--off">Off this round</div>
                {finder.suspects!.filter((name) => !finder.testing!.includes(name)).map((name) => (
                  <div key={name}>{name}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {phase === "found" && (
        <div className="gm-finder__text">
          <b className="gm-finder__found">{finder.found}</b> is the one: the problem happens with it on and not without it. Leave it off until its author
          updates it (or remove it), and put the rest back as they were.
        </div>
      )}
      {phase === "not-mods" && (
        <div className="gm-finder__text">
          It happened with every mod off, so it's the game itself (or something outside the launcher: a mod it doesn't manage, or the game's own
          files). Put your mods back; verifying the game's files in Steam or the EA app is worth a try.
        </div>
      )}

      <div className="gm-finder__buttons">
        {(phase === "baseline" || phase === "split") && (
          <>
            <Button variant="primary" icon={<Play size={16} fill="currentColor" aria-hidden="true" />} onClick={onPlay}>
              {playing ?? `Play ${detail.name}`}
            </Button>
            <Button data-testid="finder-happened" onClick={() => !busy && onAnswer(true)}>
              It happened
            </Button>
            <Button data-testid="finder-fine" onClick={() => !busy && onAnswer(false)}>
              It didn't happen
            </Button>
            <span className="gm-spacer" />
            <Button variant="ghost" onClick={() => !busy && onStop(null)}>
              Stop and put everything back
            </Button>
          </>
        )}
        {phase === "found" && (
          <>
            <Button variant="primary" data-testid="finder-keep-off" onClick={() => !busy && onStop(finder.foundKey ?? null)}>
              Keep it off, put the rest back
            </Button>
            <Button onClick={() => !busy && onStop(null)}>Put everything back</Button>
          </>
        )}
        {phase === "not-mods" && (
          <Button variant="primary" onClick={() => !busy && onStop(null)}>
            Put my mods back
          </Button>
        )}
      </div>
    </div>
  );
}
