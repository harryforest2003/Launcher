import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Download, ExternalLink } from "lucide-react";
import BackgroundLogo from "../components/BackgroundLogo";
import LauncherSidebar from "../components/LauncherSidebar";
import { Badge, Button, Notice, SearchField, Segmented, Select, Skeleton } from "../components/ui";
import ModManager from "./ModManager";
import Pagination from "../components/Pagination";
import { useGameArt } from "./gameArt";
import "./homeScreens.css";
import "./moreGames.css";

type Props = {
  initialGame?: DetectedGame;
  onBack: () => void;
  onMinecraft: () => void;
  onGame: (id: GameId) => void;
  onSettings: () => void;
};

/* A game's picture: its own, else one from where it's sold, else the result's; initials offline. */
function GameTileArt({ id, name, src: given, alt }: { id?: string; name: string; src?: string | null; alt?: string | null }) {
  const artOf = useGameArt([id]);
  const [tries, setTries] = useState(0);
  const options = [artOf(id, given), alt].filter((url, i, all): url is string => Boolean(url) && all.indexOf(url) === i);
  const src = options[tries];
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
  return (
    <span className="mg-game__art" aria-hidden="true">
      {src ? (
        <img key={src} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setTries((n) => n + 1)} />
      ) : (
        <span className="mg-game__mark">{initials}</span>
      )}
    </span>
  );
}


