import { useId, useState } from "react";
import { Button } from "../../components/ui";
import { CircleAlert, FolderPlus, Layers, PackagePlus, Play, RefreshCw, Sparkles, TriangleAlert, type LucideIcon } from "lucide-react";
import { timeAgo } from "../playedAgo";
import "./dashboard.css";

const KIND: Record<ActivityKind, { icon: LucideIcon; tone?: "danger" | "warning" }> = {
  played: { icon: Play },
  "instance-created": { icon: FolderPlus },
  "mods-installed": { icon: PackagePlus },
  "mods-updated": { icon: RefreshCw },
  "loader-updated": { icon: Layers },
  "launcher-updated": { icon: Sparkles },
  crash: { icon: CircleAlert, tone: "danger" },
  error: { icon: TriangleAlert, tone: "warning" },
};

type Props = { items: ActivityItem[] | null; loading: boolean; failed?: boolean };

/* What happened lately, newest first: games played, instances made, mods added or updated,
   loader and launcher updates, crashes and errors (marked, with words, not colour alone). */
export default function ActivityPanel({ items, loading, failed = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const list = items ?? [];
  const visible = expanded ? list : list.slice(0, 5);
  return (
    <section className="db-card db-activity" aria-labelledby="db-activity-title">
      <header className="db-card__head">
        <h2 className="db-card__title" id="db-activity-title">
          Recent activity
        </h2>
      </header>

      {loading ? (
        <div className="db-empty db-empty--quiet">Looking back...</div>
      ) : failed && !list.length ? (
        <div className="db-empty" role="status"><strong>Activity is unavailable</strong><span>We’ll try again when you return to the window.</span></div>
      ) : list.length === 0 ? (
        <div className="db-empty">
          <Sparkles size={20} aria-hidden="true" />
          <strong>Nothing yet</strong>
          <span>Games you play, instances you make and mods you add will show up here.</span>
        </div>
      ) : (
        <ol id={listId} className="db-feed">
          {visible.map((item, n) => {
            const kind = KIND[item.kind] ?? { icon: Sparkles };
            const Icon = kind.icon;
            return (
              <li key={`${item.at}-${n}`} className={`db-feed__item${kind.tone ? ` db-feed__item--${kind.tone}` : ""}`}>
                <span className="db-feed__icon" aria-hidden="true">
                  <Icon size={14} />
                </span>
                <span className="db-feed__text">
                  <span className="db-feed__title">
                    {kind.tone === "danger" && <span className="u-visually-hidden">Problem: </span>}
                    {item.title}
                  </span>
                  {(item.detail || (item.instance && !item.title.includes(item.instance))) && (
                    <span className="db-feed__detail">
                      {item.instance && !item.title.includes(item.instance) ? `${item.instance}${item.detail ? ": " : ""}` : ""}
                      {item.detail}
                    </span>
                  )}
                </span>
                <time className="db-feed__when" dateTime={item.at}>
                  {timeAgo(item.at)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
      {list.length > 5 && <Button variant="ghost" size="sm" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((value) => !value)}>
        {expanded ? "Show less" : `Show all ${list.length} events`}
      </Button>}
    </section>
  );
}
