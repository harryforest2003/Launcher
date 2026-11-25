import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  Clock,
  Info,
  Play,
  Plus,
  TriangleAlert,
} from "lucide-react";
import BackgroundLogo from "../components/BackgroundLogo";
import GameCover from "../components/ui/GameCover";
import LauncherSidebar from "../components/LauncherSidebar";
import { Badge, Button, Notice, SearchField, Segmented, Tabs, type Tone } from "../components/ui";
import { formatHours } from "../components/charts";
import ActivityPanel from "./dashboard/ActivityPanel";
import DealsPanel from "./dashboard/DealsPanel";
import NewsPanel from "./dashboard/NewsPanel";
import PlayStats from "./dashboard/PlayStats";
import { defaultRange, type Range } from "./dashboard/range";
import { useDashboard } from "./dashboard/useDashboard";
import { useInstances } from "./dashboard/useInstances";
import { artOf, useGameArt } from "./gameArt";
import { timeAgo } from "./playedAgo";
import { useScrollMemory } from "./useScrollMemory";
import HomeGamePanel, { type HomePanelTarget } from "./HomeGamePanel";
import { usePlayingGames } from "../components/ui/playingGames";
import type { GamePageKey, McPage } from "../components/ui/shellContext";
import "./dashboard/dashboard.css";

type Props = {
  /** A Minecraft page (its home if none); `instance` opens that instance in the Library. */
  onMinecraft: (page?: McPage, instance?: string) => void;
  onGame: (id: GameId, page?: GamePageKey) => void;
  onModGame: (game: DetectedGame) => void;
  onModManager: () => void;
  onSettings: () => void;
};

type Chip = { label: string; tone: Tone; icon?: "clock" };

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/* Everything that needs looking at in a game: red stops it working, amber is worth a look. */
function chipsFor(game: GameSummary, status: GameStatus | undefined): Chip[] {
  if (!game.found) return [{ label: "Not found", tone: "neutral" }];

  const chips: Chip[] = [];
  if (status?.crashes)
    chips.push({
      label:
        status.crashes === 1
          ? "Crashed"
          : plural(status.crashes, "crash report", "crash reports"),
      tone: "danger",
    });
  if (status?.clashes)
    chips.push({
      label: plural(status.clashes, "mod conflict", "mod conflicts"),
      tone: "danger",
    });
  if (status?.loadOrder)
    chips.push({ label: "Load order problem", tone: "danger" });
  if (status?.requirements)
    chips.push({
      label: `Missing ${plural(status.requirements, "mod", "mods")}`,
      tone: "danger",
    });
  if (status?.health)
    chips.push({
      label: plural(status.health, "mod folder problem", "mod folder problems"),
      tone: "warning",
    });
  if (game.updated)
    chips.push({ label: "Updated since you last played", tone: "warning" });
  if (status?.updates)
    chips.push({
      label: plural(status.updates, "mod update", "mod updates"),
      tone: "warning",
    });
  if (status && chips.length === 0)
    chips.push({ label: "All good", tone: "success" });
  return chips;
}

/* The same, folded to at most two chips for a row: one red, one amber. The full list is the
   chip's tip and the row's accessible name. */
function summarise(chips: Chip[]): (Chip & { tip?: string })[] {
  const out: (Chip & { tip?: string })[] = [];
  for (const tone of ["danger", "warning"] as const) {
    const list = chips.filter((c) => c.tone === tone);
    if (list.length === 1)
      out.push(
        list[0].label === "Updated since you last played"
          ? {
              ...list[0],
              label: "Game updated",
              tip: "Updated since you last played: some mods may need updating too",
            }
          : list[0],
      );
    if (list.length > 1)
      out.push({
        tone,
        label:
          tone === "danger"
            ? `${list.length} problems`
            : `${list.length} to check`,
        tip: list.map((c) => c.label).join(", "),
      });
  }
  return out.length ? out : chips;
}

const needsLook = (chips: Chip[]) =>
  chips.some((c) => c.tone === "danger" || c.tone === "warning");

function listNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function GameArt({ id, name }: { id: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const src = useGameArt([id])(id);
  return (
    <span className="db-game__art" aria-hidden="true">
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <GameCover name={name} variant="thumb" />
      )}
    </span>
  );
}

