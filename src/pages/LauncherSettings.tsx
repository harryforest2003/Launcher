import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import BackgroundLogo from "../components/BackgroundLogo";
import ApiKeyRow from "../components/ApiKeyRow";
import LauncherSidebar from "../components/LauncherSidebar";
import Button from "../components/ui/Button";
import Notice from "../components/ui/Notice";
import SectionIndex, { type IndexEntry } from "../components/ui/SectionIndex";
import AppearanceSettings from "../theme/AppearanceSettings";
import "../theme/appearance.css";

type Props = {
  onHome: () => void;
  onModManager: () => void;
  /** Opens Minecraft's own settings (Java, memory, accounts). Without it, the page says where they are. */
  onMinecraftSettings?: () => void;
};

/* Settings for the launcher as a whole, rather than for one game. */
export default function LauncherSettings({ onHome, onModManager, onMinecraftSettings }: Props) {
  const [apiKeys, setApiKeys] = useState<Awaited<ReturnType<typeof window.instanceAPI.getApiKeys>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    window.instanceAPI
      .getApiKeys()
      .then(setApiKeys)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const added = apiKeys ? (["modrinth", "nexus", "github"] as const).filter((key) => apiKeys[key]?.set).length : 0;

  const sections = useMemo<IndexEntry[]>(
    () => [
      { id: "appearance", label: "Appearance" },
      { id: "appearance-colour", label: "Colour", sub: true },
      { id: "appearance-base", label: "Light or dark", sub: true },
      { id: "appearance-readability", label: "Readability", sub: true },
      { id: "api-tokens", label: "Keys for mod sites" },
      { id: "token-modrinth", label: "Modrinth", sub: true },
      { id: "token-nexus", label: "Nexus Mods", sub: true },
      { id: "token-github", label: "GitHub", sub: true },
      { id: "game-settings", label: "Game settings" },
    ],
    []
  );

  return (
    <div className="app-screen">
      <LauncherSidebar current="settings" onHome={onHome} onModManager={onModManager} onSettings={() => {}} />

      <main className="app-main">
        <div className="app-logo-tint">
          <BackgroundLogo />
        </div>

        <div className="app-page" ref={setScroller}>
          <header className="page-header set-header">
            <div>
              <h1 className="page-title">Settings</h1>
              <p className="page-lead">How the launcher looks, and the keys it uses for mod sites. Changes save as you make them.</p>
            </div>
          </header>

          {error && (
            <Notice tone="danger" style={{ maxWidth: "var(--content-max)", marginBottom: "var(--space-6)" }}>
              {error}
            </Notice>
          )}

          <div className="page-with-index">
            <SectionIndex label="Settings sections" entries={sections} scroller={scroller} />

            <div className="page-sections">
              <section id="appearance" aria-labelledby="appearance-title" className="page-section">
                <AppearanceSettings />
              </section>

              <section id="api-tokens" aria-labelledby="api-tokens-title" className="page-section">
                <div className="appearance-top">
                  <h2 id="api-tokens-title" className="page-section-title">
                    Keys for mod sites
                  </h2>
                  {apiKeys && (
                    <span className="set-count" style={{ marginRight: 0 }}>
                      <strong>{added}</strong> of 3 added
                    </span>
                  )}
                </div>
                <div className="ui-panel set-panel" data-testid="personal-tokens">
                  <div className="set-panel-head">
                    <p className="set-lead" style={{ marginTop: 0 }}>
                      Keys from your own accounts. The launcher works without them; each one adds something. They're locked
                      with your computer's keychain and only ever sent to the site they belong to.
                    </p>
                  </div>

                  <div className="set-rows">
                    <div id="token-modrinth" className="page-section-anchor">
                      <ApiKeyRow
                        name="modrinth"
                        label="Modrinth"
                        environmentVariable="MODRINTH_TOKEN"
                        status={apiKeys?.modrinth}
                        onChange={setApiKeys}
                      >
                        Lets the launcher see your own unlisted and draft projects. Browsing and installing don't need it.
                        Create one at modrinth.com/settings/pats.
                      </ApiKeyRow>
                    </div>

                    <div id="token-nexus" className="page-section-anchor">
                      <ApiKeyRow
                        name="nexus"
                        label="Nexus Mods"
                        environmentVariable="NEXUS_API_KEY"
                        status={apiKeys?.nexus}
                        onChange={setApiKeys}
                      >
                        Needed to browse Nexus Mods in the Mod Manager. Find yours on nexusmods.com, in your account's API
                        Keys settings.
                      </ApiKeyRow>
                    </div>

                    <div id="token-github" className="page-section-anchor">
                      <ApiKeyRow
                        name="github"
                        label="GitHub"
                        environmentVariable="GITHUB_TOKEN"
                        status={apiKeys?.github}
                        onChange={setApiKeys}
                      >
                        Installs from GitHub allow 60 lookups an hour without one, and 5,000 with one. Create one at
                        github.com/settings/tokens; it needs no permissions.
                      </ApiKeyRow>
                    </div>
                  </div>
                </div>
              </section>

              <section id="game-settings" aria-labelledby="game-settings-title" className="page-section">
                <h2 id="game-settings-title" className="page-section-title">
                  Game settings
                </h2>
                <div className="ui-panel ui-panel--sunken set-panel">
                  <div className="set-panel-head" style={{ marginBottom: 0, alignItems: "center" }}>
                    <p className="set-lead" style={{ marginTop: 0 }}>
                      Each game keeps its own settings. Minecraft's memory, Java, accounts and starter mods are in Minecraft, under
                      Settings in its sidebar; other games have Settings in their own section.
                    </p>
                    {onMinecraftSettings && (
                      <Button icon={<ArrowRight size={16} aria-hidden="true" />} onClick={onMinecraftSettings}>
                        Minecraft settings
                      </Button>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
