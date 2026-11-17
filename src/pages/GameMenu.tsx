import { useEffect, useState } from "react";
import {
  CircleAlert,
  TriangleAlert,
  ArrowUpRight,
} from "lucide-react";
import BackgroundLogo from "../components/BackgroundLogo";
import LauncherSidebar from "../components/LauncherSidebar";
import { Badge, Button, Notice, SearchField, Segmented, Tabs, type Tone } from "../components/ui";
import { formatHours } from "../components/charts";
import ActivityPanel from "./dashboard/ActivityPanel";
import DealsPanel from "./dashboard/DealsPanel";
import NewsPanel from "./dashboard/NewsPanel";
import { MINECRAFT_ART } from "./dashboard/PlayHero";
import PlayStats from "./dashboard/PlayStats";
import { defaultRange, type Range } from "./dashboard/range";
import { useDashboard } from "./dashboard/useDashboard";
import { useInstances } from "./dashboard/useInstances";
import { initials, timeAgo } from "./playedAgo";
import { useScrollMemory } from "./useScrollMemory";
import "./dashboard/dashboard.css";

type Props = {
  onMinecraft: () => void;
  onGame: (id: GameId) => void;
  onModGame: (game: DetectedGame) => void;
  onModManager: () => void;
  onSettings: () => void;
};

/* Each game's own picture: its Steam library art, and Minecraft's from the Minecraft Launcher's
   release notes. Greyed for games that aren't on this computer; offline, initials stand in. */
