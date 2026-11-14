import { useState } from "react";
import { ChevronDown, ChevronUp, Download, X } from "lucide-react";
import Button from "./ui/Button";
import { useDownloads } from "./ui/downloadsContext";

const GAME_NAMES: Record<string, string> = {
  sims4: "The Sims 4",
  gtav: "GTA V",
  skyrimse: "Skyrim",
  fallout4: "Fallout 4",
  cyberpunk2077: "Cyberpunk 2077",
  stardew: "Stardew Valley",
};

const STATUS: Record<GameQueueItem["status"], string> = {
  waiting: "Waiting",
  working: "Getting it",
  website: "On Nexus Mods",
  done: "Done",
  failed: "Didn't work",
  skipped: "Skipped",
};

/*
 * The game sections' downloads, on every page: what's being got now, how many are left,
 * and for a free Nexus account, which page to press the download button on. The sidebar's
 * Downloads button opens it even when nothing is queued.
 */
export default function DownloadQueue() {
  const { queue, left, shown, hide } = useDownloads();
  const [open, setOpen] = useState(false);

  const counts = queue?.counts;
  const finished = counts ? counts.done + counts.failed + counts.skipped : 0;
  const hasQueue = Boolean(counts && counts.total > 0 && (left || open || finished));
  if (!hasQueue && !shown) return null;

  // Opened from the sidebar with nothing queued.
  if (!hasQueue || !queue || !counts) {
    return (
      <section className="ui-queue" data-testid="download-queue" aria-label="Downloads">
        <div className="ui-queue__head">
          <Download size={16} aria-hidden="true" />
          <span className="ui-queue__title">Downloads</span>
          <button type="button" className="ui-queue__icon-button" onClick={hide} aria-label="Close downloads">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="ui-queue__empty">
          Nothing downloading. Updates, missing requirements and collections you get for your games line up here and
          carry on whichever page you're on.
        </p>
      </section>
    );
  }

  const { current } = queue;
  const fraction = counts.total ? finished / counts.total : 0;

  return (
    <section className="ui-queue" data-testid="download-queue" aria-label="Downloads">
      <div className="ui-queue__head">
        <Download size={16} aria-hidden="true" />
        <span className="ui-queue__title" aria-live="polite">
          Downloads:{" "}
          <span className="ui-queue__count">
            {left ? `${left} to go` : `all done${counts.failed ? ` (${counts.failed} didn't work)` : ""}`}
          </span>
        </span>
        <button
          type="button"
          className="ui-queue__icon-button"
          onClick={() => setOpen((now) => !now)}
          aria-label={open ? "Hide the list" : "Show the list"}
          aria-expanded={open}
        >
          {open ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronUp size={18} aria-hidden="true" />}
        </button>
        {shown && (
          <button type="button" className="ui-queue__icon-button" onClick={hide} aria-label="Close downloads">
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <div
        className="ui-queue__track"
        role="progressbar"
        aria-label="Downloads finished"
        aria-valuemin={0}
        aria-valuemax={counts.total}
        aria-valuenow={finished}
      >
        <div className="ui-queue__fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>

      {current && (
        <div className="ui-queue__current" data-testid="queue-current">
          <div className="ui-queue__name">
            {current.name} <span className="ui-queue__game">in {GAME_NAMES[current.gameId] ?? current.gameId}</span>
          </div>
          <div className={`ui-queue__detail${current.status === "website" ? " ui-queue__detail--website" : ""}`}>
            {current.status === "website"
              ? "Press the download button on the Nexus Mods page that opened; the launcher installs it and opens the next."
              : (current.detail ?? "Getting it...")}
          </div>
        </div>
      )}

      <div className="ui-queue__actions">
        {current?.status === "website" && (
          <>
            <Button size="sm" variant="secondary" onClick={() => window.gamesAPI.queueControl("open")}>
              Open the page again
            </Button>
            <Button size="sm" variant="secondary" onClick={() => window.gamesAPI.queueControl("skip")}>
              Skip this one
            </Button>
          </>
        )}
        {left > 0 && (
          <Button size="sm" variant="ghost" onClick={() => window.gamesAPI.queueControl("stop")}>
            Stop
          </Button>
        )}
        {counts.failed > 0 && (
          <Button size="sm" variant="secondary" onClick={() => window.gamesAPI.queueControl("retry")}>
            Try failed again
          </Button>
        )}
        {!left && (
          <Button size="sm" variant="ghost" onClick={() => window.gamesAPI.queueControl("clear")}>
            Clear
          </Button>
        )}
      </div>

      {open && (
        <ul className="ui-queue__list">
          {queue.items.map((item) => (
            <li key={item.id} className="ui-queue__row">
              <span className="ui-queue__row-name" title={item.error ?? undefined}>
                {item.name} <span className="ui-queue__game">in {GAME_NAMES[item.gameId] ?? item.gameId}</span>
              </span>
              <span className={`ui-queue__status ui-queue__status--${item.status}`}>{STATUS[item.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
