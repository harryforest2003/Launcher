import { useCallback, useEffect, useRef, useState } from "react";
import BackgroundLogo from "../components/BackgroundLogo";
import GameSidebar, { type GamePage } from "../components/GameSidebar";
import GameDiscover from "./games/GameDiscover";
import GameModPage from "./games/GameModPage";
import CollectionPage from "./games/CollectionPage";
import GameMods from "./games/GameMods";
import GameSettings from "./games/GameSettings";
import LoadOrderPage from "./games/LoadOrderPage";
import ModOrderPage from "./games/ModOrderPage";
import GameTools from "./games/GameTools";
import CCBrowser from "./games/CCBrowser";
import PlayPrompt from "./games/PlayPrompt";
import GameStore, { PriceText } from "./games/GameStore";
import { useStoreInfo } from "./games/useStoreInfo";
import { CircleAlert, CircleCheck, Download, ExternalLink, Play, TriangleAlert } from "lucide-react";
import { Button, Notice, ProgressBar } from "../components/ui";
import { useGameArt } from "./gameArt";
import { timeAgo } from "./playedAgo";
import "./dashboard/dashboard.css";
import { errorText, installSummary } from "./games/shared";

type Props = {
  gameId: GameId;
  onLauncher: () => void;
  onLauncherSettings: () => void;
};

/*
 * A game's own section (The Sims 4, GTA V, Skyrim, Fallout 4, Cyberpunk 2077, Stardew
 * Valley): its mods, finding more, its settings, and playing it, warned first when the
 * game has updated since it was last played.
 */
