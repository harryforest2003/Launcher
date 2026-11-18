import { Component, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Box, Compass, FolderPlus, LayoutGrid, LogIn, Play, Shirt, UserRound } from "lucide-react";
import CreateInstancePanel from "../components/CreateInstancePanel";
import BackgroundLogo from "../components/BackgroundLogo";
import AccountSwitcher from "../components/AccountSwitcher";
import Sidebar from "../components/MCSidebar";
import SkinPreview from "../components/SkinPreview";
import SkinFront from "../components/SkinFront";
import InstanceArt from "../components/InstanceArt";
import { AccountClashNotice } from "../components/PlayAs";
import { useAccountChoice } from "../components/playAsChoice";
import { Button, Notice } from "../components/ui";
import { Sparkline, formatDuration } from "../components/charts";
import { SkinBuilderNavContext } from "../skinBuilder/navContext";
import ActivityPanel from "./dashboard/ActivityPanel";
import PlayHero from "./dashboard/PlayHero";
import PlayStats from "./dashboard/PlayStats";
import NewsPanel from "./dashboard/NewsPanel";
import MinecraftOffers from "./dashboard/MinecraftOffers";
import { useDashboard } from "./dashboard/useDashboard";
import { defaultRange, type Range } from "./dashboard/range";
import { loaderName, useInstances } from "./dashboard/useInstances";
import { timeAgo } from "./playedAgo";
import "./homeScreens.css";

type Props = {
  onBack: () => void;

  goHome: () => void;
  goMinecraft: () => void;
  goDiscover: () => void;
  goLibrary: () => void;
  goSkinSelector: () => void;
  goSettings: () => void;
};

/* The 3D skin needs WebGL; where it can't start (no graphics acceleration), a flat picture of
   the same skin takes its place instead of the whole page going blank. */
class SkinFallback extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/*
 * The Minecraft home: back into the last-played instance in one click (the same quick-launch
 * card as Home), every other instance with its real play time, ways into mods, packs, skins
 * and models, and the Microsoft account with its 3D skin.
 */
