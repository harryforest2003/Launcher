import { useCallback, useEffect, useRef, useState } from "react";
import BackgroundLogo from "../components/BackgroundLogo";
import GameSidebar, { type GamePage } from "../components/GameSidebar";
import GameDiscover from "./games/GameDiscover";
import GameModPage from "./games/GameModPage";
import GameMods from "./games/GameMods";
import GameSettings from "./games/GameSettings";
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
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [mods, setMods] = useState<GameMod[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: "good" | "bad" | "warn" | "info"; text: string; notes?: string[] } | null>(null);
  const [updates, setUpdates] = useState<GameUpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  // Updates a free Nexus account gets through the website, one page at a time.
  const [queue, setQueue] = useState<{ modId: string; name: string; page: string }[]>([]);
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

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

  const openNext = (next: { name: string; page: string }[], doneName?: string) => {
    if (!next.length) return;
    window.gamesAPI.openUrl(next[0].page).catch(() => {});
    setBanner({
      tone: "info",
      text: `${doneName ? `Updated ${doneName}. ` : ""}Updating ${next[0].name} through Nexus Mods: press the download button on the page that opened and the launcher installs it${next.length > 1 ? `, then opens the next (${next.length - 1} more)` : ""}.`,
    });
  };

  // A "Mod Manager Download" from the Nexus Mods website, handed to the launcher.
  useEffect(
    () =>
      window.gamesAPI.onNxm((event) => {
        if (event.status === "started" || event.status === "working") setBanner({ tone: "info", text: `${event.detail ?? `Getting ${event.name}`}...` });
        else if (event.status === "failed") setBanner({ tone: "bad", text: event.error ?? "That download didn't work.", notes: event.notes });
        else if (event.status === "installed" && event.result) {
          const waiting = queueRef.current;
          if (event.gameId === gameId && waiting.length && waiting[0].modId === event.modId) {
            // The update the website was opened for: on to the next.
            const rest = waiting.slice(1);
            setQueue(rest);
            if (rest.length) openNext(rest, event.name);
            else setBanner({ tone: "good", text: `Updated ${event.name}. That's every update.` });
          } else {
            setBanner({ tone: event.result.notes?.length ? "warn" : "good", text: `${installSummary(event.result)}${event.gameId !== gameId ? " (in its own game's section)" : ""}`, notes: event.result.notes });
          }
          if (event.gameId === gameId) {
            reload();
            recheck();
          }
        }
      }),
    [gameId, reload, recheck]
  );

  /* Updates one mod; through the website where Nexus requires it. */
  async function updateOne(found: GameModUpdate) {
    setUpdating(found.key);
    setBanner(null);
    try {
      const result = await window.gamesAPI.update(gameId, found.key);
      if (result.needsWebsite) {
        const next = [{ modId: result.modId ?? found.modId, name: found.name, page: result.needsWebsite }];
        setQueue(next);
        openNext(next);
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
    const website: { modId: string; name: string; page: string }[] = [];
    const problems: string[] = [];
    let done = 0;
    setBanner(null);
    for (const [index, found] of list.entries()) {
      setUpdating(`all:${index + 1}/${list.length}`);
      try {
        const result = await window.gamesAPI.update(gameId, found.key);
        if (result.needsWebsite) website.push({ modId: result.modId ?? found.modId, name: found.name, page: result.needsWebsite });
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
      setQueue(website);
      openNext(website);
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
        tone: "good",
        text: `Started ${detail?.name} through ${started.how}${safe ? `, without the mods that hook into its code. Turn them back on once they're updated${gameId === "sims4" ? " (Settings, or the note on the Mods page)" : ": playing normally next time does that"}.` : "."}`,
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
    // Warn when the game's updated under mods that change its code and are older than the update.
    if (detail?.updated && risky.length > 0) setAsking(true);
    else play(false);
  };

  const go = (next: GamePage) => {
    setOpenMod(null);
    setPage(next);
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "#0d0d0d", color: "white" }}>
      <GameSidebar
        game={detail?.name ?? ""}
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
                    Stop updating
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
                />
              )}

              {/* Discover stays behind a mod's page, so Back returns to the same results. */}
              {page === "discover" && (
                <div style={{ display: openMod ? "none" : "block" }}>
                  <GameDiscover
                    detail={detail}
                    openMod={(provider, id) => setOpenMod({ provider, id })}
                    afterInstall={() => {
                      reload();
                      recheck();
                    }}
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
                  afterInstall={reload}
                  goLauncherSettings={onLauncherSettings}
                />
              )}

              {page === "settings" && !openMod && <GameSettings detail={detail} reload={reload} goLauncherSettings={onLauncherSettings} />}
            </>
          )}
        </div>
      </div>

      {asking && detail && <PlayPrompt detail={detail} risky={risky} onChoose={(choice) => (choice === "cancel" ? setAsking(false) : play(choice === "safe"))} />}
    </div>
  );
}
