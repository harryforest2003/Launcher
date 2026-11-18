import { ExternalLink } from "lucide-react";
import { timeAgo } from "../playedAgo";

/* "£7.99", or the sale price beside the old one and how much is off. */
export function PriceText({ price }: { price: GamePrice | null }) {
  if (!price) return null;
  if (price.free) return <span className="gs-price gs-price--free">Free</span>;
  return (
    <span className="gs-price" aria-label={price.was ? `${price.text}, down ${price.discount}% from ${price.was}` : price.text}>
      {price.discount > 0 && <span className="gs-price__off" aria-hidden="true">-{price.discount}%</span>}
      {price.was && <s className="gs-price__was" aria-hidden="true">{price.was}</s>}
      <span className="gs-price__now" aria-hidden={price.was ? true : undefined}>{price.text}</span>
    </span>
  );
}

const open = (url: string) => void window.gamesAPI.openUrl(url);
const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

/* A game's Home, under its checks: what its makers announced lately, and its DLC on Steam, deals first. */
export default function GameStore({ name, info }: { name: string; info: GameStoreInfo | null }) {
  if (!info?.steamAppId || (!info.news.length && !info.dlc.length)) return null;
  const appId = info.steamAppId;
  const onSale = info.dlc.filter((dlc) => (dlc.price?.discount ?? 0) > 0).length;

  return (
    <div className="gs-store">
      {info.news.length > 0 && (
        <section className="db-card gs-news" aria-labelledby="gs-news-title">
          <header className="db-card__head">
            <h2 className="db-card__title" id="gs-news-title">News</h2>
            <button type="button" className="gs-more" onClick={() => open(`https://store.steampowered.com/news/app/${appId}`)}>
              All news <ExternalLink size={12} aria-hidden="true" />
            </button>
          </header>
          <ul className="gs-news__list">
            {info.news.map((item) => (
              <li key={item.id}>
                <button type="button" className="gs-news__item" onClick={() => open(item.url)}>
                  <span className="gs-news__title">{item.title}</span>
                  <time className="gs-news__date" dateTime={item.date} title={day.format(new Date(item.date))}>
                    {timeAgo(item.date)}
                  </time>
                  {item.summary && <span className="gs-news__summary">{item.summary}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {info.dlc.length > 0 && (
        <section className="db-card gs-dlc" aria-labelledby="gs-dlc-title">
          <header className="db-card__head">
            <h2 className="db-card__title" id="gs-dlc-title">{onSale ? "DLC offers" : "DLC and packs"}</h2>
            <span className="db-card__meta">
              {onSale ? `${onSale} on sale · ` : ""}
              {info.dlcCount.toLocaleString()} for {name}
            </span>
            <button type="button" className="gs-more" onClick={() => open(`https://store.steampowered.com/dlc/${appId}/`)}>
              See all <ExternalLink size={12} aria-hidden="true" />
            </button>
          </header>
          <ul className="gs-dlc__list">
            {info.dlc.map((dlc) => (
              <li key={dlc.id}>
                <button type="button" className="gs-dlc__item" title={`${dlc.name} on Steam`} onClick={() => void window.gamesAPI.getOnSteam(dlc.id)}>
                  <span className="gs-dlc__art" aria-hidden="true">
                    {dlc.art && <img src={dlc.art} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} />}
                  </span>
                  <span className="gs-dlc__name">{dlc.name}</span>
                  <span className="gs-dlc__price">
                    {dlc.price ? <PriceText price={dlc.price} /> : <span className="gs-price__was">Coming soon</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