function Chips({
  chips,
  testId,
}: {
  chips: (Chip & { tip?: string })[];
  testId?: string;
}) {
  if (!chips.length) return null;
  return (
    <span className="db-game__chips" data-testid={testId}>
      {chips.map((chip) => (
        <Badge key={chip.label} tone={chip.tone} data-tip={chip.tip}>
          {chip.tone === "danger" && <CircleAlert size={12} aria-hidden="true" />}
          {chip.tone === "warning" && <TriangleAlert size={12} aria-hidden="true" />}
          {chip.tone === "success" && <CircleCheck size={12} aria-hidden="true" />}
          {chip.tone === "accent" && <Play size={12} aria-hidden="true" />}
          {chip.tone === "neutral" && (chip.icon === "clock" ? <Clock size={12} aria-hidden="true" /> : <Info size={12} aria-hidden="true" />)}
          {chip.label}
        </Badge>
      ))}
    </span>
  );
}

// Keep navigation context for this launcher session, without saving searches to disk.
const homeContext: {
  query: string;
  filter: "all" | "attention";
  view: "activity" | "news";
} = { query: "", filter: "all", view: "activity" };

function HomeScreen({ onMinecraft, onGame, onModGame, onModManager, onSettings }: Props) {
  const [query, setQuery] = useState(homeContext.query);
  const [filter, setFilter] = useState(homeContext.filter);
  const [view, setView] = useState(homeContext.view);
  useEffect(() => {
    Object.assign(homeContext, { query, filter, view });
  }, [query, filter, view]);
  const [detected, setDetected] = useState<DetectedGame[]>([]);
  // Every supported game, so Home can say how many more are in More Games.
  const [catalog, setCatalog] = useState<CatalogGame[]>([]);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [listed, setListed] = useState(false);
  const [detectedLoaded, setDetectedLoaded] = useState(false);
  const [scanAttempt, setScanAttempt] = useState(0);
  const [scanFailed, setScanFailed] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [statusFailed, setStatusFailed] = useState(false);
  // What needs looking at in each game, filled in as each is worked out.
  const [statuses, setStatuses] = useState<Partial<Record<GameId, GameStatus>>>(
    {},
  );

  const { instances, loaded: instancesLoaded, loadError: instanceLoadError, reload: reloadInstances } =
    useInstances();
  const { stats, activity, news, refreshNews, deals, refreshDeals } = useDashboard(true, { feed: "gaming", deals: true });
  // Other games' timed play, read again whenever one opens or closes.
  const playingGames = usePlayingGames();
  const [gamePlay, setGamePlay] = useState<GamePlayStats | null>(null);
  const playingKey = playingGames.map((g) => g.id).join(",");
  useEffect(() => {
    let live = true;
    window.gamesAPI.playStats?.().then((value) => live && setGamePlay(value), () => {});
    return () => { live = false; };
  }, [playingKey]);
  // The time range for the play time cards; until chosen, one that has play in it.
  const [chosenRange, setRange] = useState<Range | null>(null);
  const range = chosenRange ?? defaultRange(stats.data);
  // The card whose drawer is open on the right: pick a profile and play without opening the game.
  const [panel, setPanel] = useState<HomePanelTarget | null>(null);
  const panelOpenedAt = useRef(0);
  const openPanel = (target: HomePanelTarget, at: number) => {
    panelOpenedAt.current = at;
    setPanel(target);
  };
  const closePanel = useCallback(() => setPanel(null), []);
  // A double-click opens the game itself: its second click lands on the drawer's scrim.
  const openWorkspace = (target: HomePanelTarget) => (target.kind === "minecraft" ? onMinecraft() : onGame(target.id));
  const pageScroll = useScrollMemory("launcher-home", listed && detectedLoaded && instancesLoaded &&
    (view === "activity" ? !stats.loading && !activity.loading : !news.loading && !deals.loading));

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => window.modAPI.getGames())
      .then((items) => { if (active) setDetected(items); })
      .catch(() => { if (active) setScanFailed(true); })
      .finally(() => { if (active) setDetectedLoaded(true); });
    Promise.resolve().then(() => window.modAPI.catalog())
      .then((items) => { if (active) setCatalog(items); })
      .catch(() => { /* Home still works; the More games card just has no count. */ });
    Promise.resolve().then(() => window.gamesAPI.list())
      .then(async (found) => {
        if (!active) return;
        setGames(found);
        setListed(true);
        const results = await Promise.allSettled(found.filter((game) => game.found).map(async (game) => ({
          id: game.id, status: await window.gamesAPI.status(game.id),
        })));
        if (!active) return;
        setStatuses(Object.fromEntries(results.flatMap((result) =>
          result.status === "fulfilled" ? [[result.value.id, result.value.status]] : [])));
        setStatusFailed(results.some((result) => result.status === "rejected"));
      })
      .catch(() => { if (active) setScanFailed(true); })
      .finally(() => {
        if (active) { setListed(true); setCheckingStatus(false); }
      });
    return () => { active = false; };
  }, [scanAttempt]);

  const retryScan = () => {
    void reloadInstances();
    setScanFailed(false);
    setStatusFailed(false);
    setCheckingStatus(true);
    setListed(false);
    setDetectedLoaded(false);
    setScanAttempt((attempt) => attempt + 1);
  };

  const extraGames = listed ? detected.filter((game) => !game.managedByInstances && !games.some(({ id }) => id === game.id)) : [];
  // Home only shows games on this computer; the rest wait in More Games.
  const found = games.filter((g) => g.found);
  const onComputer = (id: string) => detected.some((d) => d.id === id) || games.some((g) => g.id === id && g.found);
  const notHere = [
    ...games.filter((g) => !g.found).map(({ id }) => id as string),
    ...catalog.filter((g) => !onComputer(g.id) && !games.some((s) => s.id === g.id)).map(({ id }) => id),
  ];
  // A few covers of games that aren't here, for the More games card.
  const FEATURED = ["rdr2", "eldenring", "witcher3", "hogwartslegacy", "gtav", "starfield", "bg3", "palworld"];
  const covers = [...FEATURED.filter((id) => notHere.includes(id)), ...notHere.filter((id) => !FEATURED.includes(id))]
    .filter((id) => artOf(id))
    .slice(0, 4);
  const nameOf = (id: string) => catalog.find((g) => g.id === id)?.name ?? games.find((g) => g.id === id)?.name ?? id;
  const previewNames = ["hytale", ...FEATURED, ...notHere].filter((id, i, all) => notHere.includes(id) && all.indexOf(id) === i).slice(0, 2).map(nameOf);
  const chips = (game: GameSummary) => chipsFor(game, statuses[game.id]);
  const attention = found.filter((g) => needsLook(chips(g))).map((g) => g.name);
  const matches = (name: string) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const visibleGames = found.filter((game) => matches(game.name) && (filter === "all" || needsLook(chips(game))));
  const visibleExtra = extraGames.filter((game) => matches(game.name) && filter !== "attention");
  const showMinecraft = matches("Minecraft") && filter !== "attention";
  const showMore = filter === "all" && !query.trim();
  const visibleCount = visibleGames.length + visibleExtra.length + Number(showMinecraft);
  const isMac = navigator.platform.includes("Mac");

  const latest = instances[0];
  const running = instances.find((i) => i.running);
  const gameRow = (game: GameSummary) => {
    const all = chips(game);
    const looking = all.filter(
      (c) => c.tone === "danger" || c.tone === "warning",
    );
    // "All good" would read oddly next to "Can't run on this Mac".
    const shown = (game.found ? summarise(all) : all).filter((c) => !(game.cantRun && c.tone === "success"));
    const checked = !game.found || statuses[game.id] || looking.length > 0;
    const timed = gamePlay?.games[game.id]?.playSeconds ?? game.playSeconds ?? null;
    const isPlaying = playingGames.some((g) => g.id === game.id);
    // Every found game's line reads the same way: play time, then what's in it.
    const meta = game.found
      ? `${timed ? `${formatHours(timed)} played` : "No play time yet"} · ${plural(game.modCount, "enabled mod", "enabled mods")}`
      : game.windowsOnly && isMac
        ? "Windows game: CrossOver or Whisky"
        : "Choose its folder to set it up";
    return (
      <li key={game.id}>
        <button
          type="button"
          className={`db-game${game.found ? "" : " db-game--missing"}`}
          data-testid="home-game"
          data-home-card={game.id}
          aria-haspopup="dialog"
          onClick={(event) => openPanel({ kind: "game", id: game.id }, event.timeStamp)}
          aria-label={`${game.name}. ${game.found ? all.map((c) => c.label).join(", ") : "Not found on this computer"}. ${meta}.${game.cantRun ? ` ${game.cantRun}` : ""}`}
          style={{ "--game-colour": game.colour } as React.CSSProperties}
        >
          <GameArt id={game.id} name={game.name} />
          <span className="db-game__text">
            <span className="db-game__name">{game.name}</span>
            <span className="db-game__meta" title={game.lastPlayed ? `Last played ${timeAgo(game.lastPlayed)}` : undefined}>
              {meta}
            </span>
            <span className="db-game__status" data-testid="home-game-status">
              {isPlaying && <Chips chips={[{ label: "Playing now", tone: "accent" }]} />}
              {checked ? <Chips chips={shown} /> : (
                <span className="db-game__quiet">{checkingStatus ? "Checking mods…" : "Not checked"}</span>
              )}
              {game.cantRun && <Chips chips={[{ label: "Can't run on this Mac", tone: "neutral", tip: game.cantRun }]} />}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="app-screen">
      <LauncherSidebar
        current="home"
        onHome={() => {}}
        onModManager={onModManager}
        onSettings={onSettings}
      />

      <main className="app-main">
        <div className="app-logo-tint">
          <BackgroundLogo />
        </div>

        <div ref={pageScroll} className="app-page db-page">
          <header className="db-header">
            <div>
              <h1 className="db-header__title">Your games</h1>
              <p className="db-header__lead">
                Choose a game to play it, pick its profile, or open its pages.
                <span className="db-header__count" aria-live="polite">
                  {listed && detectedLoaded
                    ? ` ${plural(found.length + extraGames.length + 1, "game", "games")} on this computer${notHere.length ? `, ${notHere.length} more in More Games` : ""}.`
                    : " Looking..."}
                </span>
              </p>
            </div>
            <div className="db-library-tools">
              <SearchField wrapperClassName="db-game-search" label="Search games" placeholder="Search your games…" value={query} onChange={(event) => setQuery(event.target.value)} />
              <Segmented label="Games to show" value={filter} onChange={setFilter} options={[
                { value: "all", label: "All games" },
                { value: "attention", label: "Needs attention" },
              ]} />
            </div>
          </header>

          <div className="db-col">
              <section className="db-games" aria-labelledby="db-games-title">
                <h2 className="db-card__title db-sr" id="db-games-title">Games</h2>
                {visibleCount === 0 && !showMore && <p className="db-empty" role="status">{!listed || !detectedLoaded || !instancesLoaded || (filter === "attention" && checkingStatus) ? "Checking your games…" : scanFailed || (filter === "attention" && statusFailed) ? "Results are incomplete. Retry the checks below." : filter === "attention" && !query.trim() ? "No checked games need attention." : "No games match these filters."}</p>}
                {(query || filter !== "all") && (
                  <div className="db-filter-summary">
                    <span>{query.trim() ? `Searching for “${query.trim()}”` : "Filtered games"}</span>
                    <Button size="sm" variant="ghost" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</Button>
                  </div>
                )}
                <ul className="db-games__list">
                  {showMinecraft && <li>
                    <button
                      type="button"
                      className="db-game"
                      onClick={(event) => openPanel({ kind: "minecraft" }, event.timeStamp)}
                      data-testid="home-minecraft"
                      data-home-card="minecraft"
                      aria-haspopup="dialog"
                      style={
                        {
                          "--game-colour": "var(--color-accent-line)",
                        } as React.CSSProperties
                      }
                    >
                      <GameArt id="minecraft" name="Minecraft" />
                      <span className="db-game__text">
                        <span className="db-game__name">Minecraft</span>
                        <span className="db-game__meta" title={latest?.lastPlayed ? `Last played ${latest.name}, ${timeAgo(latest.lastPlayed)}` : undefined}>
                          {stats.loading && !stats.data ? "Checking play time…" : stats.data?.totals.playSeconds ? `${formatHours(stats.data.totals.playSeconds)} played` : "No play time yet"}
                          {" · "}
                          {instanceLoadError ? "Library check unavailable" : plural(instances.length, "instance", "instances")}
                        </span>
                        <span className="db-game__status">
                          {running ? <Chips chips={[{ label: "Playing now", tone: "accent" }]} /> : latest?.lastPlayed ? (
                            <Chips chips={[{ label: `${latest.name}, ${timeAgo(latest.lastPlayed)}`, tone: "neutral", icon: "clock" }]} />
                          ) : (
                            <span className="db-game__quiet">Not played yet</span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>}
                  {visibleGames.map(gameRow)}
                  {visibleExtra.map((game) => (
                    <li key={game.id}>
                      <button type="button" className="db-game" data-testid="home-game" onClick={() => onModGame(game)}>
                        <GameArt id={game.id} name={game.name} />
                        <span className="db-game__text">
                          <span className="db-game__name">{game.name}</span>
                          <span className="db-game__meta">Mod management</span>
                          <span className="db-game__status"><Chips chips={[{ label: "Installed", tone: "neutral" }]} /></span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {showMore && (
                    <li>
                      <button type="button" className="db-game db-more" data-testid="home-more-games" onClick={onModManager}>
                        <span className="db-game__art db-more__art" aria-hidden="true">
                          {covers.map((id) => <img key={id} src={artOf(id)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} />)}
                          <span className="db-more__plus"><Plus size={22} /></span>
                        </span>
                        <span className="db-game__text">
                          <span className="db-game__name">More games</span>
                          <span className="db-game__meta">
                            {notHere.length ? `${plural(notHere.length, "supported game", "supported games")} not on this computer` : "Every supported game, found or not"}
                          </span>
                          <span className="db-game__status"><span className="db-game__quiet">{previewNames.length ? `${previewNames.join(", ")} and more` : "Browse and rescan"}</span></span>
                        </span>
                      </button>
                    </li>
                  )}
                </ul>
              </section>

              {(scanFailed || statusFailed || instanceLoadError) && <Notice tone="warning" actions={<Button size="sm" variant="ghost" onClick={retryScan}>Retry</Button>}>
                {instanceLoadError ?? (scanFailed ? "Some games could not be loaded." : "Some game checks could not be completed.")}
              </Notice>}
              {attention.length > 0 && (
                <p className="db-games__alert">
                  <CircleAlert size={14} aria-hidden="true" />
                  {listNames(attention)}{" "}
                  {attention.length === 1 ? "needs" : "need"} a look.
                </p>
              )}

              <Tabs label="Launcher dashboard" value={view} onChange={setView} idBase="home-dashboard" tabs={[
                { value: "activity", label: "Your activity" },
                { value: "news", label: "News & deals" },
              ]} />
              <div id="home-dashboard-panel-news" role="tabpanel" aria-labelledby="home-dashboard-tab-news" hidden={view !== "news"} className="db-dashboard-panel">
              {/* What's happening in games: news from the big gaming sites beside Steam's deals. */}
              <div className="db-grid db-grid--media">
                <NewsPanel
                  news={news.data}
                  loading={news.loading}
                  failed={news.failed}
                  onRefresh={refreshNews}
                  title="Gaming news"
                  from="PC Gamer, Eurogamer, IGN, GameSpot and more"
                  more={6}
                />
                <DealsPanel deals={deals.data} loading={deals.loading} failed={deals.failed} onRefresh={refreshDeals} />
              </div>

              </div>
              <div id="home-dashboard-panel-activity" role="tabpanel" aria-labelledby="home-dashboard-tab-activity" hidden={view !== "activity"} className="db-dashboard-panel">
              <div className="db-grid">
                <div className="db-col">
                <PlayStats stats={stats.data} loading={stats.loading} failed={stats.failed} range={range} onRange={setRange}
                  gamePlay={gamePlay}
                  onGame={(id) => (id === "minecraft" ? onMinecraft() : onGame(id as GameId))}
                  show={["trend", "most"]} games={[
                    ...games.map(({ id, name, colour }) => ({ id, name, colour })),
                    ...extraGames.map(({ name }) => ({ name, colour: "var(--color-text-muted)" })),
                  ]} />
                </div>
                <ActivityPanel items={activity.data} loading={activity.loading} failed={activity.failed} />
              </div>
              </div>
          </div>
        </div>

        {panel && (
          <div
            className="lx-scrim"
            aria-hidden="true"
            onClick={(event) => {
              if (event.detail > 1 && event.timeStamp - panelOpenedAt.current < 700) openWorkspace(panel);
              else closePanel();
            }}
          />
        )}
        {panel && (
          <HomeGamePanel
            key={panel.kind === "minecraft" ? "minecraft" : panel.id}
            target={panel}
            game={panel.kind === "game" ? games.find((g) => g.id === panel.id) : undefined}
            chips={panel.kind === "game" ? (() => {
              const game = games.find((g) => g.id === panel.id);
              return game?.found && statuses[game.id] ? chips(game).filter((c) => !(game.cantRun && c.tone === "success")) : [];
            })() : undefined}
            instances={instances}
            reloadInstances={() => void reloadInstances()}
            onClose={closePanel}
            onMinecraft={(page, instance) => onMinecraft(page, instance)}
            onGame={(id, page) => onGame(id, page)}
          />
        )}
      </main>
    </div>
  );
}

export default HomeScreen;
