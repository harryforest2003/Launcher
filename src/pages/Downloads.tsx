import { useMemo, useState } from "react";
import { Download, ExternalLink, RotateCcw, SkipForward, Square, Trash2, X } from "lucide-react";
import { Badge, Button, EmptyState, Segmented } from "../components/ui";
import type { Tone } from "../components/ui";
import { useDownloads } from "../components/ui/downloadsContext";
import { usePageNav } from "../components/ui/shellContext";
import "../theme/appearance.css";

/*
 * Every download the game sections queue (updates, missing requirements, collection files):
 * what's being got now, what waits, and what finished, with why something didn't work and
 * a way to try it again. The corner panel only follows what's running; this keeps the rest.
 */

const GAME_NAMES: Record<string, string> = {
  sims4: "The Sims 4",
  gtav: "GTA V",
  skyrimse: "Skyrim",
  fallout4: "Fallout 4",
  cyberpunk2077: "Cyberpunk 2077",
  stardew: "Stardew Valley",
  hytale: "Hytale",
};

const KIND: Record<GameQueueItem["kind"], string> = {
  update: "Update",
  requirement: "Requirement",
  "nexus-file": "Collection file",
};

const STATUS: Record<GameQueueItem["status"], { label: string; tone: Tone }> = {
  waiting: { label: "Waiting", tone: "neutral" },
  working: { label: "Getting it", tone: "accent" },
  website: { label: "On Nexus Mods", tone: "warning" },
  done: { label: "Done", tone: "success" },
  failed: { label: "Didn't work", tone: "danger" },
  skipped: { label: "Skipped", tone: "neutral" },
};

type Filter = "all" | "failed" | "done" | "skipped";

const control = (action: Parameters<typeof window.gamesAPI.queueControl>[0], id?: string) =>
  void window.gamesAPI?.queueControl(action, id).catch(() => {});

function ago(iso?: string | null) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/* What to do about a failure, from the reason the site or the install gave. */
function advice(error?: string | null) {
  const e = (error ?? "").toLowerCase();
  if (!e) return null;
  if (/premium|nxm|download button|free account/.test(e)) return "A free Nexus account can't download straight in: Try again opens the page to press the download button on.";
  if (/api key|apikey|unauthori[sz]ed|401|403|forbidden/.test(e)) return "Check the site's key in Settings, Mod sites.";
  if (/404|not found|no longer|removed|hidden/.test(e)) return "The file may have been replaced or taken down: look for a newer version on the mod's page.";
  if (/enotfound|econn|etimedout|network|offline|fetch failed|socket/.test(e)) return "Looks like the connection dropped: try again once you're online.";
  if (/space|enospc/.test(e)) return "The disk looks full: free some space and try again.";
  if (/eperm|eacces|permission|in use|ebusy/.test(e)) return "Something kept the files locked: close the game and try again.";
  return null;
}

