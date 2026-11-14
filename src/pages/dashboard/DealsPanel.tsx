import { useState } from "react";
import { RefreshCw, ShoppingBag, ExternalLink } from "lucide-react";
import { Button } from "../../components/ui";
import "./dashboard.css";

type Props = { deals: DealsResult | null; loading: boolean; failed: boolean; onRefresh: () => void };

const price = (value: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return value.toFixed(2);
  }
};

/* "Ends tomorrow", "Ends in 3 days", or nothing when Steam gave no end date. */
function endsIn(iso: string | null) {
  if (!iso) return "";
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return hours <= 1 ? "Ends within the hour" : `Ends in ${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Ends tomorrow" : `Ends in ${days} days`;
}

/* A deal's capsule picture, or the game's initials if it won't load. */
function Capsule({ deal }: { deal: SteamDeal }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="db-deal__img db-thumb" aria-hidden="true">
      {deal.image && !failed ? (
        <img src={deal.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span className="db-thumb__mark">{deal.name.slice(0, 2)}</span>
      )}
    </span>
  );
}

/*
 * Steam's current specials (from the Steam store's own front-page data, fetched by the main
 * process), priced in the player's currency. Each opens the game's Steam page in the browser.
 */
export default function DealsPanel({ deals, loading, failed, onRefresh }: Props) {
  const items = (deals?.items ?? []).slice(0, 6);
  const missed = (deals?.failed ?? []).length > 0;

  return (
    <section className="db-card db-deals" aria-labelledby="db-deals-title">
      <header className="db-card__head">
        <h2 className="db-card__title" id="db-deals-title">
          Steam deals
        </h2>
        <span className="db-card__meta">{missed && items.length ? "Saved copy, Steam couldn't be reached" : deals?.fromCache ? "Saved copy" : "On sale now"}</span>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={14} aria-hidden="true" />}
          onClick={onRefresh}
          disabled={loading}
          aria-label="Check Steam deals again"
          data-tip="Check Steam deals again"
        />
      </header>

      {loading && !items.length ? (
        <div className="db-empty db-empty--quiet">Getting Steam's deals...</div>
      ) : !items.length ? (
        <div className="db-empty">
          <ShoppingBag size={20} aria-hidden="true" />
          <strong>Deals aren't available right now</strong>
          <span>{failed || missed ? "Steam couldn't be reached. Check your connection and try again." : "Steam has nothing on sale to show."}</span>
          <Button size="sm" icon={<RefreshCw size={14} aria-hidden="true" />} onClick={onRefresh}>
            Try again
          </Button>
        </div>
      ) : (
        <ul className="db-deals__grid">
          {items.map((deal) => (
            <li key={deal.id}>
              <a className="db-deal" href={deal.url} target="_blank" rel="noopener noreferrer" aria-label={`${deal.name}: ${deal.discountPercent}% off, now ${price(deal.finalPrice, deal.currency)} on Steam`}>
                <Capsule deal={deal} />
                <span className="db-deal__off" aria-hidden="true">
                  -{deal.discountPercent}%
                </span>
                <span className="db-deal__body">
                  <span className="db-deal__name">{deal.name}</span>
                  <span className="db-deal__prices" aria-hidden="true">
                    <s>{price(deal.originalPrice, deal.currency)}</s>
                    <strong>{price(deal.finalPrice, deal.currency)}</strong>
                  </span>
                  <span className="db-byline">
                    {endsIn(deal.endsAt) || "Steam"}
                    <ExternalLink size={12} aria-hidden="true" />
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
