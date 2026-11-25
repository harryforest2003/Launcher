import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Box,
  Compass,
  Download,
  House,
  LayoutGrid,
  Layers,
  ListOrdered,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Shirt,
  Sparkles,
  Wrench,
} from "lucide-react";
import logoMark from "../../assets/logo-mark.png";
import AccountSwitcher from "../AccountSwitcher";
import RunningGames from "./RunningGames";
import { useGameArt } from "../../pages/gameArt";
import Monogram from "./Monogram";
import { useDownloads } from "./downloadsContext";
import { restartToUpdate, useAppUpdate } from "../appUpdate";
import type { GamePageKey, McPage, PageNav } from "./shellContext";
import { MOD_KEY } from "../../utils/modKey";
import "./shell.css";

export type ShellTarget =
  | { kind: "home" }
  | { kind: "settings" }
  | { kind: "modmanager" }
  | { kind: "modGame"; page: "installed" | "browse" }
  | { kind: "mc"; page: McPage }
  | { kind: "game"; id: GameId; page?: GamePageKey };

type Props = {
  /** Which item is on: "home", "settings", "modmanager", "mc:library", "game:sims4", "game:sims4:mods". */
  current: string;
  /** The page's own report (which sub-page, Back, overridden handlers). */
  nav: PageNav | null;
  openGame: GameId | null;
  collapsed: boolean;
  onToggle: () => void;
  /** Opens the search palette (also Cmd/Ctrl+K). */
  onSearch: () => void;
  go: (target: ShellTarget) => void;
};


const MC_ITEMS: { page: McPage; label: string; icon: ReactNode }[] = [
  { page: "minecraft", label: "Home", icon: <House size={16} /> },
  { page: "library", label: "Library", icon: <LayoutGrid size={15} /> },
  { page: "discover", label: "Discover", icon: <Compass size={15} /> },
  { page: "skins", label: "Skin Selector", icon: <Shirt size={15} /> },
  { page: "skinbuilder", label: "Model Builder", icon: <Box size={15} /> },
  { page: "settings", label: "Settings", icon: <SlidersHorizontal size={15} /> },
];

const GAME_PAGES: { page: GamePageKey; label: string; icon: ReactNode; when?: "cc" | "loadorder" | "tools" }[] = [
  { page: "home", label: "Home", icon: <House size={16} /> },
  { page: "mods", label: "Mods", icon: <Puzzle size={15} /> },
  { page: "discover", label: "Discover", icon: <Compass size={15} /> },
  { page: "cc", label: "Custom Content (CC)", icon: <Sparkles size={15} />, when: "cc" },
  { page: "loadorder", label: "Load Order", icon: <ListOrdered size={15} />, when: "loadorder" },
  { page: "tools", label: "Tools", icon: <Wrench size={15} />, when: "tools" },
  { page: "settings", label: "Settings", icon: <SlidersHorizontal size={15} /> },
];

/* The last name each page reported, so a title never blanks between pages. */
const gameNames = new Map<string, string>();

/* A game's picture, cropped square; its initials if there's no picture or it can't load. */
function GameThumb({ id, name, large = false }: { id: string | null; name: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = useGameArt([id])(id);
  return (
    <span className={`ui-shell__thumb${large ? " ui-shell__thumb--lg" : ""}`} aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <Monogram name={name} size={large ? 32 : 28} style={{ width: "100%", height: "100%" }} />
      )}
    </span>
  );
}

/* Every supported game, for the launcher's lists (found ones first). Minecraft is its own. */
function useFoundGames(refresh: unknown) {
  const [games, setGames] = useState<GameSummary[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => {
      Promise.resolve()
        .then(() => window.gamesAPI?.list?.())
        .then((list) => {
          if (live && Array.isArray(list)) setGames(list);
        })
        .catch(() => {
          // The list stays as it was; the Home page says why games couldn't be checked.
        });
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      live = false;
      window.removeEventListener("focus", load);
    };
  }, [refresh]);
  return games;
}

