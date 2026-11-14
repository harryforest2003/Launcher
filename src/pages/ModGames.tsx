import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import BackgroundLogo from "../components/BackgroundLogo";
import LauncherSidebar from "../components/LauncherSidebar";
import { Badge, Button, Notice, Panel } from "../components/ui";
import ModManager from "./ModManager";
import "./homeScreens.css";

type Props = {
  initialGame?: DetectedGame;
  onBack: () => void;
  onMinecraft: () => void;
  onSettings: () => void;
};

const OWN_SECTIONS = new Set(["sims4", "gtav", "skyrimse", "fallout4", "cyberpunk2077", "stardew"]);

export default function ModGames({ initialGame, onBack, onMinecraft, onSettings }: Props) {
  const [games, setGames] = useState<DetectedGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DetectedGame | null>(initialGame ?? null);
  const [error, setError] = useState<string | null>(null);

  // A Nexus Mods key is added in the launcher's Settings; this only says whether there is one.
  const [hasNexusKey, setHasNexusKey] = useState(true);

  // Reads the games (rescanning first when asked) and shows them; state is only set once
  // the answer is in.
  const read = useCallback((refresh: boolean) => {
    const work = (refresh ? window.modAPI.refreshGames() : Promise.resolve())
      .then(() =>
        Promise.all([window.modAPI.getGames(refresh ? { refresh: true } : undefined), window.modAPI.getSettings()])
      )
      .then(([list, settings]) => {
        // The Sims 4, GTA V, Skyrim, Cyberpunk and Stardew have their own sections now.
        setGames(list.filter((game) => !OWN_SECTIONS.has(game.id)));
        setHasNexusKey(settings.hasNexusKey);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setGames([]);
      });
    return work.finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    read(false);
  }, [read]);

  function rescan() {
    setLoading(true);
    setError(null);
    read(true);
  }

  return (
    <div className="app-screen">
      <LauncherSidebar current="modmanager" onHome={onBack} onModManager={() => setSelected(null)} onSettings={onSettings} />

      <main className="app-main">
        <div className="app-logo-tint">
          <BackgroundLogo />
        </div>

        {selected ? (
          <ModManager game={selected} onBack={() => setSelected(null)} />
        ) : (
          <div className="app-page">
            <Button variant="ghost" className="mg-back" icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={onBack}>
              Back to Home
            </Button>

            <header className="page-header" style={{ marginBottom: "var(--space-5)" }}>
              <h1 className="page-title">More Games</h1>
              <p className="page-lead">
                Other games found on this computer: see their mods and turn them on and off. The Sims 4, GTA V, Skyrim,
                Fallout 4, Cyberpunk 2077 and Stardew Valley have their own sections on Home.
              </p>
            </header>

            <div className="mg-toolbar">
              <Button icon={<RefreshCw size={16} aria-hidden="true" />} onClick={rescan} disabled={loading}>
                Rescan for games
              </Button>
            </div>

            {(!hasNexusKey || error) && (
              <div className="mg-stack">
                {!hasNexusKey && (
                  <Notice tone="info" actions={<Button size="sm" onClick={onSettings}>Open Settings</Button>}>
                    Browsing Nexus Mods needs your Nexus API key, which goes in Settings under Personal API tokens.
                  </Notice>
                )}
                {error && <Notice tone="danger">{error}</Notice>}
              </div>
            )}

            {loading ? (
              <p className="mg-muted" role="status">
                Scanning for installed games...
              </p>
            ) : games.length === 0 ? (
              <Panel title="No supported games found" className="mg-empty">
                <p>
                  The scan looks through Steam libraries, Epic manifests, and the standard install and mod folders for
                  Palworld, Terraria, Baldur's Gate 3, Valheim and RimWorld.
                </p>
                <p>
                  If a game is installed somewhere unusual, set <code>UNITY_STEAM_ROOTS</code> to its Steam folder and rescan.
                </p>
              </Panel>
            ) : (
              <div className="mg-grid">
                {games.map((game) => (
                  <button
                    key={game.id}
                    type="button"
                    className="mg-game"
                    onClick={() => (game.managedByInstances ? onMinecraft() : setSelected(game))}
                  >
                    <span className="mg-game__name">{game.name}</span>
                    <span className="mg-game__source">Found via {game.source}</span>
                    <span className="mg-path">{game.modDir ?? "No mod folder"}</span>

                    <span className="mg-tags">
                      {game.managedByInstances ? (
                        <Badge tone="accent">Instances</Badge>
                      ) : game.availableProviders.length > 0 ? (
                        game.availableProviders.map((p) => (
                          <Badge key={p.id} tone={p.ready ? "success" : "neutral"} data-tip={p.ready ? undefined : "Needs an API key"}>
                            {p.ready ? p.label : `${p.label}: needs a key`}
                          </Badge>
                        ))
                      ) : (
                        <Badge>Local only</Badge>
                      )}

                      {!game.modDirExists && !game.managedByInstances && <Badge tone="warning">No mods folder yet</Badge>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
