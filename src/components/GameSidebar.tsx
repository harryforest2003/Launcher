import type { ReactNode } from "react";
import { usePageNav, type GamePageKey } from "./ui/shellContext";

export type GamePage = GamePageKey;

type Props = {
  game: string;
  /* Skyrim and Fallout 4: plugins load in an order that matters. */
  hasLoadOrder?: boolean;
  /* Bethesda games: their INI files and modding tools (xEdit, BodySlide...). */
  hasTools?: boolean;
  /* The Sims 4: its CC, as pictures. */
  hasCC?: boolean;
  /** The page on screen; null while a mod's page or a collection (opened from Discover) is. */
  current: GamePage | null;
  go: (page: GamePage) => void;
  /** A mod's page or a collection is open: Back returns to the Discover results. */
  showBack?: boolean;
  onBack?: () => void;
  /** Leaves the game's section (the app's sidebar has its own way out now). */
  onLauncher: () => void;
  /** Optional: something to show at the end of a page's row, e.g. { mods: <Badge tone="warning">2</Badge> }. */
  badges?: Partial<Record<GamePage, ReactNode>>;
};

/*
 * A game's section renders this. It draws nothing itself: the app's one sidebar lists the game
 * with its pages (Mods, Discover Mods, CC, Load Order, Settings) under it, and this tells it
 * which is on and what Back does.
 */
export default function GameSidebar({ game, hasLoadOrder = false, hasTools = false, hasCC = false, current, go, showBack = false, onBack, badges }: Props) {
  usePageNav({
    area: "game",
    game,
    page: current,
    hasCC,
    hasLoadOrder,
    hasTools,
    go,
    back: showBack && onBack ? { label: "Back to results", run: onBack } : null,
    badges,
  });
  return null;
}