function Row({ item }: { item: GameQueueItem }) {
  const status = STATUS[item.status];
  const finished = item.status === "done" || item.status === "failed" || item.status === "skipped";
  const time = ago(finished ? item.finishedAt : item.addedAt);
  const tip = advice(item.error);
  return (
    <li className="dl-row" data-testid="download-row" data-status={item.status}>
      <div className="dl-row__main">
        <div className="dl-row__name">{item.name}</div>
        <div className="dl-row__meta">
          {GAME_NAMES[item.gameId] ?? item.gameId} · {KIND[item.kind] ?? item.kind}
          {time ? ` · ${time}` : ""}
          {item.detail && item.status !== "failed" ? ` · ${item.detail}` : ""}
        </div>
        {item.status === "failed" && (
          <p className="dl-row__error" role="note">
            <span>{item.error || "It stopped without saying why."}</span>
            {tip && <span className="dl-row__advice">{tip}</span>}
          </p>
        )}
      </div>
      <Badge tone={status.tone}>{status.label}</Badge>
      <div className="dl-row__actions">
        {(item.status === "failed" || item.status === "skipped") && (
          <Button size="sm" icon={<RotateCcw size={14} aria-hidden="true" />} onClick={() => control("retry", item.id)} aria-label={`Try ${item.name} again`}>
            Try again
          </Button>
        )}
        {finished && (
          <button type="button" className="ui-queue__icon-button" onClick={() => control("remove", item.id)} aria-label={`Remove ${item.name} from the history`} title="Remove from the history">
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

export default function Downloads({ onHome }: { onHome: () => void }) {
  usePageNav({ area: "launcher", page: "downloads", handlers: { home: onHome } });
  const { queue } = useDownloads();
  const [filter, setFilter] = useState<Filter>("all");

  const items = useMemo(() => queue?.items ?? [], [queue]);
  const current = queue?.current ?? null;
  const waiting = items.filter((i) => i.status === "waiting");
  const history = useMemo(
    () =>
      items
        .filter((i) => i.status === "done" || i.status === "failed" || i.status === "skipped")
        .sort((a, b) => Date.parse(b.finishedAt ?? b.addedAt ?? "") - Date.parse(a.finishedAt ?? a.addedAt ?? "") || 0),
    [items],
  );
  const counts = { failed: 0, done: 0, skipped: 0 };
  for (const item of history) counts[item.status as keyof typeof counts] += 1;
  const shown = filter === "all" ? history : history.filter((i) => i.status === filter);

  return (
    <div className="app-screen">
      <main className="app-main">
        <div className="app-page dl-page" data-testid="downloads-page">
          <header className="set-topbar">
            <h1 className="set-topbar-title">Downloads</h1>
            <p className="set-topbar-lead">
              Updates, missing requirements and collection files for your games. They carry on whichever page you're on. Minecraft installs show on their instance in the Library.
            </p>
          </header>

          <section className="ui-panel dl-section" aria-labelledby="dl-now">
            <h2 id="dl-now" className="dl-section__title">
              Now
            </h2>
            {current ? (
              <div className="dl-current" data-testid="downloads-current">
                <div className="dl-row__name">
                  {current.name} <span className="dl-row__meta">in {GAME_NAMES[current.gameId] ?? current.gameId}</span>
                </div>
                <p className={`set-message ${current.status === "website" ? "set-message--warning" : "set-message--muted"}`}>
                  {current.status === "website"
                    ? "Press the download button on the Nexus Mods page that opened; the launcher installs it and opens the next."
                    : (current.detail ?? "Getting it…")}
                </p>
                <div className="dl-actions">
                  {current.status === "website" && (
                    <>
                      <Button size="sm" icon={<ExternalLink size={14} aria-hidden="true" />} onClick={() => control("open")}>
                        Open the page again
                      </Button>
                      <Button size="sm" icon={<SkipForward size={14} aria-hidden="true" />} onClick={() => control("skip")}>
                        Skip this one
                      </Button>
                    </>
                  )}
                  {(waiting.length > 0 || current.status === "website") && (
                    <Button size="sm" variant="ghost" icon={<Square size={14} aria-hidden="true" />} onClick={() => control("stop")}>
                      Stop the rest
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <p className="set-message set-message--muted">Nothing downloading right now.</p>
            )}
            {waiting.length > 0 && (
              <>
                <h3 className="dl-section__sub">Next ({waiting.length})</h3>
                <ul className="dl-list">
                  {waiting.map((item) => (
                    <Row key={item.id} item={item} />
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="ui-panel dl-section" aria-labelledby="dl-history">
            <div className="dl-section__head">
              <h2 id="dl-history" className="dl-section__title">
                History
              </h2>
              <div className="dl-actions">
                {counts.failed > 0 && (
                  <Button size="sm" icon={<RotateCcw size={14} aria-hidden="true" />} onClick={() => control("retry")}>
                    Try all {counts.failed} again
                  </Button>
                )}
                {history.length > 0 && (
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => control("clear")}>
                    Clear history
                  </Button>
                )}
              </div>
            </div>
            {history.length > 0 ? (
              <>
                <Segmented
                  label="Show"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all", label: `All ${history.length}` },
                    { value: "failed", label: `Didn't work ${counts.failed}` },
                    { value: "done", label: `Done ${counts.done}` },
                    { value: "skipped", label: `Skipped ${counts.skipped}` },
                  ]}
                />
                {shown.length ? (
                  <ul className="dl-list" data-testid="downloads-history">
                    {shown.map((item) => (
                      <Row key={item.id} item={item} />
                    ))}
                  </ul>
                ) : (
                  <p className="set-message set-message--muted">None here.</p>
                )}
              </>
            ) : (
              <EmptyState
                size="compact"
                icon={<Download size={20} />}
                title="No downloads yet"
                body="When you update mods, get a missing requirement or a collection on a game's page, each file is listed here: done, skipped, or why it didn't work."
              />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