export default function GameSection({ gameId, onLauncher, onLauncherSettings }: Props) {
  const [page, setPage] = useState<GamePage>("home");
  const [openMod, setOpenMod] = useState<{ provider: GameModProvider; id: string } | null>(null);
  const [openCollection, setOpenCollection] = useState<string | null>(null);
  const deeper = Boolean(openMod || openCollection);
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const heroArt = useGameArt([gameId])(gameId, detail?.art);
  // Its Steam price, news and DLC, for Home.
  const store = useStoreInfo(gameId);
  const [mods, setMods] = useState<GameMod[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const launchPending = useRef(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [slowLaunch, setSlowLaunch] = useState(false);
  useEffect(() => window.gamesAPI.onLaunchProgress?.((event) => {
    if (event.gameId !== gameId || !launchPending.current) return;
    setPlaying(event.stage === "checking" ? "Checking game files…" : event.stage === "backup" ? "Backing up saves…" : "Opening game launcher…");
  }), [gameId]);
  const [banner, setBanner] = useState<{ tone: "good" | "bad" | "warn" | "info"; text: string; notes?: string[] } | null>(null);
  const [updates, setUpdates] = useState<GameUpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<GameRequirement[] | null>(null);
  const [getting, setGetting] = useState(false);
  const [sets, setSets] = useState<GameSet[]>([]);
  const [finder, setFinder] = useState<GameFinder>({ active: false });
  const [finderIntro, setFinderIntro] = useState(false);
  const [finderBusy, setFinderBusy] = useState(false);
  // What the game's Home lists as needing a look, checked again whenever the mods change.
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const found = Boolean(detail?.found);
  useEffect(() => {
    if (page !== "home" || !found) return;
    let active = true;
    window.gamesAPI.status(gameId)
      .then((next) => { if (active) { setStatus(next); setStatusFailed(false); } })
      .catch(() => { if (active) setStatusFailed(true); });
    return () => { active = false; };
  }, [gameId, page, found, mods]);

  const reload = useCallback(async () => {
    try {
      const [nextDetail, nextMods] = await Promise.all([window.gamesAPI.get(gameId), window.gamesAPI.mods(gameId)]);
      setDetail(nextDetail);
      setMods(nextMods);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, [gameId]);

  useEffect(() => {
    let active = true;
    Promise.all([window.gamesAPI.get(gameId), window.gamesAPI.mods(gameId)])
      .then(([nextDetail, nextMods]) => {
        if (!active) return;
        setDetail(nextDetail);
        setMods(nextMods);
      })
      .catch((err) => active && setLoadError(errorText(err)));
    return () => {
      active = false;
    };
  }, [gameId]);

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      setUpdates(await window.gamesAPI.checkUpdates(gameId));
    } catch (err) {
      setUpdates({ updates: [], checked: 0, unknown: 0, needsKey: 0, error: errorText(err) });
    }
    setChecking(false);
  }, [gameId]);

  // Updates are looked for when the section opens, as for Minecraft's instances.
  useEffect(() => {
    let active = true;
    window.gamesAPI
      .checkUpdates(gameId)
      .then((found) => active && setUpdates(found))
      .catch((err) => active && setUpdates({ updates: [], checked: 0, unknown: 0, needsKey: 0, error: errorText(err) }));
    return () => {
      active = false;
    };
  }, [gameId]);

  const loadRequirements = useCallback(() => {
    window.gamesAPI
      .requirements(gameId)
      .then(setRequirements)
      .catch(() => setRequirements([]));
  }, [gameId]);

  // What's missing, the sets and any broken-mod finding under way, when the section opens.
  useEffect(() => {
    let active = true;
    window.gamesAPI
      .requirements(gameId)
      .then((found) => active && setRequirements(found))
      .catch(() => active && setRequirements([]));
    window.gamesAPI
      .sets(gameId)
      .then((found) => active && setSets(found))
      .catch(() => {});
    window.gamesAPI
      .finder(gameId)
      .then((found) => active && setFinder(found))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [gameId]);

  /*
   * Downloads go on the app's queue (see the panel in the corner), which carries on
   * whichever page is open: straight in where the site allows, otherwise each Nexus page
   * opens in turn as the one before is installed.
   */
  async function queueAdd(items: GameQueueAdd[], said: string) {
    try {
      const added = await window.gamesAPI.queueAdd(items);
      setBanner({ tone: "info", text: added ? said : "Those are already on the downloads list." });
    } catch (err) {
      setBanner({ tone: "bad", text: errorText(err) });
    }
  }

  /* Gets what mods need (and then what those need), on the queue. */
  function getRequirements(entries: GameRequirement[]) {
    if (!entries.length) return;
    setGetting(true);
    queueAdd(
      entries.map((entry) => ({ gameId, kind: "requirement" as const, key: entry.key, name: entry.name, modId: entry.modId ?? undefined })),
      `Getting ${entries.map((e) => e.name).join(", ")}: the downloads panel in the corner shows how it's going.`
    ).finally(() => setGetting(false));
  }

  /* After an install: what it needs is already on the queue (the launcher adds it). */
  const afterInstall = (result?: GameInstallResult | null) => {
    reload();
    recheck();
    loadRequirements();
    if (result?.missing?.length) setBanner({ tone: "info", text: `${result.mod?.name ?? "It"} needs ${result.missing.map((m) => m.name).join(", ")}: getting ${result.missing.length === 1 ? "it" : "them"} too.` });
  };

  /* A free Nexus account installs through the website: the mod's page first, then what it needs. */
  async function openOnNexus(item: { modId: string; name: string; page: string }) {
    const fileId = item.page.match(/file_id=(\d+)/)?.[1];
    const needs = await window.gamesAPI.requirementsBefore(gameId, item.modId).catch(() => [] as GameRequirement[]);
    await queueAdd(
      [
        { gameId, kind: "nexus-file", modId: item.modId, fileId, name: item.name },
        ...needs.map((entry) => ({ gameId, kind: "requirement" as const, key: entry.key, name: entry.name, modId: entry.modId ?? undefined })),
      ],
      needs.length ? `Installing ${item.name}, then ${needs.map((n) => n.name).join(", ")} that it needs.` : `Installing ${item.name}.`
    );
  }

  // The queue says when it's changed this game's mods.
  useEffect(
    () =>
      window.gamesAPI.onModsChanged((event) => {
        if (event.gameId !== gameId) return;
        reload();
        recheck();
        loadRequirements();
      }),
    [gameId, reload, recheck, loadRequirements]
  );

  // A "Mod Manager Download" from the Nexus Mods website, handed to the launcher.
  useEffect(
    () =>
      window.gamesAPI.onNxm((event) => {
        if (event.status === "started" || event.status === "working") setBanner({ tone: "info", text: `${event.detail ?? `Getting ${event.name}`}...` });
        else if (event.status === "failed") setBanner({ tone: "bad", text: event.error ?? "That download didn't work.", notes: event.notes });
        else if (event.status === "installed" && event.result) {
          setBanner({ tone: event.result.notes?.length ? "warn" : "good", text: `${installSummary(event.result)}${event.gameId !== gameId ? " (in its own game's section)" : ""}`, notes: event.result.notes });
          if (event.gameId === gameId) afterInstall(event.result);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gameId, reload, recheck]
  );

  /* Updates one mod, on the queue (through the website where Nexus requires it). */
  function updateOne(found: GameModUpdate) {
    queueAdd([{ gameId, kind: "update", key: found.key, name: found.name, modId: found.modId }], `Updating ${found.name}${found.toVersion ? ` to ${found.toVersion}` : ""}.`);
  }

  /* Updates everything with a newer version, on the queue. */
  function updateAll() {
    // Mods kept at their version stay as they are.
    const kept = new Set(mods.filter((mod) => mod.kept).map((mod) => mod.key));
    const list = (updates?.updates ?? []).filter((found) => !found.website && !kept.has(found.key));
    if (!list.length) return;
    setUpdating(`all:0/${list.length}`);
    queueAdd(
      list.map((found) => ({ gameId, kind: "update" as const, key: found.key, name: found.name, modId: found.modId })),
      `Updating ${list.length} mod${list.length === 1 ? "" : "s"}: the downloads panel in the corner shows how it's going. Undo on a mod's row puts its earlier copy back.`
    ).finally(() => setUpdating(null));
  }

  async function undo(mod: GameMod) {
    try {
      const back = await window.gamesAPI.undoUpdate(gameId, mod.key);
      setBanner({ tone: "good", text: `Put back the earlier copy of ${back.restored}${back.version ? ` (${back.version})` : ""}.` });
    } catch (err) {
      setBanner({ tone: "bad", text: errorText(err) });
    }
    await reload();
    await recheck();
  }

  async function play(safe: boolean) {
    if (launchPending.current) return;
    launchPending.current = true;
    setAsking(false);
    setBanner(null);
    setLaunchError(null);
    setSlowLaunch(false);
    setPlaying("Preparing launch…");
    const slowTimer = window.setTimeout(() => setSlowLaunch(true), 15000);
    try {
      const started = await window.gamesAPI.launch(gameId, { safe });
      setBanner({
        tone: started.backupError ? "warn" : "good",
        text: `Launch request sent for ${detail?.name} through ${started.how}. Check the game or platform launcher for sign-in and startup${safe ? `, with the mods that hook into its code disabled. Turn them back on once they're updated${gameId === "sims4" ? " (Settings, or the note on the Mods page)" : ": playing normally next time does that"}.` : "."}${
          started.backedUp ? ` Your saves were backed up first (${started.backedUp.reason.replace(/^Before /, "before ")}); Settings can put them back.` : ""
        }${started.backupError ? ` Your saves couldn't be backed up first: ${started.backupError}` : ""}`,
      });
      void reload();
    } catch (err) {
      setLaunchError(errorText(err));
    } finally {
      window.clearTimeout(slowTimer);
      launchPending.current = false;
      setPlaying(null);
      setSlowLaunch(false);
    }
  }

  const risky = mods.filter((mod) => mod.mayNeedUpdate && mod.enabled);
  const onPlay = () => {
    if (playing) return;
    // While finding a broken mod, each round is played as it's set up.
    if (finder.active) return play(false);
    // Warn when the game's updated under mods that change its code and are older than the update.
    if (detail?.updated && risky.length > 0) setAsking(true);
    else play(false);
  };

  /* ---------------- sets ---------------- */

  async function setsDo(work: () => Promise<GameSet[]>) {
    try {
      setSets(await work());
    } catch (err) {
      setBanner({ tone: "bad", text: errorText(err) });
      throw err;
    }
  }
  const setsApi = {
    member: (setId: string, key: string, member: boolean) => setsDo(() => window.gamesAPI.setMember(gameId, setId, key, member)).catch(() => {}),
    create: async (name: string, key?: string) => {
      const next = await window.gamesAPI.saveSet(gameId, { name }).catch((err) => {
        setBanner({ tone: "bad", text: errorText(err) });
        return null;
      });
      if (!next) return null;
      const made = next.find((set) => set.name.toLowerCase() === name.toLowerCase())!;
      setSets(key ? await window.gamesAPI.setMember(gameId, made.id, key, true) : next);
      return made.id;
    },
    rename: (setId: string, name: string) => setsDo(() => window.gamesAPI.saveSet(gameId, { id: setId, name })).catch(() => {}),
    remove: (setId: string) => setsDo(() => window.gamesAPI.deleteSet(gameId, setId)).catch(() => {}),
    use: async (set: GameSet) => {
      try {
        const done = await window.gamesAPI.useSet(gameId, set.id);
        setBanner({ tone: "good", text: done.changed ? `Turned on just the ${set.name} set (${done.changed} mod${done.changed === 1 ? "" : "s"} changed).` : `Only the ${set.name} set was on already.` });
      } catch (err) {
        setBanner({ tone: "bad", text: errorText(err) });
      }
      await reload();
    },
  };

  /* ---------------- finding a broken mod ---------------- */

  async function finderDo(work: () => Promise<GameFinder>, after?: (found: GameFinder) => void) {
    setFinderBusy(true);
    try {
      const found = await work();
      setFinder(found);
      after?.(found);
    } catch (err) {
      setBanner({ tone: "bad", text: errorText(err) });
    }
    setFinderBusy(false);
    await reload();
  }
  const finderApi = {
    intro: () => setFinderIntro(true),
    cancelIntro: () => setFinderIntro(false),
    start: () => finderDo(() => window.gamesAPI.finderStart(gameId), () => setFinderIntro(false)),
    answer: (happened: boolean) => finderDo(() => window.gamesAPI.finderAnswer(gameId, happened)),
    stop: (keepOff: string | null) =>
      finderDo(
        () => window.gamesAPI.finderStop(gameId, keepOff),
        (done) => setBanner({ tone: "good", text: done.keptOff ? `Put your mods back as they were, with ${done.keptOff} left off.` : "Put your mods back as they were." })
      ),
  };

  const go = (next: GamePage) => {
    setOpenMod(null);
    setOpenCollection(null);
    setPage(next);
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--color-bg)", color: "var(--color-text)" }}>
      <GameSidebar
        game={detail?.name ?? ""}
        hasLoadOrder={Boolean(detail?.loadOrder)}
        hasTools={detail?.loadOrder === "plugins" || Boolean(detail?.graphics)}
        hasCC={gameId === "sims4"}
        current={deeper ? null : page}
        go={go}
        showBack={deeper}
        onBack={() => {
          setOpenMod(null);
          setOpenCollection(null);
        }}
        onLauncher={onLauncher}
      />

      <div style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden", display: "flex" }}>
        <BackgroundLogo />
        <div style={{ flex: 1, minWidth: 0, padding: 30, overflowY: "auto", position: "relative", boxSizing: "border-box", textAlign: "left" }}>
          {loadError && <Notice tone="danger" style={{ marginBottom: 16 }} actions={<Button size="sm" variant="ghost" onClick={() => void reload()}>Retry loading game</Button>}>{loadError}</Notice>}
          {playing && <Notice style={{ marginBottom: 16 }}>
            <strong>{playing}</strong>
            <ProgressBar label={playing} />
            <p>{slowLaunch ? "This is taking longer than usual. Save backups can take time. The request is still pending; check the platform launcher for prompts before trying to launch again." : "Keep this request open while Unity prepares the game. Any platform sign-in happens in its own launcher."}</p>
          </Notice>}
          {launchError && <Notice tone="danger" style={{ marginBottom: 16 }} data-testid="launch-error">
            <strong>{detail?.name ?? "The game"} could not be launched.</strong>
            <p>Check the game folder and sign in to the platform launcher, then try again.</p>
            <details><summary>Technical details</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: "text" }}>{launchError}</pre></details>
            <div className="db-actions">
              <Button size="sm" onClick={onPlay}>Try again</Button>
              <Button size="sm" variant="ghost" onClick={() => go("settings")}>Game settings</Button>
              <Button size="sm" variant="ghost" onClick={() => setLaunchError(null)}>Dismiss</Button>
            </div>
          </Notice>}
          {banner && (
            <Notice tone={banner.tone === "bad" ? "danger" : banner.tone === "warn" ? "warning" : banner.tone === "good" ? "success" : "info"} style={{ marginBottom: 16 }} data-testid="game-banner">
              <div style={{ display: "flex", gap: 12 }}>
                <span style={{ flex: 1 }}>{banner.text}</span>
                <button onClick={() => setBanner(null)} aria-label="Dismiss" style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 16 }}>
                  ×
                </button>
              </div>
              {banner.notes?.map((line) => (
                <div key={line} style={{ fontSize: 12, marginTop: 4 }}>
                  • {line}
                </div>
              ))}
            </Notice>
          )}

          {!detail ? (
            !loadError && <div style={{ color: "var(--color-text-muted)" }}>Loading...</div>
          ) : (
            <>
              {page === "home" && (
                <div className="game-overview">
                  <section className={`game-hero${detail.found ? "" : " game-hero--missing"}`} style={{ "--game-colour": detail.colour } as React.CSSProperties}>
                    {heroArt && <img className="game-hero__backdrop" src={heroArt} alt="" aria-hidden="true" referrerPolicy="no-referrer" draggable={false} />}
                    <div className="game-hero__body">
                      <h1 className="game-hero__title">{detail.name}</h1>
                      <p className="game-hero__lead">{detail.tagline}</p>
                      {(() => {
                        // Steam first; a game Steam doesn't sell gets its best other store (its own site last).
                        const stores = store?.stores ?? [];
                        const shop = store?.steamAppId ? null : (stores.find((s) => s.store !== "site") ?? (store?.pc === false ? null : stores[0]) ?? null);
                        const also = detail.found ? [] : stores.filter((s) => s !== shop && s.store !== "steam");
                        const sold = Boolean(store?.steamAppId || shop);
                        return (
                          <>
                      <div className="game-hero__actions">
                        {!detail.found && store?.steamAppId && (
                          <Button variant="primary" size="lg" icon={<Download size={16} aria-hidden="true" />} onClick={() => void window.gamesAPI.getOnSteam(store.steamAppId!)}>
                            Get on Steam
                          </Button>
                        )}
                        {!detail.found && shop && (
                          <Button variant="primary" size="lg" icon={<ExternalLink size={16} aria-hidden="true" />} onClick={() => void window.gamesAPI.openUrl(shop.url)}>
                            {shop.store === "site" ? "Official site" : `Get on ${shop.label}`}
                          </Button>
                        )}
                        {!detail.found && (store?.price ?? shop?.price) && <PriceText price={store?.price ?? shop?.price ?? null} />}
                        {!detail.found
                          ? <Button variant={sold ? "secondary" : "primary"} size="lg" onClick={() => go("settings")}>{sold ? "Already have it?" : "Choose game folder"}</Button>
                          : detail.cantRun
                            ? <>
                                <Button variant="primary" size="lg" onClick={() => go("discover")}>Discover mods</Button>
                                <Button variant="secondary" size="sm" icon={<Play size={14} aria-hidden="true" />} disabled title={detail.cantRun}>Play</Button>
                                <span className="game-hero__source">Can't play on this Mac</span>
                              </>
                            : <Button variant="primary" size="lg" icon={<Play size={16} aria-hidden="true" />} disabled={Boolean(playing)} onClick={onPlay}>{playing ?? "Play"}</Button>}
                        {!detail.cantRun && (
                          <span className="game-hero__source">
                            {detail.found
                              ? (detail.source ? `Found through ${detail.source}` : "Found on this computer")
                              : store?.pc === false
                                ? `Not released on PC${store.platforms?.length ? `: ${store.platforms.slice(0, 4).join(", ")}` : ""}`
                                : "Not found on this computer"}
                          </span>
                        )}
                      </div>
                      {also.length > 0 && (
                        <p className="game-hero__stores">
                          <span>{shop || store?.steamAppId ? "Also on" : "Get it on"}</span>
                          {also.map((s) => (
                            <button key={s.store} type="button" className="gs-more" onClick={() => void window.gamesAPI.openUrl(s.url)}>
                              {s.label}
                              {s.price && <PriceText price={s.price} />}
                              <ExternalLink size={12} aria-hidden="true" />
                            </button>
                          ))}
                        </p>
                      )}
                          </>
                        );
                      })()}
                    </div>
                  </section>
                  {detail.cantRun && <Notice tone="warning" data-testid="game-home-cant-run">{detail.cantRun} You can still install and manage its mods here.</Notice>}
                  {(() => {
                    const on = mods.filter((mod) => mod.enabled).length;
                    const off = mods.length - on;
                    const facts = [
                      detail.lastPlayed ? { label: "Last launched", value: timeAgo(detail.lastPlayed) } : null,
                      detail.version ? { label: "Version", value: detail.version } : null,
                      mods.length > 0 ? { label: "Enabled mods", value: String(on) } : null,
                      off > 0 ? { label: "Turned off", value: String(off) } : null,
                    ].filter((fact): fact is { label: string; value: string } => fact !== null);
                    if (!facts.length) return null;
                    return (
                      <section className="db-card" aria-label="Game overview">
                        <dl className="db-kpis" style={{ "--kpi-cols": Math.min(facts.length, 4) } as React.CSSProperties}>
                          {facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd title={fact.value}>{fact.value}</dd></div>)}
                        </dl>
                      </section>
                    );
                  })()}
                  {detail.found && <GameChecks status={status} failed={statusFailed} detail={detail} modCount={mods.length} go={go} />}
                  <GameStore name={detail.name} info={store} />
                </div>
              )}

              {page === "mods" && !openMod && (
                <GameMods
                  detail={detail}
                  mods={mods}
                  reload={reload}
                  onPlay={onPlay}
                  playing={playing}
                  goSettings={() => go("settings")}
                  goLauncherSettings={onLauncherSettings}
                  updates={updates}
                  checking={checking}
                  updating={updating}
                  onCheckUpdates={recheck}
                  onUpdate={updateOne}
                  onUpdateAll={updateAll}
                  onUndo={undo}
                  onInstalled={(result) => afterInstall(result)}
                  requirements={requirements}
                  getting={getting}
                  onGetRequirements={(entries) => getRequirements(entries)}
                  sets={sets}
                  setsApi={setsApi}
                  finder={finder}
                  finderIntro={finderIntro}
                  finderBusy={finderBusy}
                  finderApi={finderApi}
                  goLoadOrder={() => go("loadorder")}
                />
              )}

              {/* Discover stays behind a mod's page, so Back returns to the same results. */}
              {page === "discover" && (
                <div style={{ display: deeper ? "none" : "block" }}>
                  <GameDiscover
                    detail={detail}
                    openMod={(provider, id) => setOpenMod({ provider, id })}
                    afterInstall={(result) => afterInstall(result)}
                    openOnNexus={openOnNexus}
                    goLauncherSettings={onLauncherSettings}
                    goMods={() => go("mods")}
                    openCollection={setOpenCollection}
                  />
                </div>
              )}
              {openCollection && <CollectionPage key={openCollection} detail={detail} slug={openCollection} />}
              {openMod && (
                <GameModPage
                  key={`${openMod.provider}:${openMod.id}`}
                  detail={detail}
                  provider={openMod.provider}
                  modId={openMod.id}
                  afterInstall={(result) => afterInstall(result)}
                  openOnNexus={openOnNexus}
                  goLauncherSettings={onLauncherSettings}
                />
              )}

              {page === "cc" && !openMod && <CCBrowser detail={detail} reload={reload} />}

              {page === "loadorder" && !openMod &&
                (detail.loadOrder === "plugins" ? (
                  <LoadOrderPage detail={detail} onGetRequirements={(entries) => getRequirements(entries)} />
                ) : (
                  <ModOrderPage detail={detail} />
                ))}

              {page === "tools" && !openMod && <GameTools detail={detail} />}

              {page === "settings" && !openMod && <GameSettings detail={detail} reload={reload} goLauncherSettings={onLauncherSettings} onRemoved={onLauncher} />}
            </>
          )}
        </div>
      </div>

      {asking && detail && <PlayPrompt detail={detail} risky={risky} onChoose={(choice) => (choice === "cancel" ? setAsking(false) : play(choice === "safe"))} />}
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Check = { tone: "danger" | "warning"; label: string; page: GamePage; action: string };

/* The game's Home: what needs a look in its mods, each with the page that deals with it. */
function GameChecks({ status, failed, detail, modCount, go }: {
  status: GameStatus | null;
  failed: boolean;
  detail: GameDetail;
  modCount: number;
  go: (page: GamePage) => void;
}) {
  if (failed && !status) return <Notice tone="warning">The mod checks couldn't be completed. The Mods page runs each one again.</Notice>;
  const found: (Check | null)[] = !status ? [] : [
    status.crashes ? { tone: "danger", label: status.crashes === 1 ? "The game crashed since you last played" : `${status.crashes} crash reports since you last played`, page: "mods", action: "See why" } : null,
    status.clashes ? { tone: "danger", label: plural(status.clashes, "mod conflict", "mod conflicts"), page: "mods", action: "Resolve" } : null,
    status.loadOrder ? { tone: "danger", label: detail.loadOrder === "plugins" ? "A plugin loads before something it needs" : "A mod loads before something it needs", page: "loadorder", action: "Fix load order" } : null,
    status.requirements ? { tone: "danger", label: `${plural(status.requirements, "required mod is", "required mods are")} missing`, page: "mods", action: "Get them" } : null,
    status.health ? { tone: "warning", label: plural(status.health, "mod folder problem", "mod folder problems"), page: "mods", action: "Review" } : null,
    detail.updated ? { tone: "warning", label: "The game updated since you last played: some mods may need updates too", page: "mods", action: "Check mods" } : null,
    status.updates ? { tone: "warning", label: `${plural(status.updates, "mod update", "mod updates")} available`, page: "mods", action: "Update" } : null,
  ];
  const rows = found.filter((row): row is Check => row !== null);
  return (
    <section className="db-card game-checks" aria-labelledby="game-checks-title" aria-busy={!status} data-testid="game-checks">
      <header className="db-card__head">
        <h2 className="db-card__title" id="game-checks-title">Mod checks</h2>
        <span className="db-card__meta">{!status ? "Checking…" : rows.length ? `${rows.length} to look at` : modCount ? "All good" : null}</span>
      </header>
      {!status ? (
        <p className="game-checks__ok">Checking for crashes, conflicts, missing requirements and updates…</p>
      ) : rows.length === 0 && modCount === 0 ? (
        <div className="game-checks__empty">
          <p className="game-checks__ok">No mods yet. Find some for {detail.name}, or add a file you downloaded on the Mods page.</p>
          <Button size="sm" variant="primary" onClick={() => go("discover")}>Discover mods</Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="game-checks__ok"><CircleCheck size={16} aria-hidden="true" />No crashes, conflicts, missing requirements or folder problems found.</p>
      ) : (
        <ul className="game-checks__list">
          {rows.map((row) => (
            <li key={row.label} className={`game-checks__row game-checks__row--${row.tone}`}>
              {row.tone === "danger" ? <CircleAlert size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}
              <span>{row.label}</span>
              <Button size="sm" variant="ghost" onClick={() => go(row.page)}>{row.action}</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
