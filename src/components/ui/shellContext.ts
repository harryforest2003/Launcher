import { createContext, useContext, useId, useLayoutEffect } from "react";

/*
 * The app has ONE sidebar (AppSidebar), drawn by App beside every page. Pages still render
 * their old <LauncherSidebar>, <MCSidebar> or <GameSidebar>; those now draw nothing and only
 * tell the shell what the page knows: which sub-page is on, where "Back" goes, and handlers a
 * page overrides (the Library's detail view sends "Library" back to the list, say).
 */

export type McPage = "minecraft" | "discover" | "library" | "skins" | "skinbuilder" | "settings";
export type GamePageKey = "home" | "mods" | "discover" | "cc" | "loadorder" | "settings";

export type PageNav =
  | {
      area: "minecraft";
      page: McPage;
      handlers: Partial<Record<McPage | "home", () => void>>;
      back: { label: string; run: () => void } | null;
    }
  | {
      area: "game";
      game: string;
      page: GamePageKey | null;
      hasCC: boolean;
      hasLoadOrder: boolean;
      go: (page: GamePageKey) => void;
      back: { label: string; run: () => void } | null;
      badges?: Partial<Record<GamePageKey, unknown>>;
    }
  | { area: "modGame"; game: string; page: "installed" | "browse"; go: (page: "installed" | "browse") => void }
  | { area: "launcher"; page: "home" | "settings" | "modmanager"; handlers: Partial<Record<"home" | "settings" | "modmanager", () => void>> };

export type Shell = {
  register: (id: string, nav: PageNav) => void;
  unregister: (id: string) => void;
};

export const ShellContext = createContext<Shell | null>(null);

/** What a page's nav looks like, for deciding when the sidebar must redraw (handlers aside). */
export const navKey = (nav: PageNav) =>
  nav.area === "game"
    ? `game|${nav.game}|${nav.page}|${nav.hasCC}|${nav.hasLoadOrder}|${nav.back?.label ?? ""}|${Object.keys(nav.badges ?? {}).join(",")}`
    : nav.area === "minecraft"
      ? `mc|${nav.page}|${nav.back?.label ?? ""}`
      : nav.area === "modGame" ? `modGame|${nav.game}|${nav.page}` : `launcher|${nav.page}`;

/** Tells the shell's sidebar about this page while it's mounted. */
export function usePageNav(nav: PageNav) {
  const shell = useContext(ShellContext);
  const id = useId();
  // Every render: the newest handlers. The shell only redraws when navKey changes.
  useLayoutEffect(() => {
    shell?.register(id, nav);
  });
  useLayoutEffect(() => () => shell?.unregister(id), [shell, id]);
}
