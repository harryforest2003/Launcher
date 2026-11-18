import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Gamepad2, RefreshCw } from "lucide-react";
import BackgroundLogo from "../components/BackgroundLogo";
import LauncherSidebar from "../components/LauncherSidebar";
import { Badge, Button, Notice, Panel, SearchField, Skeleton } from "../components/ui";
import ModManager from "./ModManager";
import { ART } from "./gameArt";
import "./homeScreens.css";
import "./moreGames.css";

type Props = {
  initialGame?: DetectedGame;
  onBack: () => void;
  onMinecraft: () => void;
  onGame: (id: GameId) => void;
  onSettings: () => void;
};

/* Games with a full workspace of their own (electron/games/registry.cjs). */
const OWN_SECTIONS = new Set(["sims4", "gtav", "skyrimse", "fallout4", "cyberpunk2077", "stardew"]);

const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");

/* One line on how a supported game's mods are handled. */
function hintFor(game: CatalogGame): string {
  if (game.noModFolder) return "Mods replace game files · browse on Nexus Mods";
  const sites = [game.providers.includes("curseforge") && "CurseForge", game.providers.includes("nexus") && "Nexus Mods"].filter(Boolean);
  const where = sites.length ? `Browse on ${sites.join(" and ")}` : "Local mods";
  const files = game.modExtensions.slice(0, 2).join(" and ");
  return files ? `${where} · ${files} files` : where;
}

/* A supported game that isn't on this computer: either a workspace to set up, or one to install. */
type Missing =
  | { kind: "workspace"; id: GameId; name: string; windowsOnly: boolean }
  | { kind: "catalog"; id: string; name: string; game: CatalogGame };

/* A game's own picture (its store header), or its initials when offline or unknown. */
function GameTileArt({ id, name }: { id: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const src = ART[id];
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
  return (
    <span className="mg-game__art" aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span className="mg-game__mark">{initials}</span>
      )}
    </span>
  );
}