function MinecraftMenu({
  onBack,
  goHome,
  goMinecraft,
  goDiscover,
  goLibrary,
  goSkinSelector,
  goSettings,
}: Props) {
  const goSkinBuilder = useContext(SkinBuilderNavContext);

  const [account, setAccount] = useState<{
    loggedIn: boolean;
    username: string;
    uuid: string;
    skin?: string;
  } | null>(null);

  const { instances, loaded, loadError, starting, launchError, clearError, launch, reload } = useInstances();
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [createdName, setCreatedName] = useState<string | null>(null);
  const firstTime = loaded && !loadError && instances.length === 0;
  // The rows' Play: an account already in another game is offered the free ones instead.
  const choice = useAccountChoice();
  const dashboard = useDashboard();
  const stats = dashboard.stats.data;
  const [chosenRange, setRange] = useState<Range | null>(null);
  const range = chosenRange ?? defaultRange(stats);
  const [lastWorld, setLastWorld] = useState<{ instance: string; world: InstanceWorld | null } | null>(null);

  const [signingIn, setSigningIn] = useState(false);

  /* The player's own skin for the 3D figure. The account normally carries it; when it doesn't
     (an older saved sign-in, or the profile fetch failed), the same lookup the Skins page uses
     finds the skin Mojang has for that username. Never a made-up one. */
  const [lookedUp, setLookedUp] = useState<{ username: string; skin: string; slim: boolean } | null>(null);
  const needsLookup = Boolean(account?.loggedIn && !account.skin && account.username);
  useEffect(() => {
    if (!needsLookup || !account) return;
    let cancelled = false;
    window.launcherAPI
      .searchPlayers(account.username)
      .then((results) => {
        const match = results.find((entry) => entry.username.toLowerCase() === account.username.toLowerCase());
        if (!cancelled && match?.skin) setLookedUp({ username: account.username, skin: match.skin, slim: match.slim });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [needsLookup, account]);
  const playerSkin = account?.skin ?? (lookedUp && lookedUp.username === account?.username ? lookedUp.skin : undefined);
  const playerSlim = account?.skin ? undefined : lookedUp?.slim;
  const [signInError, setSignInError] = useState<string | null>(null);
  const signInAttempt = useRef(0);

  useEffect(() => {
    let current = true;
    // Stays signed in between runs of the app.
    window.instanceAPI
      .getAccount()
      .then((saved) => {
        if (current && saved) {
          setAccount({
            loggedIn: true,
            username: saved.name,
            uuid: saved.uuid,
            skin: saved.skin ?? undefined,
          });
        }
      })
      .catch(() => {});

    // Switching accounts, from here or the sidebar, shows the one now active.
    const unsubscribe = window.instanceAPI.onAccountsChanged((accounts) => {
      current = false;
      const active = accounts.find((entry) => entry.active);
      setAccount(active ? { loggedIn: true, username: active.name, uuid: active.uuid, skin: active.skin ?? undefined } : null);
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);

  const latest = instances[0];
  // Every other instance stays one click from playing, most recently played first.
  const others = instances.slice(1);
  const [showAllInstances, setShowAllInstances] = useState(false);
  const visibleOthers = showAllInstances ? others : others.slice(0, 3);
  const statFor = (name: string) => stats?.instances.find((i) => i.name === name);

  // The world last played in the latest instance, when it has any.
  const latestName = latest?.name;
  useEffect(() => {
    if (!latestName) return;
    let live = true;
    window.instanceAPI
      .worlds(latestName)
      .then((worlds) => {
        if (live) setLastWorld({ instance: latestName, world: worlds[0] ?? null });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [latestName]);

  const world = lastWorld && lastWorld.instance === latestName ? lastWorld.world : null;

  // The last 30 days of one instance, for its little trend line.
  const recent = (name: string) => (stats?.daily ?? []).slice(-30).map((d) => d.byInstance[name] ?? 0);

  async function handleMicrosoftLogin() {
    // Clicking again replaces a sign-in still waiting on a browser tab, whose failure
    // then no longer matters.
    signInAttempt.current += 1;
    const attempt = signInAttempt.current;

    setSigningIn(true);
    setSignInError(null);

    try {
      const user = await window.launcherAPI.loginMicrosoft();
      if (attempt !== signInAttempt.current) return;

      setAccount({
        loggedIn: true,
        username: user.name,
        uuid: user.uuid,
        skin: user.skin ?? undefined,
      });
    } catch (err) {
      if (attempt !== signInAttempt.current) return;

      const message = err instanceof Error ? err.message : "Microsoft sign-in failed.";
      setSignInError(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }

    setSigningIn(false);
  }

  async function handleSignOut() {
    await window.instanceAPI.clearAccount();
    setAccount(null);
  }

  const links = [
    { icon: <Compass size={18} />, title: "Mods and modpacks", lead: "Search Modrinth and CurseForge", go: goDiscover },
    { icon: <Shirt size={18} />, title: "Skins", lead: "Look up a player's skin or change yours", go: goSkinSelector },
    { icon: <Box size={18} />, title: "Model Builder", lead: "Turn a picture into an item model", go: goSkinBuilder },
    { icon: <LayoutGrid size={18} />, title: "Library", lead: "Every instance: sort, group and import", go: goLibrary },
  ];

  return (
    <div className="app-screen">
      <Sidebar
        currentPage="minecraft"
        goHome={goHome}
        goMinecraft={goMinecraft}
        goDiscover={goDiscover}
        goLibrary={goLibrary}
        goSkinSelector={goSkinSelector}
        goSettings={goSettings}
        showBack
        onBack={onBack}
      />

      <main className="app-main">
        <div className="app-logo-tint">
          <BackgroundLogo />
        </div>

        <div className="app-page mh-page">
          {creatingInstance ? (
            <div className="nc-page">
              <Button variant="ghost" icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={() => setCreatingInstance(false)}>Back to Minecraft</Button>
              <h1 className="page-title">Create an instance</h1>
              <p className="page-lead">An instance is a separate Minecraft setup with its own mods, worlds and settings. Choose Vanilla for the original game, a modpack for a ready-made collection, or import an existing setup.</p>
              <CreateInstancePanel onCancel={() => setCreatingInstance(false)} onDone={(name) => {
                setCreatedName(name ?? "Your instance");
                void reload();
                setCreatingInstance(false);
              }} />
            </div>
          ) : <>
          {createdName && <Notice tone="success" actions={<>
            <Button size="sm" variant="ghost" onClick={goLibrary}>Open Library</Button>
            <Button size="sm" variant="ghost" onClick={() => setCreatedName(null)}>Dismiss</Button>
          </>}>
            {createdName} is ready. Open Library to play or manage it.
          </Notice>}
          {/* The top: the welcome and the last-played card on the left, and the signed-in player
              (or a way to sign in) on the right, as tall as both together. */}
          <div className={`mh-top${account?.loggedIn ? "" : " mh-top--solo"}`}>
            <div className="mh-top__main">
              <header className="mh-head">
                <div className="mh-head__text">
                  <h1 className="page-title">{firstTime ? "Welcome to Minecraft" : account?.loggedIn ? `Welcome back, ${account.username}!` : "Welcome back!"}</h1>
                  <p className="page-lead">{firstTime ? "Start with your own setup, a modpack, or an instance you already have." : "Pick up where you left off, or find something new."}</p>
                </div>

              </header>
              {loadError ? <Notice tone="danger" actions={<Button size="sm" variant="ghost" onClick={() => void reload()}>Retry</Button>}>{loadError}</Notice> : <PlayHero
                instance={latest}
                stat={latest ? statFor(latest.name) : undefined}
                loaded={loaded}
                banner
                starting={starting}
                onPlay={launch}
                onCreate={() => setCreatingInstance(true)}
                extra={
                  world && (
                    <span>
                      Last world: <strong style={{ color: "var(--color-text-secondary)" }}>{world.name}</strong>
                    </span>
                  )
                }
              />}
            </div>

            {account?.loggedIn ? (
              <section className="mh-player" aria-label="Microsoft account">
                <div className={`mh-player__figure${playerSkin ? "" : " mh-player__figure--empty"}`}>
                  {playerSkin ? (
                    <SkinFallback key={playerSkin} fallback={<div className="mh-player__flat"><SkinFront skin={playerSkin} slim={playerSlim} scale={6} /></div>}>
                      <SkinPreview skin={playerSkin} slim={playerSlim} size={240} height={280} fullBody still followCursor fill />
                    </SkinFallback>
                  ) : (
                    <UserRound size={40} aria-label="No skin found for this account" />
                  )}
                </div>

                <div className="mh-player__info">
                  <strong className="mh-player__name">{account.username}</strong>
                  <span className="mh-player__uuid" title="Your Minecraft player ID (UUID)">
                    {account.uuid}
                  </span>
                </div>

                <div className="mh-player__switch">
                  <AccountSwitcher />
                </div>
                <div className="mh-player__actions">
                  <Button size="sm" variant="ghost" icon={<Shirt size={14} aria-hidden="true" />} onClick={goSkinSelector}>
                    Change skin
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleSignOut}>
                    Sign out
                  </Button>
                </div>
              </section>
            ) : (
              <section className="mh-signin mh-signin--bar" aria-label="Microsoft account">
                    <span className="mh-signin__icon" aria-hidden="true">
                      <UserRound size={18} />
                    </span>
                    <p className="mh-signin__text">
                      <strong>Not signed in.</strong> Sign in to play online and change your skin.
                    </p>
                    <Button size="sm" className="mh-wrap" icon={<LogIn size={16} aria-hidden="true" />} onClick={handleMicrosoftLogin}>
                      {signingIn ? "Waiting for your browser. Click to retry" : "Sign in with Microsoft"}
                    </Button>
                    {signInError && (
                      <Notice
                        tone="danger"
                        data-testid="sign-in-error"
                        className="mh-signin__error"
                        style={{ userSelect: "text", overflowWrap: "anywhere" }}
                      >
                        {signInError}
                      </Notice>
                    )}
                  </section>
            )}
          </div>

          <div className="mh-layout mh-layout--solo">
            <div className="mh-main">
              {launchError && (
                <Notice tone="danger" actions={<Button size="sm" variant="ghost" onClick={clearError}>Dismiss</Button>}>
                  {launchError}
                </Notice>
              )}
              <AccountClashNotice
                choice={choice}
                onPlayAs={(id) => {
                  const target = instances.find((i) => i.name === choice.clash?.instance);
                  if (target && choice.check(target.name, id)) launch(target, id);
                }}
              />

              {instances.length > 0 && <>
                <section aria-labelledby="mh-others">
                  <div className="mh-section-head">
                    <h2 className="mh-section-title" id="mh-others">
                      {others.length ? "Your other instances" : "Your instances"}
                    </h2>
                    <span className="mh-section-actions">
                      {others.length > 3 && <Button variant="ghost" size="sm" aria-expanded={showAllInstances} aria-controls="mh-recent-instances" onClick={() => setShowAllInstances((show) => !show)}>
                        {showAllInstances ? "Show recent instances" : `Show all ${others.length} other instances`}
                      </Button>}
                      <Button variant="ghost" size="sm" onClick={goLibrary}>
                        Open Library
                      </Button>
                    </span>
                  </div>
                  <ul className="mh-cards" id="mh-recent-instances">
                    {visibleOthers.map((instance) => {
                      const stat = statFor(instance.name);
                      const trend = recent(instance.name);
                      return (
                        <li key={instance.name} className="mh-card">
                          <InstanceArt name={instance.name} cols={10} rows={3} className="mh-card__art" />
                          <div className="mh-card__body">
                            <span className="mh-card__name">{instance.name}</span>
                            <span className="mh-row__facts">
                              <span className="mh-version">{instance.version}</span> {loaderName(instance.loader)}
                              {stat ? `, ${stat.modCount === 1 ? "1 mod" : `${stat.modCount} mods`}` : ""}
                            </span>
                            <span className="mh-card__stats">
                              <span>
                                {(() => {
                                  // The instance file or the play history, whichever knows when.
                                  const last = instance.lastPlayed ?? stat?.lastPlayed;
                                  const total = stat && stat.playSeconds ? `${formatDuration(stat.playSeconds)} in all` : "";
                                  const when = instance.running ? (instance.playingAs ? `Playing now as ${instance.playingAs.name}` : "Playing now") : last ? `Played ${timeAgo(last)}` : total ? "" : "Not played yet";
                                  return [when, total].filter(Boolean).join(", ");
                                })()}
                              </span>
                              {trend.some((v) => v > 0) && <Sparkline values={trend} width={64} height={20} />}
                            </span>
                          </div>
                          <Button
                            size="sm"
                            className="mh-card__play"
                            icon={<Play size={14} aria-hidden="true" />}
                            disabled={starting !== null || Boolean(instance.running)}
                            onClick={() => choice.check(instance.name) && launch(instance)}
                            aria-label={`Play ${instance.name}`}
                          >
                            {starting === instance.name ? "Starting..." : instance.running ? "Running" : "Play"}
                          </Button>
                        </li>
                      );
                    })}
                    <li>
                      <button type="button" className="mh-card mh-card--new" onClick={() => setCreatingInstance(true)}>
                        <FolderPlus size={20} aria-hidden="true" />
                        <span className="mh-card__name">New instance</span>
                        <span className="mh-row__facts">Create one, start from a modpack, or import from another launcher</span>
                      </button>
                    </li>
                  </ul>
                </section>

                <NewsPanel cards more={3} news={dashboard.news.data} loading={dashboard.news.loading} failed={dashboard.news.failed} onRefresh={dashboard.refreshNews} title="Minecraft news" />

                <div className="mh-duo">
                  <PlayStats compact stats={stats} loading={dashboard.stats.loading} failed={dashboard.stats.failed} range={range} onRange={setRange} show={["trend"]} />
                  <div className="mh-duo__side">
                    <ActivityPanel items={dashboard.activity.data} loading={dashboard.activity.loading} failed={dashboard.activity.failed} />
                    {/* Buying and trying are for someone without a signed-in account. */}
                    {!account?.loggedIn && <MinecraftOffers />}
                  </div>
                </div>
              </>}

              {instances.length === 0 && !account?.loggedIn && <MinecraftOffers />}

              <section aria-labelledby="mh-links">
                <div className="mh-section-head">
                  <h2 className="mh-section-title" id="mh-links">
                    Mods, packs and skins
                  </h2>
                </div>
                <div className="mh-links">
                  {links.map((link) => (
                    <button key={link.title} type="button" className="mh-link" onClick={() => link.go?.()}>
                      <span className="mh-link__icon" aria-hidden="true">
                        {link.icon}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="mh-link__title">{link.title}</span>
                        <span className="mh-link__lead">{link.lead}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
          </>}
        </div>
      </main>
    </div>
  );
}

export default MinecraftMenu;
