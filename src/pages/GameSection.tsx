import { useCallback, useEffect, useState } from "react";
import BackgroundLogo from "../components/BackgroundLogo";
import GameSidebar, { type GamePage } from "../components/GameSidebar";
import GameDiscover from "./games/GameDiscover";
import GameModPage from "./games/GameModPage";
import CollectionPage from "./games/CollectionPage";
import GameMods from "./games/GameMods";
import GameSettings from "./games/GameSettings";
import LoadOrderPage from "./games/LoadOrderPage";
import PlayPrompt from "./games/PlayPrompt";
import { errorText, installSummary, note } from "./games/shared";

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
  const [page, setPage] = useState<GamePage>("mods");
  const [openMod, setOpenMod] = useState<{ provider: "nexus" | "curseforge"; id: string } | null>(null);
  const [openCollection, setOpenCollection] = useState<string | null>(null);
  const deeper = Boolean(openMod || openCollection);
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [mods, setMods] = useState<GameMod[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
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
    const list = (updates?.updates ?? []).filter((found) => !found.website);
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
    setAsking(false);
    setBanner(null);
    setPlaying("Starting...");
    try {
      const started = await window.gamesAPI.launch(gameId, { safe });
      setBanner({
        tone: started.backupError ? "warn" : "good",
        text: `Started ${detail?.name} through ${started.how}${safe ? `, without the mods that hook into its code. Turn them back on once they're updated${gameId === "sims4" ? " (Settings, or the note on the Mods page)" : ": playing normally next time does that"}.` : "."}${
          started.backedUp ? ` Your saves were backed up first (${started.backedUp.reason.replace(/^Before /, "before ")}); Settings can put them back.` : ""
        }${started.backupError ? ` Your saves couldn't be backed up first: ${started.backupError}` : ""}`,
      });
      await reload();
    } catch (err) {
      setBanner({ tone: "bad", text: errorText(err) });
    }
    setPlaying(null);
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
    <div style={{ display: "flex", height: "100vh", background: "#0d0d0d", color: "white" }}>
      <GameSidebar
        game={detail?.name ?? ""}
        hasLoadOrder={Boolean(detail?.loadOrder)}
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
          {loadError && <div style={{ ...note("bad"), marginBottom: 16 }}>{loadError}</div>}
          {banner && (
            <div style={{ ...note(banner.tone), marginBottom: 16 }} data-testid="game-banner">
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
            </div>
          )}

          {!detail ? (
            !loadError && <div style={{ color: "#9ca3af" }}>Loading...</div>
          ) : (
            <>
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

              {page === "loadorder" && !openMod && <LoadOrderPage detail={detail} onGetRequirements={(entries) => getRequirements(entries)} />}

              {page === "settings" && !openMod && <GameSettings detail={detail} reload={reload} goLauncherSettings={onLauncherSettings} />}
            </>
          )}
        </div>
      </div>

      {asking && detail && <PlayPrompt detail={detail} risky={risky} onChoose={(choice) => (choice === "cancel" ? setAsking(false) : play(choice === "safe"))} />}
    </div>
  );
}
