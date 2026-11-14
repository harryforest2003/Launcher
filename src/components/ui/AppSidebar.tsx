import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  Settings,
  SlidersHorizontal,
  Shirt,
  Sparkles,
} from "lucide-react";
import logoMark from "../../assets/logo-mark.png";
import AccountSwitcher from "../AccountSwitcher";
import { useDownloads } from "./downloadsContext";
import type { GamePageKey, McPage, PageNav } from "./shellContext";
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
  go: (target: ShellTarget) => void;
};

const MC_ITEMS: { page: McPage; label: string; icon: ReactNode }[] = [
  { page: "minecraft", label: "Home", icon: <House size={16} /> },
  { page: "library", label: "Library", icon: <LayoutGrid size={15} /> },
  { page: "discover", label: "Discover Content", icon: <Compass size={15} /> },
  { page: "skins", label: "Skin Selector", icon: <Shirt size={15} /> },
  { page: "skinbuilder", label: "Model Builder", icon: <Box size={15} /> },
  { page: "settings", label: "Settings", icon: <SlidersHorizontal size={15} /> },
];

const GAME_PAGES: { page: GamePageKey; label: string; icon: ReactNode; when?: "cc" | "loadorder" }[] = [
  { page: "home", label: "Home", icon: <House size={16} /> },
  { page: "mods", label: "Mods", icon: <Puzzle size={15} /> },
  { page: "discover", label: "Discover Mods", icon: <Compass size={15} /> },
  { page: "cc", label: "Custom Content (CC)", icon: <Sparkles size={15} />, when: "cc" },
  { page: "loadorder", label: "Load Order", icon: <ListOrdered size={15} />, when: "loadorder" },
  { page: "settings", label: "Settings", icon: <SlidersHorizontal size={15} /> },
];

export default function AppSidebar({ current, nav, openGame, collapsed, onToggle, go }: Props) {
  const downloads = useDownloads();
  const scroller = useRef<HTMLDivElement>(null);
  const [mark, setMark] = useState<{ top: number; height: number } | null>(null);

  // The highlight slides to the current item: measured after layout, and again when the
  // sidebar folds or the list changes height.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
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

  const item = (key: string, label: string, icon: ReactNode, onClick: () => void, extra?: { aria?: string; badge?: ReactNode; sub?: boolean }) => {
    const on = current === key;
    return (
      <button
        key={key}
        type="button"
        className={`ui-shell__item${extra?.sub ? " ui-shell__item--sub" : ""}`}
        data-current={on ? "true" : undefined}
        aria-current={on ? "page" : undefined}
        aria-label={extra?.aria}
        data-tip={tip(extra?.aria ?? label)}
        onClick={onClick}
      >
        <span className="ui-shell__icon">{icon}</span>
        <span className="ui-shell__label">{label}</span>
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

  return (
    <aside className={`ui-shell${collapsed ? " is-collapsed" : ""}`} aria-label="Launcher" data-testid="sidebar">
      <div className="ui-shell__brand">
        <img className="ui-shell__mark" src={logoMark} alt="" draggable={false} />
        <span className="ui-shell__wordmark">Unity Launcher</span>
        <button
          type="button"
          className="ui-shell__fold"
          onClick={onToggle}
          aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
          aria-expanded={!collapsed}
          data-tip={`${collapsed ? "Expand" : "Collapse"} the sidebar (Ctrl+B)`}
        >
          {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
        </button>
      </div>

      <div className="ui-shell__scroll" ref={scroller}>
        <span
          className="ui-shell__mark-bar"
          aria-hidden="true"
          style={mark ? { transform: `translateY(${mark.top}px)`, height: mark.height, opacity: 1 } : { opacity: 0 }}
        />
        <nav aria-label="Pages" className="ui-shell__nav">
          {inGame ? (
            <>
              {item("launcher", "Back to Launcher", <ArrowLeft size={16} />, () => go({ kind: "home" }))}
              <div className="ui-shell__heading">
                <span className="ui-shell__label">{inMinecraft ? "Minecraft" : gameNav?.game ?? modGame?.game}</span>
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
                    !when || (when === "cc" ? gameNav?.hasCC : gameNav?.hasLoadOrder),
                  ).map(({ page, label, icon }) => [
                    item(`game:${openGame}:${page}`, label, icon, () => go({ kind: "game", id: openGame, page })),
                    page === "discover" && backRow,
                  ])}
            </>
          ) : (
            <>
              {item("home", "Home", <House size={16} />, () => go({ kind: "home" }))}
              {item("modmanager", "More Games", <Layers size={16} />, () => go({ kind: "modmanager" }))}
            </>
          )}
        </nav>
      </div>

      <div className="ui-shell__foot">
        <button
          type="button"
          className="ui-shell__item"
          aria-expanded={downloads.shown}
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
        <div className="ui-shell__account">
          <AccountSwitcher compact rail={collapsed} />
        </div>
        {!inGame && item("settings", "Settings", <Settings size={16} />, () => go({ kind: "settings" }), { aria: "Launcher settings" })}
      </div>
    </aside>
  );
}