const steamArt = (appId: string) =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_231x87.jpg`;
const ART: Record<string, string> = {
  minecraft: MINECRAFT_ART,
  sims4: steamArt("1222670"),
  gtav: steamArt("271590"),
  skyrimse: steamArt("489830"),
  fallout4: steamArt("377160"),
  cyberpunk2077: steamArt("1091500"),
  stardew: steamArt("413150"),
  terraria: steamArt("105600"),
  palworld: steamArt("1623730"),
  valheim: steamArt("892970"),
  bg3: steamArt("1086940"),
  rimworld: steamArt("294100"),
};

type Chip = { label: string; tone: Tone };

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
  const src = ART[id];
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
        <span className="db-thumb__mark">{initials(name)}</span>
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
          {chip.tone === "danger" && (
            <CircleAlert size={12} aria-hidden="true" />
          )}
          {chip.tone === "warning" && (
            <TriangleAlert size={12} aria-hidden="true" />
          )}
          {chip.label}
        </Badge>
      ))}
    </span>
  );
}

// Keep navigation context for this launcher session, without saving searches to disk.
const homeContext: {
  query: string;
  filter: "all" | "installed" | "attention";
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
  // The time range for the play time cards; until chosen, one that has play in it.
  const [chosenRange, setRange] = useState<Range | null>(null);
  const range = chosenRange ?? defaultRange(stats.data);
  const pageScroll = useScrollMemory("launcher-home", listed && detectedLoaded && instancesLoaded &&
    (view === "activity" ? !stats.loading && !activity.loading : !news.loading && !deals.loading));

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => window.modAPI.getGames())
      .then((items) => { if (active) setDetected(items); })
      .catch(() => { if (active) setScanFailed(true); })
      .finally(() => { if (active) setDetectedLoaded(true); });
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
  const found = games.filter((g) => g.found);
  const missing = games.filter((g) => !g.found);
  const chips = (game: GameSummary) => chipsFor(game, statuses[game.id]);
  const attention = found.filter((g) => needsLook(chips(g))).map((g) => g.name);
  const matches = (name: string) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const visibleGames = [...found, ...missing].filter((game) =>
    matches(game.name) && (filter === "all" || (filter === "installed" ? game.found : needsLook(chips(game)))));
  const visibleExtra = extraGames.filter((game) => matches(game.name) && filter !== "attention");
  const showMinecraft = matches("Minecraft") && filter !== "attention" && (filter === "all" || instances.length > 0);
  const visibleCount = visibleGames.length + visibleExtra.length + Number(showMinecraft);
  const isMac = navigator.platform.includes("Mac");

  const latest = instances[0];
  const running = instances.find((i) => i.running);
  const gameRow = (game: GameSummary) => {
    const all = chips(game);
    const looking = all.filter(
      (c) => c.tone === "danger" || c.tone === "warning",
    );
    const shown = game.found ? summarise(all) : all;
    const meta = game.found
      ? `${plural(game.modCount, "enabled mod", "enabled mods")}`
      : game.windowsOnly && isMac
        ? "Windows game: CrossOver or Whisky"
        : "Choose its folder";
    return (
      <li key={game.id}>
        <button
          type="button"
          className={`db-game${game.found ? "" : " db-game--missing"}`}
          data-testid="home-game"
          onClick={() => onGame(game.id)}
          aria-label={`${game.name}. ${game.found ? all.map((c) => c.label).join(", ") : "Not found on this computer"}. ${meta}.`}
          style={{ "--game-colour": game.colour } as React.CSSProperties}
        >
          <GameArt id={game.id} name={game.name} />
          <span className="db-game__text">
            <span className="db-game__name">{game.name}</span>
            <span className="db-game__meta">{meta}</span>
            {/* What needs a look gets a line of its own. */}
            {looking.length > 0 && (
              <Chips chips={shown} testId="home-game-status" />
            )}
            {game.lastPlayed && <span className="db-game__meta">Launched {timeAgo(game.lastPlayed)}</span>}
          </span>
          <span className="db-game__footer">
            <span>{game.found ? "Open game" : "Set up game"}</span>
            <ArrowUpRight size={15} aria-hidden="true" />
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
              <h1 className="db-header__title">Launcher home</h1>
              <p className="db-header__lead">Choose a game to open its workspace.</p>
            </div>
          </header>

          <div className="db-col">
              <section
                className="db-card db-games"
                aria-labelledby="db-games-title"
              >
                <header className="db-card__head">
                  <h2 className="db-card__title" id="db-games-title">
                    Your games
                  </h2>
                  <span className="db-card__meta" aria-live="polite">
                    {listed && detectedLoaded
                      ? `${games.length + extraGames.length + 1} supported games`
                      : "Looking..."}
                  </span>
                </header>
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
                <div className="db-library-tools">
                  <SearchField wrapperClassName="db-game-search" label="Search games" placeholder="Search your games…" value={query} onChange={(event) => setQuery(event.target.value)} />
                  <Segmented label="Games to show" value={filter} onChange={setFilter} options={[
                    { value: "all", label: "All games" },
                    { value: "installed", label: "On this computer" },
                    { value: "attention", label: "Needs attention" },
                  ]} />
                </div>
                {visibleCount === 0 && <p className="db-empty" role="status">{!listed || !detectedLoaded || !instancesLoaded || (filter === "attention" && checkingStatus) ? "Checking your games…" : scanFailed || (filter === "attention" && statusFailed) ? "Results are incomplete. Retry the checks above." : filter === "attention" && !query.trim() ? "No checked games need attention." : "No games match these filters."}</p>}
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
                      onClick={onMinecraft}
                      data-testid="home-minecraft"
                      style={
                        {
                          "--game-colour": "var(--color-accent-line)",
                        } as React.CSSProperties
                      }
                    >
                      <GameArt id="minecraft" name="Minecraft" />
                      <span className="db-game__text">
                        <span className="db-game__name">Minecraft</span>
                        <span className="db-game__meta">
                          {latest?.lastPlayed
                            ? `${latest.name}, ${timeAgo(latest.lastPlayed)}`
                            : instanceLoadError ? "Library check unavailable" : `${plural(instances.length, "instance", "instances")}`}
                        </span>
                        {stats.data?.totals.playSeconds != null && (
                          <span className="db-game__meta">
                            {formatHours(stats.data.totals.playSeconds)} played
                          </span>
                        )}
                      </span>
                      <span className="db-game__footer"><span>Open Minecraft</span><ArrowUpRight size={15} aria-hidden="true" /></span>
                      {running && (
                        <Chips
                          chips={[{ label: "Playing now", tone: "accent" }]}
                        />
                      )}
                    </button>
                  </li>}
                  {visibleGames.map(gameRow)}
                  {visibleExtra.map((game) => (
                    <li key={game.id}>
                      <button type="button" className="db-game" data-testid="home-game" onClick={() => onModGame(game)}>
                        <GameArt id={game.id} name={game.name} />
                        <span className="db-game__text">
                          <span className="db-game__name">{game.name}</span>
                          <span className="db-game__meta">Installed · Mod management</span>
                        </span>
                        <span className="db-game__footer"><span>Open game</span><ArrowUpRight size={15} aria-hidden="true" /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

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
                  show={["trend", "most"]} games={[
                    ...games.map(({ name, colour }) => ({ name, colour })),
                    ...extraGames.map(({ name }) => ({ name, colour: "var(--color-text-muted)" })),
                  ]} />
                </div>
                <ActivityPanel items={activity.data} loading={activity.loading} failed={activity.failed} />
              </div>
              </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default HomeScreen;
