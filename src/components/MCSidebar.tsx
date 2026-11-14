import { useContext } from "react";
import { SkinBuilderNavContext } from "../skinBuilder/navContext";
import { SidebarBackLabel } from "./ui/sidebarContext";
import { usePageNav, type McPage } from "./ui/shellContext";

type Props = {
  currentPage: McPage;

  /** Back to the launcher's home. */
  goHome: () => void;
  goMinecraft: () => void;
  goDiscover: () => void;
  goLibrary: () => void;
  goSkinSelector: () => void;
  goSettings: () => void;

  /** Out of something opened inside the current page (a project back to the results). */
  showBack?: boolean;
  onBack?: () => void;
};

/*
 * Every Minecraft page renders this. It draws nothing itself: the app's one sidebar (AppSidebar)
 * is always there, and this tells it which page is on and what this page's buttons do (the
 * Library's detail view sends "Library" back to the list, for one).
 */
function MCSidebar({ currentPage, goHome, goMinecraft, goDiscover, goLibrary, goSkinSelector, goSettings, showBack = false, onBack }: Props) {
  const goSkinBuilder = useContext(SkinBuilderNavContext);
  const backLabel = useContext(SidebarBackLabel);

  // A Back that goes where a sidebar item already goes would be a second control saying the
  // same thing, so only one that goes somewhere else is shown (a project page back to results).
  const back =
    showBack && onBack && ![goHome, goMinecraft, goDiscover, goLibrary, goSkinSelector, goSettings, goSkinBuilder].includes(onBack)
      ? { label: backLabel ?? "Back", run: onBack }
      : null;

  usePageNav({
    area: "minecraft",
    page: currentPage,
    handlers: {
      home: goHome,
      minecraft: goMinecraft,
      discover: goDiscover,
      library: goLibrary,
      skins: goSkinSelector,
      settings: goSettings,
      ...(goSkinBuilder ? { skinbuilder: goSkinBuilder } : {}),
    },
    back,
  });
  return null;
}

export default MCSidebar;