const SOURCES: { value: GameFindSource; label: string }[] = [
  { value: "all", label: "All" },
  { value: "steam", label: "Steam" },
  { value: "nexus", label: "Nexus Mods" },
  { value: "curseforge", label: "CurseForge" },
];
const SOURCE_NOTE: Record<GameFindSource, string> = {
  all: "Steam's store, most played first; type to search the mod sites too",
  steam: "Steam's store, most played first",
  nexus: "Every game with mods on Nexus Mods",
  curseforge: "Every game CurseForge hosts mods for",
};
const STEAM_SORTS = [
  { value: "popular", label: "Most played" },
  { value: "new", label: "Newest" },
  { value: "rated", label: "Top rated" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
];
const NEXUS_SORTS = [
  { value: "popular", label: "Most modded" },
  { value: "name", label: "Name" },
];
type Mods = "any" | "with" | "none";
type Filters = { price: string; sort: string; mac: boolean; mods: Mods };
const NO_FILTERS: Filters = { price: "any", sort: "popular", mac: false, mods: "any" };

/* What a game costs on Steam, for the corner of its card: "Free", or the sale price with the old one struck. */
function PriceTag({ price }: { price?: GamePrice | null }) {
  if (!price) return null;
  if (price.free) return <span className="mg-price mg-price--free">Free</span>;
  return (
    <span className="mg-price" aria-label={price.was ? `${price.text}, down ${price.discount}% from ${price.was}` : price.text}>
      {price.discount > 0 && <span className="mg-price__off" aria-hidden="true">-{price.discount}%</span>}
      {price.was && <s className="mg-price__was" aria-hidden="true">{price.was}</s>}
      <span className="mg-price__now" aria-hidden={price.was ? true : undefined}>{price.text}</span>
    </span>
  );
}

const keyOf = (game: GameFound) => game.steamAppId ?? game.nexus ?? (game.curseforge ? `cf${game.curseforge}` : game.name);

export default function ModGames({ initialGame, onBack, onMinecraft, onGame, onSettings }: Props) {
  const [sections, setSections] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DetectedGame | null>(initialGame ?? null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Adding a game from Steam, Nexus Mods or CurseForge.
  const [found, setFound] = useState<GameFindResult | null>(null);
  const [findPage, setFindPage] = useState(1);
  const [source, setSource] = useState<GameFindSource>("all");
  const [finding, setFinding] = useState(true);
  const [findError, setFindError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [steps, setSteps] = useState<{ value: string; label: string }[]>([]);
  const [opening, setOpening] = useState<string | null>(null);
  // How many games "Every game" lists with no search or filter, for the page's lead.
  const [everyTotal, setEveryTotal] = useState<{ modded: number; steam: number } | null>(null);
  // Where to buy or download the games on this page that Steam doesn't sell, by name.
  const [where, setWhere] = useState<Record<string, GameWhere>>({});

  // A Nexus Mods key is added in the launcher's Settings; this only says whether there is one.
  const [hasNexusKey, setHasNexusKey] = useState(true);

  // Every game the launcher has a workspace for, and whether each is on this computer.
  const read = useCallback(() => {
    return Promise.all([window.gamesAPI.list(), window.modAPI.getSettings()])
      .then(([workspaces, settings]) => {
        setSections(workspaces);
        setHasNexusKey(settings.hasNexusKey);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  // The stores are asked once typing pauses.
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      // Nexus Mods and CurseForge only sort; price and Mac are Steam's.
      const asked = source === "nexus" || source === "curseforge" ? { sort: filters.sort } : filters;
      const everything = !query.trim() && source === "all" && filters.price === NO_FILTERS.price && filters.sort === NO_FILTERS.sort && !filters.mac && filters.mods === NO_FILTERS.mods;
      window.gamesAPI
        .findGames(query.trim(), findPage - 1, source, asked)
        .then((result) => {
          if (!live) return;
          setFound(result);
          if (everything && result.counts) setEveryTotal(result.counts);
          if (result.priceSteps?.length) setSteps(result.priceSteps);
          setFindError(result.warnings.length && !result.total ? result.warnings.join(" ") : null);
        })
        .catch((err) => live && setFindError(err instanceof Error ? err.message : String(err)))
        .finally(() => live && setFinding(false));
    }, query.trim() ? 350 : 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, findPage, source, filters]);

  // Games Steam doesn't sell may be on GOG, Epic, Battle.net or their own site; ask once the page is in.
  useEffect(() => {
    const names = (found?.results ?? []).filter((game) => !game.steamAppId && !game.installed).map((game) => game.name);
    const wanted = names.filter((name) => !(name in where));
    if (!wanted.length) return;
    let live = true;
    window.gamesAPI
      .whereToGet(wanted)
      .then((answers) => {
        // A name left out couldn't be looked up; it's asked again with the next page.
        if (live) setWhere((was) => ({ ...was, ...answers }));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // where is left out on purpose: it only grows from this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found]);

  function search(text: string) {
    setQuery(text);
    setFindPage(1);
    setFinding(true);
  }

  function browse(next: GameFindSource) {
    if (next === source) return;
    setSource(next);
    // Each place sorts its own way; keep the sort only where it means something.
    const sorts = next === "nexus" ? NEXUS_SORTS : next === "curseforge" ? [] : STEAM_SORTS;
    setFilters((was) => ({ ...was, sort: sorts.some((s) => s.value === was.sort) ? was.sort : "popular" }));
    setFindPage(1);
    setFinding(true);
  }

  function findPageTo(next: number) {
    if (next === findPage) return;
    setFindPage(next);
    setFinding(true);
  }

  // What the list below is, in a few words.
  function sourceNote() {
    if (source === "nexus" || source === "curseforge") return SOURCE_NOTE[source];
    if (filters.mods === "with") return found?.via === "steam" ? "Steam's store, only games with mods on Nexus Mods or CurseForge" : "Every game with mods on Nexus Mods or CurseForge, most modded first";
    if (filters.mods === "none") return "Steam's store, only games no mod site lists yet";
    return source === "all" && query.trim() && found?.via === "steam" ? "Filters search Steam's store" : SOURCE_NOTE[source];
  }

  function filter(change: Partial<Filters>) {
    setFilters((was) => ({ ...was, ...change }));
    setFindPage(1);
    setFinding(true);
  }

  // Any game opens straight to its page; nothing to add first.
  async function open(game: GameFound) {
    if (game.existing) return onGame(game.existing);
    const key = keyOf(game);
    setOpening(key);
    setFindError(null);
    try {
      onGame(await window.gamesAPI.openGame(game));
    } catch (err) {
      setFindError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(null);
    }
  }

  // The store a card points to: Steam when it sells the game, else the first shop (the game's own site last).
  function storeOf(game: GameFound) {
    const known = game.steamAppId ? undefined : where[game.name];
    const steamId = game.steamAppId ?? known?.steamAppId ?? null;
    const stores = known?.stores ?? [];
    // A console-only game's own site isn't somewhere to get it for this computer.
    const shop = steamId ? stores.find((s) => s.store === "steam") : (stores.find((s) => s.store !== "site") ?? (known?.pc === false ? undefined : stores[0]));
    return { known, steamId, shop, rest: stores.filter((s) => s !== shop && s.store !== "steam") };
  }

  // Where to get a game that isn't here yet: its Steam page (in Steam when it's installed),
  // else the best other store that sells it, else a note that it isn't on PC.
  function getLink(game: GameFound) {
    if (game.installed) {
      return (
        <span className="mg-get mg-get--here">
          <Check size={13} aria-hidden="true" /> On this computer
        </span>
      );
    }
    const { known, steamId, shop, rest } = storeOf(game);
    const also = rest.length ? `Also on ${rest.map((s) => s.label).join(", ")}` : undefined;
    if (steamId) {
      return (
        <button type="button" className="mg-get" title={also} onClick={() => void window.gamesAPI.getOnSteam(steamId)}>
          <Download size={13} aria-hidden="true" /> Get on Steam
        </button>
      );
    }
    if (shop) {
      return (
        <button
          type="button"
          className="mg-get"
          title={also}
          onClick={() => void window.gamesAPI.openUrl(shop.url)}
        >
          <ExternalLink size={13} aria-hidden="true" /> {shop.store === "site" ? "Official site" : `Get on ${shop.label}`}
        </button>
      );
    }
    if (known?.pc === false) {
      const on = known.platforms.slice(0, 2).join(", ");
      return (
        <span className="mg-get mg-get--here" title={known.platforms.length ? `Released on ${known.platforms.join(", ")}` : undefined}>
          {on ? `Not on PC · ${on}` : "Not on PC"}
        </span>
      );
    }
    if (game.nexus) {
      const url = `https://www.nexusmods.com/games/${game.nexus}`;
      return (
        <button type="button" className="mg-get" onClick={() => void window.gamesAPI.openUrl(url)}>
          <ExternalLink size={13} aria-hidden="true" /> On Nexus Mods
        </button>
      );
    }
    return <span />;
  }

  const matches = (name: string) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const here = sections.filter((game) => game.found);
  // Every other game is in "Every game", ready to open; a game that can't run here is listed apart.
  const notOnPC = sections.filter((game) => game.notOnPC && matches(game.name));
  const steamish = source === "all" || source === "steam";
  const sorts = source === "nexus" ? NEXUS_SORTS : source === "curseforge" ? [] : STEAM_SORTS;
  const filtered = filters.price !== "any" || filters.mac || (steamish && (filters.sort !== "popular" || filters.mods !== "any"));

  return (
    <div className="app-screen">
      <LauncherSidebar current="modmanager" onHome={onBack} onModManager={() => setSelected(null)} onSettings={onSettings} />

      <main className="app-main">
        <div className="app-logo-tint">
          <BackgroundLogo />
        </div>

        {selected ? (
          <ModManager game={selected} onBack={() => setSelected(null)} />
        ) : (
          <div className="app-page">
            <Button variant="ghost" className="mg-back" icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={onBack}>
              Back to Home
            </Button>

            <header className="mg-head">
              <div className="mg-head__text">
                <h1 className="page-title">More Games</h1>
                <p className="mg-head__lead" aria-live="polite">
                  {loading
                    ? "Looking for games…"
                    : `${here.length} on this computer, on Home and in the sidebar${everyTotal ? ` · ${everyTotal.steam.toLocaleString()} games on Steam and ${everyTotal.modded.toLocaleString()} with mods to choose from` : ""}.`}
                </p>
              </div>
              <SearchField
                wrapperClassName="mg-search"
                label="Search games"
                placeholder="Search any game…"
                value={query}
                onChange={(event) => search(event.target.value)}
              />
            </header>

            {error && (
              <div className="mg-stack">
                <Notice tone="danger">{error}</Notice>
              </div>
            )}

            {loading ? (
              <div className="mg-grid" role="status" aria-label="Looking for games">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="mg-skel" aria-hidden="true">
                    <Skeleton shape="block" className="mg-skel__art" />
                    <Skeleton width="70%" />
                    <Skeleton width="45%" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                <section className="mg-section" aria-labelledby="mg-add">
                  <div className="mg-section__head">
                    <h2 className="mh-section-title" id="mg-add">{query.trim() ? `Results for “${query.trim()}”` : "Every game"}</h2>
                    {found && (
                      <span className="mg-section__count" title={found.approx ? "Steam's list is still being looked through as you go" : undefined}>
                        {found.approx === "more"
                          ? `${found.total.toLocaleString()}+`
                          : found.approx === "about"
                            ? `about ${found.total.toLocaleString()}`
                            : found.total.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="mg-section__lead">
                    Every game on Steam, Nexus Mods and CurseForge, most played first; type to search them all. Open one to see its page, news and mods; once it's on
                    this computer it moves to Home and the sidebar by itself.
                  </p>
                  <div className="mg-sources">
                    <Segmented label="Where to look" value={source} options={SOURCES} onChange={browse} />
                    <span className="mg-sources__note">{sourceNote()}</span>
                  </div>
                  {(steamish || sorts.length > 0) && (
                    <div className="mg-filters">
                      {steamish && (
                        <Select size="sm" aria-label="Mods" value={filters.mods} onChange={(event) => filter({ mods: event.target.value as Mods })}>
                          <option value="any">All games</option>
                          <option value="with">Mods available</option>
                          <option value="none">No mods available</option>
                        </Select>
                      )}
                      {steamish && (
                        <Select size="sm" aria-label="Price" value={filters.price} onChange={(event) => filter({ price: event.target.value })}>
                          <option value="any">Any price</option>
                          <option value="free">Free</option>
                          {steps.map((step) => (
                            <option key={step.value} value={step.value}>{step.label}</option>
                          ))}
                          <option value="sale">On sale</option>
                        </Select>
                      )}
                      {sorts.length > 0 && (
                        <Select size="sm" aria-label="Sort by" value={filters.sort} onChange={(event) => filter({ sort: event.target.value })}>
                          {sorts.map((sort) => (
                            <option key={sort.value} value={sort.value}>{sort.label}</option>
                          ))}
                        </Select>
                      )}
                      {steamish && (
                        <Select size="sm" aria-label="Platform" value={filters.mac ? "mac" : "any"} onChange={(event) => filter({ mac: event.target.value === "mac" })}>
                          <option value="any">Any platform</option>
                          <option value="mac">Runs on Mac</option>
                        </Select>
                      )}
                      {filtered && (
                        <button type="button" className="mg-section__action mg-filters__clear" onClick={() => filter(NO_FILTERS)}>
                          Clear filters
                        </button>
                      )}
                    </div>
                  )}
                  {findError && <Notice tone="warning">{findError}</Notice>}
                  {finding && !found ? (
                    <div className="mg-grid" role="status" aria-label="Searching Steam, Nexus Mods and CurseForge">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="mg-skel" aria-hidden="true">
                          <Skeleton shape="block" className="mg-skel__art" />
                          <Skeleton width="70%" />
                        </div>
                      ))}
                    </div>
                  ) : found && found.results.length === 0 ? (
                    <p className="mg-none" role="status">
                      {query.trim()
                        ? `Nothing on ${SOURCES.find((s) => s.value === source)?.label ?? "Steam, Nexus Mods or CurseForge"} matches “${query.trim()}”.`
                        : "Nothing to show here. Type a game's name to find it."}
                    </p>
                  ) : (
                    found && (
                      <ul className={`mg-grid${finding ? " mg-grid--busy" : ""}`} aria-busy={finding}>
                        {found.results.map((game) => {
                          const key = keyOf(game);
                          return (
                            <li key={key} className="mg-game mg-game--result">
                              <button
                                type="button"
                                className="mg-game__open"
                                aria-label={`Open ${game.name}`}
                                disabled={opening !== null}
                                onClick={() => void open(game)}
                              >
                                <GameTileArt name={game.name} src={game.art} alt={game.artAlt} />
                                <span className="mg-game__body">
                                  <span className="mg-game__name">{game.name}</span>
                                  <span className="mg-tags">
                                    {game.installed && <Badge tone="success">Installed</Badge>}
                                    {game.steamAppId && <Badge>Steam</Badge>}
                                    {game.nexus && <Badge>{game.nexusMods ? `Nexus Mods · ${game.nexusMods.toLocaleString()}` : "Nexus Mods"}</Badge>}
                                    {game.curseforge && <Badge>CurseForge</Badge>}
                                    {game.mac && <Badge>Mac</Badge>}
                                  </span>
                                </span>
                              </button>
                              <span className="mg-game__foot">
                                {opening === key ? <span className="mg-get mg-get--here">Opening…</span> : getLink(game)}
                                <PriceTag price={game.price ?? storeOf(game).shop?.price} />
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )
                  )}
                  {found && found.pageCount > 1 && (
                    <div className="mg-pages">
                      <Pagination page={found.page + 1} pageCount={found.pageCount} disabled={finding} onChange={findPageTo} />
                    </div>
                  )}
                </section>

                {notOnPC.length > 0 && (
                  <section className="mg-section" aria-labelledby="mg-console">
                    <div className="mg-section__head">
                      <h2 className="mh-section-title" id="mg-console">Not on PC yet</h2>
                      <span className="mg-section__count">{notOnPC.length}</span>
                    </div>
                    <ul className="mg-grid mg-grid--quiet">
                      {notOnPC.map((game) => (
                        <li key={game.id} className="mg-game mg-game--off">
                          <GameTileArt id={game.id} name={game.name} src={game.art} />
                          <span className="mg-game__body">
                            <span className="mg-game__name">{game.name}</span>
                            <span className="mg-game__source">{game.notOnPC}</span>
                            <span className="mg-tags"><Badge>Console only</Badge></span>
                            <span className="mg-game__go mg-game__go--muted">Shows up here when a PC version is out</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}

            <p className="mg-foot">
              Minecraft has its own instances; <button type="button" className="mg-foot__link" onClick={onMinecraft}>open Minecraft</button>.
              {!hasNexusKey && (
                <>
                  {" "}To install from Nexus Mods, add your Nexus API key in{" "}
                  <button type="button" className="mg-foot__link" onClick={onSettings}>Settings</button>.
                </>
              )}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
