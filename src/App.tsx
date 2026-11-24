import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import HomeScreen from "./pages/GameMenu";
import LauncherSettings from "./pages/LauncherSettings";
import MinecraftMenu from "./pages/MinecraftMenu";
import DiscoverContent from "./pages/MCDiscover";
import Library from "./pages/MCLibrary";
import SkinSelector from "./pages/MCSkinSelector";
import Settings from "./pages/MCSettings";
import ModDescription from "./pages/ModDescription";
import ModGames from "./pages/ModGames";
import GameSection from "./pages/GameSection";
import SkinBuilder from "./pages/SkinBuilder";
import { SkinBuilderNavContext } from "./skinBuilder/navContext";
import DownloadQueue from "./components/DownloadQueue";
import { DownloadsContext, useDownloadQueueState } from "./components/ui/downloadsContext";
import { SidebarBackLabel } from "./components/ui/sidebarContext";
import AppSidebar, { type ShellTarget } from "./components/ui/AppSidebar";
import { ShellContext, navKey, type McPage, type PageNav, type Shell } from "./components/ui/shellContext";
import Toaster from "./components/ui/Toaster";
import { leaveBlockbench } from "./components/leaveBlockbench";
import { requestLaunch } from "./utils/launchRequests";

export type Screen =
  | "home"
  | "minecraft"
  | "discover"
  | "mod"
  | "library"
  | "skins"
  | "skinbuilder"
  | "settings"
  | "launcherSettings"
  | "modmanager"
  | "game";

type Route = { screen: Screen; gameId: GameId; modGame?: DetectedGame };

// How long the old page takes to fade out before the new one comes in (ms).
const LEAVE_MS = 110;
const FOLD_KEY = "unity-launcher-sidebar";
const NARROW = 1240;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/* Discover and a project page share one stage, so Discover stays alive behind the project. */
const stageKey = ({ screen, gameId }: Route) => (screen === "mod" ? "discover" : screen === "game" ? `game:${gameId}` : screen);

const MC_SCREENS: Record<McPage, Screen> = {
  minecraft: "minecraft",
  discover: "discover",
  library: "library",
  skins: "skins",
  skinbuilder: "skinbuilder",
  settings: "settings",
};

function readFold(): "auto" | "open" | "folded" {
  try {
    const saved = localStorage.getItem(FOLD_KEY);
    return saved === "open" || saved === "folded" ? saved : "auto";
  } catch {
    return "auto";
  }
}

/* Which sidebar item is on, from the page being asked for and what that page reports. */
function currentItem({ screen, gameId }: Route, nav: PageNav | null): string {
  switch (screen) {
    case "home":
      return "home";
    case "launcherSettings":
      return "settings";
    case "modmanager":
      return nav?.area === "modGame" ? `modGame:${nav.page}` : "modmanager";
    case "mod":
      return "mc:discover";
    case "game":
      if (nav?.area !== "game") return `game:${gameId}:home`;
      return `game:${gameId}:${nav.page ?? "discover"}`;
    default:
      return `mc:${screen}`;
  }
}

