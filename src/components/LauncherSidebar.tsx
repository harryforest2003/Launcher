import { usePageNav } from "./ui/shellContext";

/*
 * The launcher's own pages (Home, More Games, Settings) render this. It draws nothing itself:
 * the app's one sidebar is always there; this tells it which page is on and lets the page's own
 * handlers run (More Games uses "More Games" to go back to its list).
 */
type Props = {
  current: "home" | "settings" | "modmanager";
  onHome: () => void;
  onModManager: () => void;
  onSettings: () => void;
};

export default function LauncherSidebar({ current, onHome, onModManager, onSettings }: Props) {
  usePageNav({ area: "launcher", page: current, handlers: { home: onHome, modmanager: onModManager, settings: onSettings } });
  return null;
}