export default function AppSidebar({ current, nav, openGame, collapsed, onToggle, onSearch, go }: Props) {
  const downloads = useDownloads();
  // Read again on every page change, so a game added in More Games shows up at once.
  const allGames = useFoundGames(`${current}:${openGame ?? ""}`);
  // Only what's on this computer: the rest wait in More Games until they're installed.
  const games = allGames.filter((game) => game.found);
  const scroller = useRef<HTMLDivElement>(null);
  const [mark, setMark] = useState<{ top: number; height: number } | null>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const section = useRef<string>("");

  // The highlight slides to the current item: measured after layout, and again when the
  // sidebar folds or the list changes height.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    // Moving between lists (launcher, a game, Minecraft): the highlight jumps instead of sliding
    // across rows that aren't the same ones, which read as a flicker.
    const kind = current.startsWith("mc:") ? "mc" : openGame ?? (nav?.area === "modGame" ? "modGame" : "home");
    if (section.current && section.current !== kind && bar.current) {
      const node = bar.current;
      node.style.transition = "none";
      requestAnimationFrame(() => requestAnimationFrame(() => { node.style.transition = ""; }));
    }
    section.current = kind;
    const measure = () => {
      const el = box.querySelector<HTMLElement>("[data-current='true']");
      setMark(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [current, collapsed, nav, openGame]);

  const tip = (label: string) => (collapsed ? label : undefined);

  const item = (key: string, label: string, icon: ReactNode, onClick: () => void, extra?: { aria?: string; badge?: ReactNode; sub?: boolean; game?: boolean; meta?: string; dim?: boolean }) => {
    const on = current === key;
    return (
      <button
        key={key}
        type="button"
        className={`ui-shell__item${extra?.sub ? " ui-shell__item--sub" : ""}${extra?.game ? " ui-shell__item--game" : ""}${extra?.dim ? " ui-shell__item--dim" : ""}`}
        data-current={on ? "true" : undefined}
        aria-current={on ? "page" : undefined}
        aria-label={extra?.aria}
        data-tip={tip(extra?.aria ?? label)}
        onClick={onClick}
      >
        <span className="ui-shell__icon">{icon}</span>
        <span className="ui-shell__label">
          <span className="ui-shell__name">{label}</span>
          {extra?.meta && <span className="ui-shell__meta">{extra.meta}</span>}
        </span>
        {extra?.badge}
      </button>
    );
  };

  const back = nav?.area === "minecraft" || nav?.area === "game" ? nav.back : null;
  const backRow = back && (
    <button key="back" type="button" className="ui-shell__back" data-tip={tip(back.label)} aria-label={collapsed ? back.label : undefined} onClick={back.run}>
      <ArrowLeft size={14} aria-hidden="true" />
      <span className="ui-shell__label">{back.label}</span>
    </button>
  );

  const gameNav = nav?.area === "game" ? nav : null;
  const inMinecraft = current.startsWith("mc:");
  const modGame = nav?.area === "modGame" ? nav : null;
  const inGame = inMinecraft || openGame !== null || modGame !== null;
  const nameKey = inMinecraft ? "minecraft" : openGame ?? "modGame";
  const knownName = inMinecraft ? "Minecraft" : gameNav?.game ?? modGame?.game ?? games.find((game) => game.id === openGame)?.name ?? "";
  // The title never goes blank while a page reports its game: keep the last name, else the id.
  if (knownName) gameNames.set(nameKey, knownName);
  const gameName = knownName || gameNames.get(nameKey) || openGame || "";
  const gameArt = inMinecraft ? "minecraft" : openGame;

  return (
    <aside className={`ui-shell${collapsed ? " is-collapsed" : ""}`} aria-label="Launcher" data-testid="sidebar" data-tip-side={collapsed ? "right" : undefined}>
      <div className="ui-shell__brand">
        <img className="ui-shell__mark" src={logoMark} alt="" draggable={false} />
        <span className="ui-shell__wordmark">Unity Launcher</span>
      </div>
      <UpdateReady tip={tip} />
      <div className="ui-shell__scroll" ref={scroller}>
        <span
          ref={bar}
          className="ui-shell__mark-bar"
          aria-hidden="true"
          style={mark ? { transform: `translateY(${mark.top}px)`, height: mark.height, opacity: 1 } : { opacity: 0 }}
        />
        <nav aria-label="Pages" className="ui-shell__nav">
          {inGame ? (
            <>
              {item("launcher", "Back to Launcher", <ArrowLeft size={16} />, () => go({ kind: "home" }))}
              <div className="ui-shell__heading ui-shell__heading--game" role="group" aria-label={gameName} data-tip={tip(gameName)} tabIndex={collapsed ? 0 : undefined}>
                <GameThumb key={gameArt ?? gameName} id={gameArt} name={gameName} large />
                <span className="ui-shell__label">{gameName}</span>
              </div>
              {inMinecraft
                ? MC_ITEMS.map(({ page, label, icon }) => [
                    item(`mc:${page}`, label, icon, () => go({ kind: "mc", page })),
                    current === `mc:${page}` && backRow,
                  ])
                : modGame ? [
                    item("modGame:installed", "Installed Mods", <Puzzle size={15} />, () => go({ kind: "modGame", page: "installed" })),
                    item("modGame:browse", "Browse Mods", <Compass size={15} />, () => go({ kind: "modGame", page: "browse" })),
                  ]
                : openGame && GAME_PAGES.filter(({ when }) =>
                    !when || (when === "cc" ? gameNav?.hasCC : when === "tools" ? gameNav?.hasTools : gameNav?.hasLoadOrder),
                  ).map(({ page, label, icon }) => [
                    item(`game:${openGame}:${page}`, label, icon, () => go({ kind: "game", id: openGame, page })),
                    page === "discover" && backRow,
                  ])}
            </>
          ) : (
            <>
              {item("home", "Home", <House size={16} />, () => go({ kind: "home" }))}
              {item("modmanager", "More Games", <Layers size={16} />, () => go({ kind: "modmanager" }))}
              <div className="ui-shell__heading">
                <span className="ui-shell__label">Your games</span>
              </div>
              {item("play:minecraft", "Minecraft", <GameThumb id="minecraft" name="Minecraft" />, () => go({ kind: "mc", page: "minecraft" }), { game: true, meta: "Java Edition" })}
              {games.map((game) =>
                item(`play:${game.id}`, game.name, <GameThumb key={game.id} id={game.id} name={game.name} />, () => go({ kind: "game", id: game.id }), {
                  game: true,
                  meta: game.modCount ? `${game.modCount} ${game.modCount === 1 ? "mod" : "mods"}` : "No mods yet",
                }),
              )}
            </>
          )}
        </nav>
      </div>

      <div className="ui-shell__foot">
        <RunningGames tip={tip} onOpen={() => go({ kind: "mc", page: "library" })} />
        <button
          type="button"
          className="ui-shell__item"
          aria-haspopup="dialog"
          aria-keyshortcuts={MOD_KEY === "⌘" ? "Meta+K" : "Control+K"}
          aria-label="Search"
          data-tip={tip(`Search (${MOD_KEY}K)`)}
          data-testid="open-search"
          onClick={onSearch}
        >
          <span className="ui-shell__icon">
            <Search size={16} />
          </span>
          <span className="ui-shell__label">Search</span>
          <kbd className="ui-shell__badge ui-shell__label ui-shell__kbd">{MOD_KEY}K</kbd>
        </button>
        <button
          type="button"
          className="ui-shell__item"
          aria-expanded={downloads.shown}
          data-downloads-toggle=""
          aria-label={downloads.left ? `Downloads, ${downloads.left} to go` : "Downloads"}
          data-tip={tip(downloads.left ? `Downloads: ${downloads.left} to go` : "Downloads")}
          onClick={downloads.toggle}
        >
          <span className="ui-shell__icon">
            <Download size={16} />
            {downloads.left > 0 && <span className="ui-shell__dot" aria-hidden="true" />}
          </span>
          <span className="ui-shell__label">Downloads</span>
          {downloads.left > 0 && <span className="ui-shell__badge ui-shell__label">{downloads.left}</span>}
        </button>
        {!inGame && item("settings", "Settings", <Settings size={16} />, () => go({ kind: "settings" }), { aria: "Launcher settings" })}
        <div className="ui-shell__account">
          <AccountSwitcher compact rail={collapsed} game={inMinecraft ? "minecraft" : openGame} />
        </div>
        <button
          type="button"
          className="ui-shell__fold"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          data-tip={collapsed ? `Expand sidebar (${MOD_KEY}B)` : `Collapse sidebar (${MOD_KEY}B)`}
        >
          <span className="ui-shell__icon">
            {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
          </span>
          <span className="ui-shell__label">Collapse</span>
        </button>
      </div>
    </aside>
  );
}

/* A newer build is downloaded: under the title until the launcher restarts into it. */
function UpdateReady({ tip }: { tip: (label: string) => string | undefined }) {
  const update = useAppUpdate();
  const [restarting, setRestarting] = useState(false);
  if (update.status !== "ready") return null;

  const label = restarting ? "Restarting..." : "Update ready: restart";
  return (
    <div className="ui-shell__update">
      <button
        type="button"
        className="ui-shell__item ui-shell__item--update"
        data-testid="update-ready"
        aria-label="An update is ready. Restart Unity Launcher to use it."
        data-tip={tip(label)}
        disabled={restarting}
        onClick={() => {
          setRestarting(true);
          restartToUpdate()?.then((started) => started || setRestarting(false), () => setRestarting(false));
        }}
      >
        <span className="ui-shell__icon">
          <RefreshCw size={16} />
        </span>
        <span className="ui-shell__label">{label}</span>
      </button>
    </div>
  );
}