function App() {
  // The page asked for, and the page on screen: they differ while the old one fades out.
  const [route, setRoute] = useState<Route>({ screen: "home", gameId: "sims4" });
  const [shown, setShown] = useState<Route>(route);
  const [leaving, setLeaving] = useState(false);

  // Leaving a page: it fades out, then the new one fades in (at once with reduced motion).
  const target = useRef(route);
  const swap = useRef(0);
  const navigate = useCallback((update: (now: Route) => Route) => {
    const next = update(target.current);
    if (next.screen === target.current.screen && next.gameId === target.current.gameId && next.modGame === target.current.modGame) return;
    target.current = next;
    setRoute(next);
    window.clearTimeout(swap.current);
    if (reducedMotion()) {
      setShown(next);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    swap.current = window.setTimeout(() => {
      setShown(target.current);
      setLeaving(false);
    }, LEAVE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(swap.current), []);

  // A desktop shortcut: the Library opens and plays that instance.
  useEffect(
    () =>
      window.instanceAPI?.onShortcutLaunch?.((name) => {
        requestLaunch(name);
        navigate((now) => ({ ...now, screen: "library", modGame: undefined }));
      }),
    [navigate]
  );

  const setScreen = useCallback((screen: Screen) => navigate((now) => ({ ...now, screen, modGame: undefined })), [navigate]);
  const openGame = useCallback((gameId: GameId) => navigate(() => ({ screen: "game", gameId })), [navigate]);

  // The game sections' download queue: the corner panel and the sidebar's Downloads button.
  const downloads = useDownloadQueueState();

  // What the page on screen tells the sidebar (see shellContext.ts). The newest one wins: a
  // project page over the Discover kept alive behind it.
  const pages = useRef(new Map<string, PageNav>());
  const pageKeys = useRef(new Map<string, string>());
  const [, redraw] = useState(0);
  const shell = useMemo<Shell>(
    () => ({
      register(id, nav) {
        pages.current.set(id, nav);
        const key = navKey(nav);
        if (pageKeys.current.get(id) !== key) {
          pageKeys.current.set(id, key);
          redraw((n) => n + 1);
        }
      },
      unregister(id) {
        pages.current.delete(id);
        pageKeys.current.delete(id);
        redraw((n) => n + 1);
      },
    }),
    []
  );
  const latestNav = (): PageNav | null => {
    const registered = [...pages.current.values()];
    return registered.find((page) => page.area === "modGame") ?? registered.at(-1) ?? null;
  };
  // eslint-disable-next-line react-hooks/refs -- the map is kept in step by redraw()
  const nav = latestNav();

  // The sidebar folds to icons: remembered; on its own below NARROW px until the user picks.
  const [fold, setFold] = useState(readFold);
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const collapsed = fold === "folded" || (fold === "auto" && narrow);
  const toggleFold = useCallback(() => {
    const next = collapsed ? "open" : "folded";
    setFold(next);
    try {
      localStorage.setItem(FOLD_KEY, next);
    } catch {
      // Not remembered this time; it still folds.
    }
  }, [collapsed]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "b" || event.altKey || event.shiftKey) return;
      const el = event.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      toggleFold();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFold]);

  const leavingNow = useRef(false);
  const go = async (target: ShellTarget) => {
    if (leavingNow.current) return;
    leavingNow.current = true;
    try {
      // Blockbench, if open, asks to save first; Cancel stays.
      if (!(await leaveBlockbench())) return;
    } finally {
      leavingNow.current = false;
    }
    const page = latestNav();
    if (target.kind === "modGame") {
      if (shown.screen === "modmanager" && page?.area === "modGame") {
        navigate(() => shown);
        page.go(target.page);
      }
    } else if (target.kind === "mc") {
      const own = page?.area === "minecraft" ? page.handlers[target.page] : undefined;
      if (own) own();
      else setScreen(MC_SCREENS[target.page]);
    } else if (target.kind === "game") {
      const here = shown.screen === "game" && shown.gameId === target.id && page?.area === "game";
      if (here) {
        // The sidebar belongs to the displayed game until the fade finishes. A new
        // choice in that sidebar cancels an earlier request to leave the game.
        navigate(() => shown);
        page.go(target.page ?? "home");
      }
      else openGame(target.id);
    } else {
      const own = page?.area === "launcher" ? page.handlers[target.kind] : undefined;
      if (own) own();
      else setScreen(target.kind === "home" ? "home" : target.kind === "settings" ? "launcherSettings" : "modmanager");
    }
  };


  return (
    <SkinBuilderNavContext.Provider value={() => setScreen("skinbuilder")}>
      <DownloadsContext.Provider value={downloads}>
        <ShellContext.Provider value={shell}>
          <div className="ui-frame">
            <AppSidebar
              current={currentItem(shown, nav)}
              nav={nav}
              openGame={shown.screen === "game" ? shown.gameId : null}
              collapsed={collapsed}
              onToggle={toggleFold}
              go={go}
            />
            <div className="ui-stage">
              <div key={stageKey(shown)} className={`ui-stage__page${leaving ? " is-leaving" : ""}`}>
                <Screens route={shown} setScreen={setScreen} openGame={openGame} openModGame={(modGame) => navigate((now) => ({ ...now, screen: "modmanager", modGame }))} />
              </div>
            </div>
          </div>
          {/* The game sections' downloads carry on, and show, whichever page is open. */}
          <DownloadQueue />
          <Toaster />
        </ShellContext.Provider>
      </DownloadsContext.Provider>
    </SkinBuilderNavContext.Provider>
  );
}

function Screens({
  route: { screen, gameId, modGame },
  setScreen,
  openGame,
  openModGame,
}: {
  route: Route;
  setScreen: (screen: Screen) => void;
  openGame: (id: GameId) => void;
  openModGame: (game: DetectedGame) => void;
}) {

  const navigation = {
    goHome: () => setScreen("home"),
    goMinecraft: () => setScreen("minecraft"),
    goDiscover: () => setScreen("discover"),
    goLibrary: () => setScreen("library"),
    goSkinSelector: () => setScreen("skins"),
    goSettings: () => setScreen("settings"),
  };

  // The project on show comes last, after any it was reached from through a link.
  const [projectTrail, setProjectTrail] = useState<
    { source: "modrinth" | "curseforge"; id: string }[]
  >([]);

  const openMod = (source: "modrinth" | "curseforge", id: string) => {
    setProjectTrail([{ source, id }]);
    setScreen("mod");
  };

  const selectedProject = projectTrail[projectTrail.length - 1];

  // Discover stays alive behind a project page, so Back returns to the same page of
  // results with the same filters.
  if (screen === "discover" || screen === "mod") {
    return (
      <>
        <div style={{ display: screen === "discover" ? "contents" : "none" }}>
          <DiscoverContent
            {...navigation}
            onBack={navigation.goMinecraft}
            openMod={openMod}
          />
        </div>

        {screen === "mod" && (
          // The sidebar's Back, under Discover Content, says where it goes.
          <SidebarBackLabel.Provider value={projectTrail.length > 1 ? "Back to the last project" : "Back to results"}>
            <ModDescription
              {...navigation}
              source={selectedProject.source}
              projectId={selectedProject.id}
              openProject={(source, id) => setProjectTrail((trail) => [...trail, { source, id }])}
              onBack={() => {
                if (projectTrail.length > 1) setProjectTrail((trail) => trail.slice(0, -1));
                else setScreen("discover");
              }}
            />
          </SidebarBackLabel.Provider>
        )}
      </>
    );
  }

  switch (screen) {
    case "home":
      return (
        <HomeScreen
          onMinecraft={navigation.goMinecraft}
          onGame={openGame}
          onModGame={openModGame}
          onModManager={() => setScreen("modmanager")}
          onSettings={() => setScreen("launcherSettings")}
        />
      );

    case "game":
      return <GameSection key={gameId} gameId={gameId} onLauncher={navigation.goHome} onLauncherSettings={() => setScreen("launcherSettings")} />;

    case "launcherSettings":
      return <LauncherSettings onHome={navigation.goHome} onModManager={() => setScreen("modmanager")} />;

    case "modmanager":
      return (
        <ModGames
          initialGame={modGame}
          onBack={navigation.goHome}
          onMinecraft={navigation.goMinecraft}
          onGame={openGame}
          onSettings={() => setScreen("launcherSettings")}
        />
      );

    case "minecraft":
      return (
        <MinecraftMenu
          {...navigation}
          onBack={navigation.goHome}
        />
      );

    case "library":
      return (
        <Library
          {...navigation}
          onBack={navigation.goMinecraft}
        />
      );

    case "skins":
      return (
        <SkinSelector
          {...navigation}
          onBack={navigation.goMinecraft}
        />
      );

    case "skinbuilder":
      return (
        <SkinBuilder
          {...navigation}
          onBack={navigation.goMinecraft}
        />
      );

    case "settings":
      return (
        <Settings
          {...navigation}
          onBack={navigation.goMinecraft}
        />
      );

    default:
      return null;
  }
}

export default App;
