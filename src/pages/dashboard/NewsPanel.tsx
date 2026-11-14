import { useState } from "react";
import { ExternalLink, Newspaper, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui";
import { initials, timeAgo } from "../playedAgo";
import "./dashboard.css";

const CATEGORY: Record<NewsCategory, string> = {
  minecraft: "Minecraft",
  java: "Java Edition",
  bedrock: "Bedrock",
  snapshot: "Snapshot",
  fabric: "Fabric",
  forge: "Forge",
  neoforge: "NeoForge",
  modding: "Modding",
  community: "Community",
  gaming: "Gaming",
};

const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

function when(iso: string) {
  const ago = timeAgo(iso);
  if (!ago) return "";
  return ago.startsWith("on ") ? DATE.format(new Date(iso)) : ago;
}

/* An article's picture, or its source's initials when it has none (or it won't load). */
function Thumb({ item, className }: { item: NewsItem; className: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`${className} db-thumb`} aria-hidden="true">
      {item.image && !failed ? (
        <img src={item.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span className="db-thumb__mark">{initials(item.source)}</span>
      )}
    </span>
  );
}

type Props = {
  news: NewsResult | null;
  loading: boolean;
  failed: boolean;
  onRefresh: () => void;
  /** The panel's heading, and what it says the news is from. */
  title?: string;
  from?: string;
  /** How many smaller stories sit beside the featured one. */
  more?: number;
};

/*
 * Minecraft and mod loader news from their official sources (fetched and cached by the main
 * process): one featured article beside smaller cards. Each opens the original article in the
 * browser. If a source can't be reached the rest still show, and it says which were missed.
 */
export default function NewsPanel({ news, loading, failed, onRefresh, title = "News", from = "Minecraft, Fabric, Forge and NeoForge", more = 3 }: Props) {
  const items = news?.items ?? [];
  // Lead with the newest article that has a picture.
  const featured = items.find((i) => i.image) ?? items[0];
  const rest = items.filter((i) => i !== featured).slice(0, more);
  // A tag only helps when the stories are of different kinds.
  const tagged = new Set(items.map((i) => i.category)).size > 1;
  const missed = news?.failed ?? [];

  return (
    <section className="db-card db-news" aria-labelledby="db-news-title">
      <header className="db-card__head">
        <h2 className="db-card__title" id="db-news-title">
          {title}
        </h2>
        <span className="db-card__meta">
          {missed.length > 0 && items.length > 0 ? `Couldn't reach ${missed.join(", ")}` : news?.fromCache ? "Saved copy" : from}
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={14} aria-hidden="true" />}
          onClick={onRefresh}
          disabled={loading}
          aria-label="Check for news again"
          data-tip="Check for news again"
        />
      </header>

      {loading && !items.length ? (
        <div className="db-empty db-empty--quiet">Getting the latest news...</div>
      ) : !featured ? (
        <div className="db-empty">
          <Newspaper size={20} aria-hidden="true" />
          <strong>News isn't available right now</strong>
          <span>{failed || missed.length ? "The news sites couldn't be reached. Check your connection and try again." : "There's nothing to show yet."}</span>
          <Button size="sm" icon={<RefreshCw size={14} aria-hidden="true" />} onClick={onRefresh}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="db-news__grid">
          <a className="db-feature" href={featured.url} target="_blank" rel="noopener noreferrer">
            <Thumb item={featured} className="db-feature__img" />
            <span className="db-feature__body">
              {tagged && <span className="db-tag">{CATEGORY[featured.category] ?? featured.category}</span>}
              <span className="db-feature__title">{featured.title}</span>
              <span className="db-feature__summary">{featured.summary}</span>
              <span className="db-byline">
                {featured.source}, {when(featured.date)}
                <ExternalLink size={12} aria-hidden="true" />
              </span>
            </span>
          </a>

          <ul className="db-news__list">
            {rest.map((item) => (
              <li key={item.id}>
                <a className="db-story" href={item.url} target="_blank" rel="noopener noreferrer">
                  <Thumb item={item} className="db-story__img" />
                  <span className="db-story__body">
                    <span className="db-story__title">{item.title}</span>
                    <span className="db-byline">
                      {tagged && <span className="db-tag db-tag--quiet">{CATEGORY[item.category] ?? item.category}</span>}
                      {item.source}, {when(item.date)}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
