import { useCallback, useEffect, useRef, useState } from "react";
import BackgroundLogo from "../components/BackgroundLogo";
import GameSidebar, { type GamePage } from "../components/GameSidebar";
import GameDiscover from "./games/GameDiscover";
import GameModPage from "./games/GameModPage";
import GameMods from "./games/GameMods";
import GameSettings from "./games/GameSettings";
import LoadOrderPage from "./games/LoadOrderPage";
import PlayPrompt from "./games/PlayPrompt";
import { errorText, installSummary, note } from "./games/shared";

type QueueItem = { modId: string; name: string; page: string; verb: "Updating" | "Installing" | "Getting" };

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
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [mods, setMods] = useState<GameMod[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: "good" | "bad" | "warn" | "info"; text: string; notes?: string[] } | null>(null);
  const [updates, setUpdates] = useState<GameUpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  // What a free Nexus account gets through the website (updates, installs and what they
  // need), one page at a time: each opens when the one before has installed.
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
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

  const openNext = (next: QueueItem[], before?: string) => {
    if (!next.length) return;
    window.gamesAPI.openUrl(next[0].page).catch(() => {});
    setBanner({
      tone: "info",
      text: `${before ? `${before} ` : ""}${next[0].verb} ${next[0].name} through Nexus Mods: press the download button on the page that opened and the launcher installs it${next.length > 1 ? `, then opens the next (${next.length - 1} more)` : ""}.`,
    });
  };

  /* Adds pages to the queue; the first opens now if nothing's waiting. */
  const enqueue = (items: QueueItem[], before?: string) => {
    const current = queueRef.current;
    const fresh = items.filter((item, i) => !current.some((c) => c.modId === item.modId) && items.findIndex((other) => other.modId === item.modId) === i);
    if (!fresh.length) return;
    const next = [...current, ...fresh];
    queueRef.current = next;
    setQueue(next);
    if (!current.length) openNext(next, before);
  };

  /*
   * Gets what mods need: straight in where the site allows (and then what those need too),
   * other sites' pages opened, and Nexus Mods pages queued one at a time, as Update all does.
   */
  async function getRequirements(entries: GameRequirement[], before?: string) {
    const pending = [...entries];
    const seen = new Set<string>();
    const website: QueueItem[] = [];
    const problems: string[] = [];
    const got: string[] = [];
    const opened: string[] = [];
    setGetting(true);
    while (pending.length) {
      const entry = pending.shift()!;
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
      try {
        const result = await window.gamesAPI.getRequirement(gameId, entry.key);
        if (result.failed) problems.push(`${entry.name}: ${result.failed}`);
        else if (result.opened) opened.push(entry.name);
        else if (result.needsWebsite) website.push({ modId: result.modId ?? entry.modId ?? entry.key, name: entry.name, page: result.needsWebsite, verb: "Getting" });
        else {
          got.push(entry.name);
          pending.push(...(result.missing ?? []));
        }
      } catch (err) {
        problems.push(`${entry.name}: ${errorText(err)}`);
      }
    }
    setGetting(false);
    await reload();
    loadRequirements();
    const said = [
      before,
      got.length ? `Installed ${got.join(", ")}.` : "",
      opened.length ? `Opened ${opened.join(", ")} on ${opened.length === 1 ? "its own site" : "their own sites"}: download ${opened.length === 1 ? "it" : "them"} there, then add ${opened.length === 1 ? "it" : "them"} from Downloads.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (website.length) enqueue(website, said);
    else if (said || problems.length) setBanner({ tone: problems.length ? "warn" : "good", text: said || "Some couldn't be got.", notes: problems });
  }

  /* After an install: anything it needs that isn't there is got straight away. */
  const afterInstall = (result?: GameInstallResult | null, before?: string) => {
    reload();
    recheck();
    loadRequirements();
    if (result?.missing?.length) {
      getRequirements(result.missing, `${before ?? `Installed ${result.mod?.name ?? "it"}.`} It needs ${result.missing.map((m) => m.name).join(", ")}, so ${result.missing.length === 1 ? "that's" : "they're"} being got too.`);
    }
  };

  /* A free Nexus account installs through the website: the mod's page first, then what it needs. */
  async function openOnNexus(item: { modId: string; name: string; page: string }) {
    const needs = await window.gamesAPI.requirementsBefore(gameId, item.modId).catch(() => [] as GameRequirement[]);
    enqueue([{ ...item, verb: "Installing" }]);
    if (needs.length) await getRequirements(needs, `${item.name} needs ${needs.map((n) => n.name).join(", ")}: ${needs.length === 1 ? "it's" : "they're"} next.`);
  }

  // A "Mod Manager Download" from the Nexus Mods website, handed to the launcher.
  useEffect(
    () =>
      window.gamesAPI.onNxm((event) => {
        if (event.status === "started" || event.status === "working") setBanner({ tone: "info", text: `${event.detail ?? `Getting ${event.name}`}...` });
        else if (event.status === "failed") setBanner({ tone: "bad", text: event.error ?? "That download didn't work.", notes: event.notes });
        else if (event.status === "installed" && event.result) {
          const waiting = queueRef.current;
          if (event.gameId === gameId && waiting.length && waiting[0].modId === event.modId) {
            // The page the website was opened for: on to the next.
            const done = waiting[0];
            const rest = waiting.slice(1);
            queueRef.current = rest;
            setQueue(rest);
            const said = `${done.verb === "Updating" ? "Updated" : "Installed"} ${event.name}.`;
            if (rest.length) openNext(rest, said);
            else if (!event.result.missing?.length) setBanner({ tone: "good", text: `${said} That's all of them.` });
          } else {
            setBanner({ tone: event.result.notes?.length ? "warn" : "good", text: `${installSummary(event.result)}${event.gameId !== gameId ? " (in its own game's section)" : ""}`, notes: event.result.notes });
          }
          if (event.gameId === gameId) afterInstall(event.result, `Installed ${event.name}.`);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gameId, reload, recheck]
  );

  /* Updates one mod; through the website where Nexus requires it. */
  async function updateOne(found: GameModUpdate) {
    setUpdating(found.key);
    setBanner(null);
    try {
      const result = await window.gamesAPI.update(gameId, found.key);
      if (result.needsWebsite) {
        enqueue([{ modId: result.modId ?? found.modId, name: found.name, page: result.needsWebsite, verb: "Updating" }]);
      } else if (result.needsWebsite === null) {
        setBanner({ tone: "info", text: `${result.reason ?? ""} Download ${found.name} there, then add it from Downloads.` });
      } else if (result.failed) {
        setBanner({ tone: "bad", text: `${found.name} couldn't be updated: ${result.failed}`, notes: result.notes });
      } else {
        setBanner({ tone: result.notes?.length ? "warn" : "good", text: `Updated ${found.name}${found.toVersion ? ` to ${found.toVersion}` : ""}. Undo on its row puts the earlier copy back.` });
      }
    } catch (err) {
      setBanner({ tone: "bad", text: errorText(err) });
    }
    setUpdating(null);
    await reload();
    await recheck();
  }

  /* Updates everything with a newer version; any the website has to give are queued after. */
  async function updateAll() {
    const list = (updates?.updates ?? []).filter((found) => !found.website);
    const website: QueueItem[] = [];
    const problems: string[] = [];
    let done = 0;
    setBanner(null);
    for (const [index, found] of list.entries()) {
      setUpdating(`all:${index + 1}/${list.length}`);
      try {
        const result = await window.gamesAPI.update(gameId, found.key);
        if (result.needsWebsite) website.push({ modId: result.modId ?? found.modId, name: found.name, page: result.needsWebsite, verb: "Updating" });
        else if (result.failed) problems.push(`${found.name}: ${result.failed}`);
        else done += 1;
      } catch (err) {
        problems.push(`${found.name}: ${errorText(err)}`);
      }
    }
    setUpdating(null);
    await reload();
    await recheck();
    if (website.length) {
      enqueue(website, done ? `Updated ${done}.` : undefined);
      return;
    }
    setBanner({
      tone: problems.length ? (done ? "warn" : "bad") : "good",
      text: `Updated ${done} of ${list.length} mod${list.length === 1 ? "" : "s"}.${done ? " Undo on a mod's row puts its earlier copy back." : ""}`,
      notes: problems,
    });
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
    setPage(next);
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "#0d0d0d", color: "white" }}>
      <GameSidebar
        game={detail?.name ?? ""}
        hasLoadOrder={Boolean(detail?.loadOrder)}
        current={openMod ? null : page}
        go={go}
        showBack={Boolean(openMod)}
        onBack={() => setOpenMod(null)}
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
              {queue.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="sidebar-button" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => window.gamesAPI.openUrl(queue[0].page).catch(() => {})}>
                    Open the page again
                  </button>
                  {queue.length > 1 && (
                    <button
                      className="sidebar-button"
                      style={{ padding: "6px 12px", fontSize: 12 }}
                      onClick={() => {
                        const rest = queue.slice(1);
                        setQueue(rest);
                        openNext(rest);
                      }}
                    >
                      Skip {queue[0].name}
                    </button>
                  )}
                  <button
                    className="sidebar-button"
                    style={{ padding: "6px 12px", fontSize: 12 }}
                    onClick={() => {
                      setQueue([]);
                      setBanner(null);
                    }}
                  >
                    Stop
                  </button>
                </div>
              )}
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
                  onInstalled={(result, before) => afterInstall(result, before)}
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
                <div style={{ display: openMod ? "none" : "block" }}>
                  <GameDiscover
                    detail={detail}
                    openMod={(provider, id) => setOpenMod({ provider, id })}
                    afterInstall={(result) => afterInstall(result)}
                    openOnNexus={openOnNexus}
                    goLauncherSettings={onLauncherSettings}
                    goMods={() => go("mods")}
                  />
                </div>
              )}
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
