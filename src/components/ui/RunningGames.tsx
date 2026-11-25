import { useEffect, useState } from "react";
import { Gamepad2 } from "lucide-react";
import { requestOpenInstance } from "../../utils/launchRequests";

/*
 * The Minecraft instances open right now, kept up to date from the game's start and exit
 * events, so every page can show that something is running (the sidebar does).
 */
function useRunningInstances() {
  const [running, setRunning] = useState<Record<string, GamePlayer | null>>({});

  useEffect(() => {
    const api = window.instanceAPI;
    if (!api?.playing) return;
    let live = true;
    const look = () =>
      api
        .playing()
        .then((now) => live && setRunning(now ?? {}))
        .catch(() => {});
    void look();
    const offStarted = api.onStarted(({ name, account }) => {
      setRunning((now) => ({ ...now, [name]: account }));
      void look();
    });
    const offExit = api.onExit(({ name }) => {
      setRunning((now) => {
        const next = { ...now };
        delete next[name];
        return next;
      });
    });
    return () => {
      live = false;
      offStarted();
      offExit();
    };
  }, []);

  return running;
}

/*
 * In the sidebar's footer while a game is open: what's running (and as whom), from any page.
 * Clicking it opens that instance in the Library. Nothing shows while nothing runs.
 */
export default function RunningGames({ tip, onOpen }: { tip: (label: string) => string | undefined; onOpen: () => void }) {
  const running = useRunningInstances();
  const names = Object.keys(running);
  if (!names.length) return null;

  const first = names[0];
  const player = running[first]?.name;
  const label = names.length === 1 ? `Playing ${first}` : `${names.length} games running`;
  const detail = names.length === 1 ? (player ? `as ${player}` : "Running") : names.join(", ");

  return (
    <button
      type="button"
      className="ui-shell__item ui-shell__running"
      data-testid="running-games"
      aria-label={`${label}${names.length === 1 && player ? ` as ${player}` : ""}. Open it`}
      data-tip={tip(names.length === 1 ? `${label}${player ? ` as ${player}` : ""}` : `${label}: ${detail}`)}
      onClick={() => {
        requestOpenInstance(first);
        onOpen();
      }}
    >
      <span className="ui-shell__icon">
        <Gamepad2 size={16} aria-hidden="true" />
        <span className="ui-shell__dot ui-shell__dot--live" aria-hidden="true" />
      </span>
      <span className="ui-shell__label ui-shell__running-text">
        <span className="ui-shell__running-name">{label}</span>
        <span className="ui-shell__running-meta">{detail}</span>
      </span>
    </button>
  );
}