export default function ModGames({ initialGame, onBack, onMinecraft, onGame, onSettings }: Props) {
  const [games, setGames] = useState<DetectedGame[]>([]);
  const [catalog, setCatalog] = useState<CatalogGame[]>([]);
  const [sections, setSections] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DetectedGame | null>(initialGame ?? null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // A Nexus Mods key is added in the launcher's Settings; this only says whether there is one.
  const [hasNexusKey, setHasNexusKey] = useState(true);

  // Reads the games (rescanning first when asked) and shows them; state is only set once
  // the answer is in.
  const read = useCallback((refresh: boolean) => {
    const work = (refresh ? window.modAPI.refreshGames() : Promise.resolve())
      .then(() =>
        Promise.all([
          window.modAPI.getGames(refresh ? { refresh: true } : undefined),
          window.modAPI.getSettings(),
          window.modAPI.catalog(),
          window.gamesAPI.list(),
        ])
      )
      .then(([list, settings, supported, workspaces]) => {
        // Games with their own workspace are on Home when found, so leave them out here.
        setGames(list.filter((game) => !OWN_SECTIONS.has(game.id)));
        setCatalog(supported);
        setSections(workspaces);
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

  const matches = (name: string) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const found = games.filter((game) => matches(game.name));
  const missing: Missing[] = [
    ...sections
      .filter((game) => !game.found)
      .map((game): Missing => ({ kind: "workspace", id: game.id, name: game.name, windowsOnly: game.windowsOnly })),
    ...catalog
      .filter((game) => !game.notOnPC && !OWN_SECTIONS.has(game.id) && !games.some((g) => g.id === game.id))
      .map((game): Missing => ({ kind: "catalog", id: game.id, name: game.name, game })),
  ]
    .filter((game) => matches(game.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const notOnPC = catalog.filter((game) => game.notOnPC && matches(game.name));
  const shown = found.length + missing.length + notOnPC.length;

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

            <header className="mg-head">
              <div className="mg-head__text">
                <h1 className="page-title">More Games</h1>
                <p className="mg-head__lead" aria-live="polite">
                  {loading
                    ? "Looking for games…"
                    : `${games.length} found on this computer · ${missing.length + notOnPC.length} more supported. Games found on this computer also show on Home.`}
                </p>
              </div>
              <SearchField
                wrapperClassName="mg-search"
                label="Search supported games"
                placeholder="Search supported games…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </header>

            {error && (
              <div className="mg-stack">
                <Notice tone="danger">{error}</Notice>
              </div>
            )}

            {loading ? (
              <div className="mg-grid" role="status" aria-label="Scanning for installed games">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="mg-skel" aria-hidden="true">
                    <Skeleton shape="block" className="mg-skel__art" />
                    <Skeleton width="70%" />
                    <Skeleton width="45%" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {query.trim() && shown === 0 && (
                  <p className="mg-none" role="status">No supported games match “{query.trim()}”.</p>
                )}

                {games.length === 0 && !query.trim() ? (
                  <Panel title="No other games found yet" className="mg-empty">
                    <span className="mg-empty__icon" aria-hidden="true"><Gamepad2 size={28} /></span>
                    <p>
                      The scan looks through Steam libraries, Epic manifests, and the standard install and mod folders for
                      every game listed below.
                    </p>
                    <p>
                      If a game is installed somewhere unusual, set <code>UNITY_STEAM_ROOTS</code> to its Steam folder and rescan.
                    </p>
                    <Button size="sm" icon={<RefreshCw size={16} aria-hidden="true" />} onClick={rescan}>
                      Rescan for games
                    </Button>
                  </Panel>
                ) : found.length > 0 && (
                  <section className="mg-section" aria-labelledby="mg-found">
                    <div className="mg-section__head">
                      <h2 className="mh-section-title" id="mg-found">Found on this computer</h2>
                      <span className="mg-section__count">{found.length}</span>
                    </div>
                    <div className="mg-grid">
                      {found.map((game) => (
                        <button
                          key={game.id}
                          type="button"
                          className="mg-game"
                          title={game.modDir ? `${game.name}: ${game.modDir}` : game.name}
                          onClick={() => (game.managedByInstances ? onMinecraft() : setSelected(game))}
                        >
                          <GameTileArt id={game.id} name={game.name} />
                          <span className="mg-game__body">
                            <span className="mg-game__name">{game.name}</span>
                            <span className="mg-game__source">Found via {game.source}</span>
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
                              {!game.modDirExists && !game.managedByInstances && game.modDir && <Badge tone="warning">No mods folder yet</Badge>}
                            </span>
                            <span className="mg-game__go">
                              {game.managedByInstances ? "Open instances" : "Manage mods"}
                              <ArrowRight size={14} aria-hidden="true" />
                            </span>
                          </span>
                        </button>
                      ))}
                      {!query.trim() && (
                        <button type="button" className="mg-game mg-game--rescan" onClick={rescan}>
                          <span className="mg-rescan__icon" aria-hidden="true"><RefreshCw size={20} /></span>
                          <span className="mg-game__name">Rescan for games</span>
                          <span className="mg-game__source">Installed something new? Look again.</span>
                        </button>
                      )}
                    </div>
                  </section>
                )}

                {missing.length > 0 && (
                  <section className="mg-section" aria-labelledby="mg-supported">
                    <div className="mg-section__head">
                      <h2 className="mh-section-title" id="mg-supported">Not on this computer</h2>
                      <span className="mg-section__count">{missing.length}</span>
                    </div>
                    <ul className="mg-grid mg-grid--quiet">
                      {missing.map((game) =>
                        game.kind === "workspace" ? (
                          <li key={game.id}>
                            <button type="button" className="mg-game mg-game--setup" onClick={() => onGame(game.id)}>
                              <GameTileArt id={game.id} name={game.name} />
                              <span className="mg-game__body">
                                <span className="mg-game__name">{game.name}</span>
                                <span className="mg-game__source">
                                  {game.windowsOnly && isMac ? "Windows game: runs through CrossOver or Whisky" : "Installed somewhere else? Choose its folder."}
                                </span>
                                <span className="mg-tags"><Badge tone="accent">Full workspace</Badge></span>
                                <span className="mg-game__go">
                                  Set it up
                                  <ArrowRight size={14} aria-hidden="true" />
                                </span>
                              </span>
                            </button>
                          </li>
                        ) : (
                          <li key={game.id} className="mg-game mg-game--off">
                            <GameTileArt id={game.id} name={game.name} />
                            <span className="mg-game__body">
                              <span className="mg-game__name">{game.name}</span>
                              <span className="mg-game__source">{hintFor(game.game)}</span>
                              <span className="mg-tags">
                                <Badge>Not found</Badge>
                                {game.game.windowsOnly && isMac && <Badge data-tip="Runs on a Mac through CrossOver or Whisky">Windows game</Badge>}
                              </span>
                              <span className="mg-game__go mg-game__go--muted">Install it, then rescan</span>
                            </span>
                          </li>
                        ),
                      )}
                    </ul>
                  </section>
                )}

                {notOnPC.length > 0 && (
                  <section className="mg-section" aria-labelledby="mg-console">
                    <div className="mg-section__head">
                      <h2 className="mh-section-title" id="mg-console">Not on PC yet</h2>
                      <span className="mg-section__count">{notOnPC.length}</span>
                    </div>
                    <ul className="mg-grid mg-grid--quiet">
                      {notOnPC.map((game) => (
                        <li key={game.id} className="mg-game mg-game--off">
                          <GameTileArt id={game.id} name={game.name} />
                          <span className="mg-game__body">
                            <span className="mg-game__name">{game.name}</span>
                            <span className="mg-game__source">{game.notOnPC}</span>
                            <span className="mg-tags"><Badge>Console only</Badge></span>
                            <span className="mg-game__go mg-game__go--muted">Shows up here when a PC version is out</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}

            <p className="mg-foot">
              Games with a full workspace (The Sims 4, GTA V, Skyrim, Fallout 4, Cyberpunk 2077 and Stardew Valley) open from Home once
              they're found. Open any other game here to manage its mods.
              {!hasNexusKey && (
                <>
                  {" "}To browse Nexus Mods, add your Nexus API key in{" "}
                  <button type="button" className="mg-foot__link" onClick={onSettings}>Settings</button>.
                </>
              )}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
