import { useEffect, useRef, useState } from "react";
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
export default function DownloadQueue({ hidden = false, onOpenAll }: { hidden?: boolean; onOpenAll?: () => void }) {
  const { queue, left, shown, hide } = useDownloads();
  const [open, setOpen] = useState(false);
  // Shows from when something starts downloading until it's closed: earlier history stays
  // on the Downloads page rather than in the corner.
  const [active, setActive] = useState(false);
  // When this run of downloads began: the panel counts only what was added since.
  const [since, setSince] = useState(0);
  const box = useRef<HTMLElement>(null);
  if (left && queue) {
    const waiting = queue.items.filter((i) => i.status === "waiting" || i.status === "working" || i.status === "website");
    const stamps = waiting.map((i) => Date.parse(i.addedAt ?? "")).filter(Boolean);
    // Items from before times were kept: count from the newest thing in the history instead.
    const latest = Math.max(0, ...queue.items.map((i) => Date.parse(i.finishedAt ?? i.addedAt ?? "") || 0));
    const first = stamps.length ? Math.min(...stamps) : latest + 1;
    const next = active && since ? Math.min(since, first) : first;
    if (!active) setActive(true);
    if (Number.isFinite(next) && next !== since) setSince(next);
  }

  // Escape folds the list, then closes the panel; a click elsewhere closes a panel opened
  // from the sidebar. A running queue keeps its small progress bar either way.
  useEffect(() => {
    if (!shown && !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (open) setOpen(false);
      else hide();
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!shown || !target || box.current?.contains(target) || target.closest("[data-downloads-toggle]")) return;
      hide();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [shown, open, hide]);

  const isOpen = (i: GameQueueItem) => i.status === "waiting" || i.status === "working" || i.status === "website";
  const run = (queue?.items ?? []).filter((i) => isOpen(i) || (active && (Date.parse(i.addedAt ?? "") || 0) >= since));
  const counts = queue
    ? {
        total: run.length,
        failed: run.filter((i) => i.status === "failed").length,
        finished: run.filter((i) => !isOpen(i)).length,
      }
    : null;
  const finished = counts?.finished ?? 0;
  const hasQueue = Boolean(counts && counts.total > 0 && (left || active));
  if (hidden || (!hasQueue && !shown)) return null;

  // Opened from the sidebar with nothing queued.
  if (!hasQueue || !queue || !counts) {
    return (
      <section ref={box} className="ui-queue" data-testid="download-queue" aria-label="Downloads">
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
    <section ref={box} className="ui-queue" data-testid="download-queue" aria-label="Downloads">
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
        {(shown || !left) && (
          <button
            type="button"
            className="ui-queue__icon-button"
            onClick={() => {
              setActive(false);
              setOpen(false);
              hide();
            }}
            aria-label="Close downloads"
          >
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
        {onOpenAll && (
          <Button size="sm" variant="ghost" onClick={onOpenAll}>
            See all
          </Button>
        )}
      </div>

      {open && (
        <ul className="ui-queue__list">
          {run.map((item) => (
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
