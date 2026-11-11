import { useState } from "react";

import HomeScreen from "./pages/GameMenu";
import LauncherSettings from "./pages/LauncherSettings";
import MinecraftMenu from "./pages/MinecraftMenu";
import DiscoverContent from "./pages/MCDiscover";
import Library from "./pages/MCLibrary";
import SkinSelector from "./pages/MCSkinSelector";
import Settings from "./pages/MCSettings";
import ModDescription from "./pages/ModDescription";
import ModGames from "./pages/ModGames";
import SkinBuilder from "./pages/SkinBuilder";
import { SkinBuilderNavContext } from "./skinBuilder/navContext";

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
  | "modmanager";

function App() {
  const [screen, setScreen] = useState<Screen>("home");

  return (
    <SkinBuilderNavContext.Provider value={() => setScreen("skinbuilder")}>
      <Screens screen={screen} setScreen={setScreen} />
    </SkinBuilderNavContext.Provider>
  );
}

function Screens({
  screen,
  setScreen,
}: {
  screen: Screen;
  setScreen: (screen: Screen) => void;
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
        )}
      </>
    );
  }

  switch (screen) {
    case "home":
      return (
        <HomeScreen
          onMinecraft={navigation.goMinecraft}
          onModManager={() => setScreen("modmanager")}
          onSettings={() => setScreen("launcherSettings")}
        />
      );

    case "launcherSettings":
      return <LauncherSettings onHome={navigation.goHome} onModManager={() => setScreen("modmanager")} />;

    case "modmanager":
      return (
        <ModGames
          onBack={navigation.goHome}
          onMinecraft={navigation.goMinecraft}
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