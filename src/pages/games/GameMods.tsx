import { useEffect, useMemo, useState } from "react";
import { Bug, Folder, Play } from "lucide-react";
import SearchDropdown from "../../components/SearchDropdown";
import FinderPanel from "./FinderPanel";
import LoadOrderNotice from "./LoadOrderNotice";
import HealthPanel from "./HealthPanel";
import ConflictsPanel from "./ConflictsPanel";
import ClashesPanel from "./ClashesPanel";
import RequirementsPanel from "./RequirementsPanel";
import SetMenu from "./SetMenu";
import IconButton from "../../components/IconButton";
import { BinIcon, DownloadIcon, PlusIcon, RefreshIcon, ResetIcon } from "../../components/Icons";
import Toggle from "../../components/Toggle";
import { errorText, installSummary, note, panel, shortDate, sizeText, smallButton } from "./shared";

type Props = {
  detail: GameDetail;
  mods: GameMod[];
  reload: () => Promise<void>;
  onPlay: () => void;
  playing: string | null;
  goSettings: () => void;
  goLauncherSettings: () => void;
  updates: GameUpdateCheck | null;
  checking: boolean;
  /* The mod being updated (its key), or "all:2/5" while updating them all. */
  updating: string | null;
  onCheckUpdates: () => Promise<void>;
  onUpdate: (found: GameModUpdate) => void;
  onUpdateAll: () => void;
  onUndo: (mod: GameMod) => void;
  /* After an install: what it needs that's missing gets fetched. */
  onInstalled: (result: GameInstallResult, before?: string) => void;
  requirements: GameRequirement[] | null;
  getting: boolean;
  onGetRequirements: (entries: GameRequirement[]) => void;
  sets: GameSet[];
  setsApi: {
    member: (setId: string, key: string, member: boolean) => Promise<void>;
    create: (name: string, key?: string) => Promise<string | null>;
    rename: (setId: string, name: string) => Promise<void>;
    remove: (setId: string) => Promise<void>;
    use: (set: GameSet) => Promise<void>;
  };
  finder: GameFinder;
  finderIntro: boolean;
  finderBusy: boolean;
  finderApi: { intro: () => void; cancelIntro: () => void; start: () => void; answer: (happened: boolean) => void; stop: (keepOff: string | null) => void };
  goLoadOrder: () => void;
};

const ALL = "All mods";

type Filter = "all" | "on" | "off" | "update" | "newer";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "on", label: "On" },
  { id: "off", label: "Off" },
  // These two show only when a mod has one.
  { id: "newer", label: "Update available" },
  { id: "update", label: "May need updating" },
];

const PROVIDERS: Record<string, string> = { nexus: "Nexus Mods", curseforge: "CurseForge", file: "From a file", hand: "Added by hand" };

/*
 * A game's mods: each one on or off, what it is and where its files went, the ones that
 * may need updating after a game update, and adding more from Downloads.
 */
export default function GameMods({
  detail,
  mods,
  reload,
  onPlay,
  playing,
  goSettings,
  goLauncherSettings,
  updates,
  checking,
  updating,
  onCheckUpdates,
  onUpdate,
  onUpdateAll,
  onUndo,
  onInstalled,
  requirements,
  getting,
  onGetRequirements,
  sets,
  setsApi,
  finder,
  finderIntro,
  finderBusy,
  finderApi,
  goLoadOrder,
}: Props) {
  // A set shown on its own ("All mods" for every one), and naming a new set or renaming one.
  const [setShown, setSetShown] = useState(ALL);
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null);
  const currentSet = sets.find((set) => set.name === setShown) ?? null;
  const newer = useMemo(() => new Map((updates?.updates ?? []).map((found) => [found.key, found])), [updates]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "bad" | "warn"; text: string; notes?: string[] } | null>(null);
  const [showDownloads, setShowDownloads] = useState(false);
  const [downloads, setDownloads] = useState<GameDownload[] | null>(null);
  // Ticked for installing together: to start with, the new ones that look like this game's mods.
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const loadDownloads = () =>
    window.gamesAPI
      .downloads(detail.id)
      .then((found) => {
        setDownloads(found);
        setPicked(new Set(found.filter((file) => !file.installed && file.fits !== false).map((file) => file.path)));
      })
      .catch(() => setDownloads([]));

  useEffect(() => {
    if (showDownloads) loadDownloads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDownloads, detail.id]);

  // A second press of a bin is needed within a few seconds.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const counts: Partial<Record<Filter, number>> = { newer: newer.size, update: mods.filter((mod) => mod.mayNeedUpdate).length };
  // A filter that's emptied (everything updated) goes back to showing all.
  const activeFilter: Filter = counts[filter] === 0 ? "all" : filter;

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return mods.filter((mod) => {
      if (words && !mod.name.toLowerCase().includes(words) && !(mod.where ?? "").toLowerCase().includes(words)) return false;
      if (currentSet && !currentSet.keys.includes(mod.key)) return false;
      if (activeFilter === "on") return mod.enabled;
      if (activeFilter === "off") return !mod.enabled;
      if (activeFilter === "update") return mod.mayNeedUpdate;
      if (activeFilter === "newer") return newer.has(mod.key);
      return true;
    });
  }, [mods, query, activeFilter, newer, currentSet]);

  const mayNeedUpdate = mods.filter((mod) => mod.mayNeedUpdate && mod.enabled);
  const onCount = mods.filter((mod) => mod.enabled).length;

  async function act(key: string, work: () => Promise<unknown>) {
    setBusy(key);
    try {
      await work();
      await reload();
    } catch (err) {
      setMessage({ tone: "bad", text: errorText(err) });
    }
    setBusy(null);
  }

  async function install(filePath?: string) {
    setBusy(filePath ?? "file");
    setMessage(null);
    try {
      const result = await window.gamesAPI.install(detail.id, filePath);
      if (!result) {
        setBusy(null);
        return;
      }
      if (result.failed) setMessage({ tone: "bad", text: result.failed, notes: result.notes });
      else {
        const skipped = (result.skipped ?? []).map((s) => `Left out ${s.file} (${s.reason})`);
        setMessage({ tone: (result.notes?.length ?? 0) + skipped.length ? "warn" : "good", text: installSummary(result), notes: [...(result.notes ?? []), ...skipped.slice(0, 8)] });
        onInstalled(result);
      }
      await reload();
      if (showDownloads) await loadDownloads();
    } catch (err) {
      setMessage({ tone: "bad", text: errorText(err) });
    }
    setBusy(null);
  }

  /* The ticked downloads, one after another. */
  async function installPicked() {
    const fresh = (downloads ?? []).filter((file) => picked.has(file.path));
    if (!fresh.length) return;
    setMessage(null);
    const done: string[] = [];
    const problems: string[] = [];
    const missing: GameRequirement[] = [];
    for (const [index, file] of fresh.entries()) {
      setBusy(`all:${index + 1}/${fresh.length}`);
      try {
        const result = await window.gamesAPI.install(detail.id, file.path);
        if (!result) continue;
        if (result.failed) problems.push(`${file.name}: ${result.failed}`);
        else {
          done.push(result.mod?.name ?? file.name);
          for (const line of result.notes ?? []) if (!/^Replaced the copy installed before/.test(line)) problems.push(`${result.mod?.name ?? file.name}: ${line}`);
          for (const entry of result.missing ?? []) if (!missing.some((m) => m.key === entry.key)) missing.push(entry);
        }
      } catch (err) {
        problems.push(`${file.name}: ${errorText(err)}`);
      }
    }
    setBusy(null);
    setMessage({
      tone: problems.length ? (done.length ? "warn" : "bad") : "good",
      text: `Installed ${done.length} of ${fresh.length} download${fresh.length === 1 ? "" : "s"}.`,
      notes: problems.slice(0, 12),
    });
    await reload();
    await loadDownloads();
    if (missing.length) onInstalled({ missing }, `Installed ${done.length} of ${fresh.length}.`);
  }

  // Mods a crash report or error log named, matched to the list (by name, plugin, file or folder).
  const namedMods = (names: string[]) => {
    const simple = (text: string) => text.toLowerCase().replace(/\.(esp|esm|esl|dll|asi|reds|lua|ts4script|package)$/i, "").replace(/[^a-z0-9]+/g, "");
    const wanted = names.map(simple).filter((name) => name.length > 2);
    return mods.filter(
      (mod) =>
        mod.enabled &&
        wanted.some((name) => [mod.name, mod.key, mod.where ?? "", ...mod.plugins].map(simple).some((have) => have && (have.includes(name) || (have.length > 3 && name.includes(have)))))
    );
  };

  const sims = detail.id === "sims4" ? detail.simsOptions : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* FINDING A BROKEN MOD */}
      {finder.active && (
        <FinderPanel detail={detail} finder={finder} busy={finderBusy} playing={playing} onPlay={onPlay} onAnswer={finderApi.answer} onStop={finderApi.stop} />
      )}
      {!finder.active && finderIntro && (
        <div style={{ padding: 16, borderRadius: 12, background: "#17141f", border: "1px solid #a855f7" }} data-testid="finder-intro">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Bug size={20} color="#c084fc" />
            <span style={{ fontSize: 16, fontWeight: 600, color: "#e9d5ff" }}>Find the mod that's breaking {detail.name}</span>
          </div>
          <div style={{ fontSize: 13, color: "#d4d4d8", lineHeight: 1.6 }}>
            First every mod is turned off, to check it's a mod at all. Then half of them are turned off at a time: each round, play, try whatever went
            wrong, and say whether it happened. With {mods.filter((m) => m.enabled).length} mods on that's about{" "}
            {Math.ceil(Math.log2(Math.max(mods.filter((m) => m.enabled).length, 2))) + 1} plays. Your saves are backed up first, and stopping at any point
            puts every mod back as it was.
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button className="sidebar-button" data-testid="finder-start" style={{ ...smallButton, background: "#7c3aed", borderColor: "#a78bfa" }} onClick={() => !finderBusy && finderApi.start()}>
              {finderBusy ? "Starting..." : "Start"}
            </button>
            <button className="sidebar-button" style={smallButton} onClick={finderApi.cancelIntro}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div style={{ ...panel, display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, color: "#c084fc", fontSize: 28 }}>{detail.name}</h1>
          <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 6 }}>
            {detail.found ? `Found via ${detail.source}` : "Not found on this computer"}
            {detail.version ? ` • ${/^\d/.test(detail.version) ? `Version ${detail.version}` : detail.version}` : ""}
            {detail.lastPlayed ? ` • Last played from here ${shortDate(detail.lastPlayed)}` : ""}
          </div>
          <div style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>
            {onCount} of {mods.length} mod{mods.length === 1 ? "" : "s"} on
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* The Sims 4's mods are in Documents, so that's the folder it opens; the game's own is in Settings. */}
          {detail.id === "sims4" ? (
            <IconButton
              tip={detail.docsDir ? "Open The Sims 4's folder in Documents: Mods, Tray and saves" : "The Sims 4's Documents folder hasn't been found: choose it in Settings"}
              label="Open The Sims 4's Documents folder"
              disabled={!detail.docsDir}
              onUnavailable={goSettings}
              onClick={() => window.gamesAPI.openFolder(detail.id, "docs").catch((err) => setMessage({ tone: "bad", text: errorText(err) }))}
            >
              <Folder size={20} />
            </IconButton>
          ) : (
            <IconButton
              tip={detail.found ? "Open the game's folder" : "The game's folder hasn't been found: choose it in Settings"}
              label="Open the game's folder"
              disabled={!detail.gameDir}
              onUnavailable={goSettings}
              onClick={() => window.gamesAPI.openFolder(detail.id, "game").catch((err) => setMessage({ tone: "bad", text: errorText(err) }))}
            >
              <Folder size={20} />
            </IconButton>
          )}
          <button
            className="sidebar-button"
            data-testid="game-play"
            onClick={onPlay}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 22px", fontSize: 15, background: "#7c3aed", borderColor: "#a78bfa" }}
          >
            <Play size={18} fill="currentColor" />
            {playing ?? "Play"}
          </button>
        </div>
      </div>

      {/* WHAT NEEDS SAYING */}
      {!detail.found && (
        <div style={{ ...note("warn"), display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1 }}>
            {detail.name} wasn't found on this computer.
            {detail.windowsOnly && detail.platform === "darwin"
              ? " It only runs on Windows: on a Mac, install it in CrossOver or Whisky and the launcher finds it in their bottles."
              : " If it's somewhere unusual, choose its folder."}
          </span>
          <button className="sidebar-button" style={smallButton} onClick={goSettings}>
            Choose folder
          </button>
        </div>
      )}

      {detail.updated && (
        <div style={note("warn")} data-testid="game-updated">
          {detail.name} has updated since you last played it from here
          {detail.updated.from && detail.updated.to ? ` (${detail.updated.from} → ${detail.updated.to})` : ""}.{" "}
          {mayNeedUpdate.length
            ? mayNeedUpdate.length === 1
              ? "1 mod that changes the game's code may need updating before it works again. Play asks whether to start without it."
              : `${mayNeedUpdate.length} mods that change the game's code may need updating before they work again. Play asks whether to start without them.`
            : mods.some((mod) => mod.hooks && mod.enabled)
              ? "The mods that change the game's code are newer than the update, so they should carry on working."
              : mods.some((mod) => mod.hooks)
                ? "The mods that change the game's code are turned off, so the rest should carry on working."
                : "None of your mods change the game's code, so they should carry on working."}
        </div>
      )}

      {sims && (!sims.scripts || !sims.mods) && (
        <div style={{ ...note("info"), display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1 }}>
            {!sims.mods
              ? "Custom content and mods are off in The Sims 4's own options, so none of these load."
              : "Script mods are off in The Sims 4's own options, so .ts4script mods don't load."}
          </span>
          <button
            className="sidebar-button"
            style={smallButton}
            onClick={() => act("options", () => window.gamesAPI.setSimsOptions({ mods: true, scripts: true }))}
          >
            Turn them on
          </button>
        </div>
      )}

      {detail.problems.length > 0 && (
        <div style={note(detail.problems.some((p) => p.kind === "outdated") ? "warn" : "bad")} data-testid="game-problems">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <span style={{ flex: 1 }}>
              {detail.problems.some((p) => p.kind === "crash")
                ? `${detail.name} crashed${detail.problems.length > 1 ? ` (${detail.problems.length} reports)` : ""} since you last played from here.`
                : `${detail.name} reported ${detail.problems.length === 1 ? "a problem" : `${detail.problems.length} problems`} since you last played from here.`}{" "}
              {detail.problems.some((p) => p.mods.length) ? "A mod it names is the likeliest cause." : ""}
            </span>
            {!finder.active && (
              <button className="sidebar-button" style={{ ...smallButton, padding: "6px 12px", fontSize: 12, flexShrink: 0 }} onClick={finderApi.intro}>
                Find the broken mod
              </button>
            )}
          </div>
          {detail.problems.slice(0, 4).map((problem) => {
            const matches = namedMods(problem.mods);
            return (
              <div key={problem.file + problem.time} style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}>
                <div style={{ fontSize: 12, opacity: 0.9 }}>
                  {problem.file} • {shortDate(problem.time)}
                  {problem.mods.length ? ` • names ${problem.mods.join(", ")}` : " • no mod named"}
                </div>
                {problem.line && <div style={{ fontSize: 12, marginTop: 2, fontFamily: "monospace", wordBreak: "break-word", opacity: 0.85 }}>{problem.line}</div>}
                {matches.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                    {matches.slice(0, 4).map((mod) => (
                      <button key={mod.key} className="sidebar-button" style={{ ...smallButton, padding: "6px 10px", fontSize: 12 }} onClick={() => act(mod.key, () => window.gamesAPI.setEnabled(detail.id, mod.key, false))}>
                        Turn off {mod.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {message && (
        <div style={note(message.tone)} data-testid="mods-message">
          <div style={{ display: "flex", gap: 12 }}>
            <span style={{ flex: 1 }}>{message.text}</span>
            <button onClick={() => setMessage(null)} aria-label="Dismiss" style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 16 }}>
              ×
            </button>
          </div>
          {message.notes?.map((line) => (
            <div key={line} style={{ fontSize: 12, marginTop: 4, opacity: 0.9 }}>
              • {line}
            </div>
          ))}
        </div>
      )}

      {/* TOOLBAR */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your mods..."
          style={{ flex: "1 1 220px", padding: 12, borderRadius: 10, background: "#1b1b1b", color: "white", border: "1px solid #6d28d9" }}
        />
        {FILTERS.filter((option) => counts[option.id] !== 0).map((option) => (
          <button
            key={option.id}
            className="sidebar-button"
            onClick={() => setFilter(option.id)}
            style={{ fontSize: 12, padding: "8px 12px", opacity: activeFilter === option.id ? 1 : 0.6, ...(activeFilter === option.id ? { background: "#6d28d9" } : {}) }}
          >
            {option.label}
            {counts[option.id] ? ` (${counts[option.id]})` : ""}
          </button>
        ))}
        <IconButton
          tip={checking ? "Checking for updates..." : "Look again for mods in the game's folders, and check for updates"}
          label="Refresh and check for updates"
          variant={checking ? "ready" : ""}
          onClick={() => act("refresh", async () => {
            await reload();
            await onCheckUpdates();
          })}
        >
          <RefreshIcon size={18} />
        </IconButton>
        <IconButton
          tip={finder.active ? "Already finding a broken mod: see the top of the page" : "Find the mod that's breaking the game, by turning half off at a time"}
          label="Find a broken mod"
          testId="finder-button"
          variant={finder.active || finderIntro ? "ready" : ""}
          onClick={() => !finder.active && finderApi.intro()}
        >
          <Bug size={18} />
        </IconButton>
        <IconButton tip="Install a mod from a file you choose" label="Install from a file" onClick={() => install()}>
          <PlusIcon size={18} />
        </IconButton>
        <button
          className="sidebar-button"
          data-testid="add-from-downloads"
          onClick={() => setShowDownloads((open) => !open)}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", ...(showDownloads ? { background: "#6d28d9" } : {}) }}
        >
          <DownloadIcon size={16} />
          Add from Downloads
        </button>
      </div>

      {/* SETS */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }} data-testid="sets-bar">
        <span style={{ fontSize: 13, color: "#9ca3af" }}>Showing</span>
        <div style={{ width: 230 }}>
          <SearchDropdown
            compact
            label="Show a set"
            placeholder="Search sets..."
            active={Boolean(currentSet)}
            value={currentSet ? currentSet.name : ALL}
            options={[{ value: ALL, label: ALL }, ...sets.map((set) => ({ value: set.name, label: `${set.name} (${set.keys.filter((key) => mods.some((m) => m.key === key)).length})` }))]}
            onChange={(value) => {
              setSetShown(value);
              setNaming(null);
            }}
          />
        </div>
        {naming ? (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const name = naming.name.trim();
              if (!name) return;
              if (naming.id) await setsApi.rename(naming.id, name);
              else if (!(await setsApi.create(name))) return;
              setSetShown(name);
              setNaming(null);
            }}
            style={{ display: "flex", gap: 8 }}
          >
            <input
              autoFocus
              value={naming.name}
              onChange={(event) => setNaming({ ...naming, name: event.target.value })}
              placeholder={naming.id ? "New name..." : "Name the set..."}
              maxLength={40}
              style={{ padding: "8px 10px", borderRadius: 10, background: "#1b1b1b", color: "white", border: "1px solid #6d28d9", fontSize: 13 }}
            />
            <button type="submit" className="sidebar-button" style={{ ...smallButton, padding: "8px 12px" }}>
              {naming.id ? "Rename" : "Make set"}
            </button>
            <button type="button" className="sidebar-button" style={{ ...smallButton, padding: "8px 12px" }} onClick={() => setNaming(null)}>
              Cancel
            </button>
          </form>
        ) : currentSet ? (
          <>
            <button
              className="sidebar-button"
              data-testid="use-set"
              style={{ ...smallButton, padding: "8px 12px", ...(confirming === `use:${currentSet.id}` ? { background: "#7f1d1d", borderColor: "#ef4444" } : {}) }}
              onClick={() => {
                if (confirming !== `use:${currentSet.id}`) return setConfirming(`use:${currentSet.id}`);
                setConfirming(null);
                setsApi.use(currentSet);
              }}
            >
              {confirming === `use:${currentSet.id}` ? "Click again: the rest go off" : "Turn on just this set"}
            </button>
            <button className="sidebar-button" style={{ ...smallButton, padding: "8px 12px" }} onClick={() => setNaming({ id: currentSet.id, name: currentSet.name })}>
              Rename
            </button>
            <IconButton
              tip={confirming === `set:${currentSet.id}` ? "Click again to delete the set (its mods stay)" : "Delete this set (its mods stay)"}
              label={`Delete the ${currentSet.name} set`}
              variant={confirming === `set:${currentSet.id}` ? "confirming" : ""}
              style={{ width: 38, height: 38 }}
              onClick={() => {
                if (confirming !== `set:${currentSet.id}`) return setConfirming(`set:${currentSet.id}`);
                setConfirming(null);
                setsApi.remove(currentSet.id);
                setSetShown(ALL);
              }}
            >
              <BinIcon size={16} />
            </IconButton>
          </>
        ) : (
          <button className="sidebar-button" data-testid="new-set" style={{ ...smallButton, padding: "8px 12px" }} onClick={() => setNaming({ id: null, name: "" })}>
            New set
          </button>
        )}
        {currentSet && !currentSet.keys.some((key) => mods.some((m) => m.key === key)) && (
          <span style={{ fontSize: 12, color: "#6b7280" }}>Add mods to it with the tag button on each one.</span>
        )}
      </div>

      <LoadOrderNotice detail={detail} mods={mods} goLoadOrder={goLoadOrder} onGetRequirements={onGetRequirements} />

      <HealthPanel detail={detail} mods={mods} reload={reload} />

      <ConflictsPanel detail={detail} mods={mods} />

      <ClashesPanel detail={detail} mods={mods} reload={reload} />

      <RequirementsPanel requirements={requirements} getting={getting} onGet={onGetRequirements} />

      {/* UPDATES */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 36 }} data-testid="updates-line">
        <span style={{ flex: 1, fontSize: 13, color: updates?.error ? "#fca5a5" : newer.size ? "#86efac" : "#9ca3af" }}>
          {!updates || (checking && !newer.size)
            ? "Checking for updates..."
            : updates.error
              ? `Couldn't check for updates: ${updates.error}`
              : newer.size
                ? `${newer.size} mod${newer.size === 1 ? " has a newer version" : "s have newer versions"}.`
                : updates.checked
                  ? `All ${updates.checked} mod${updates.checked === 1 ? "" : "s"} from Nexus Mods and CurseForge ${updates.checked === 1 ? "is" : "are"} up to date.`
                  : "No mods from Nexus Mods or CurseForge to check for updates yet."}
          {updates && updates.needsKey > 0 && (
            <>
              {" "}
              {updates.needsKey} from Nexus Mods can be checked once your Nexus Mods key is in{" "}
              <button onClick={goLauncherSettings} style={{ background: "none", border: "none", padding: 0, color: "#c084fc", cursor: "pointer", font: "inherit", textDecoration: "underline" }}>
                Settings → API keys
              </button>
              .
            </>
          )}
          {updates && updates.unknown > 0 && !updates.error && (
            <span style={{ color: "#6b7280" }}>
              {" "}
              {updates.unknown} couldn't be matched to a site.
            </span>
          )}
        </span>
        {newer.size > 0 && (
          <button
            className="sidebar-button"
            data-testid="update-all"
            style={{ ...smallButton, background: "#7c3aed", borderColor: "#a78bfa" }}
            onClick={() => {
              if (!updating) onUpdateAll();
            }}
          >
            {updating?.startsWith("all:") ? `Updating ${updating.slice(4)}...` : `Update all (${newer.size})`}
          </button>
        )}
      </div>

      {/* DOWNLOADS */}
      {showDownloads && (
        <div style={panel} data-testid="downloads-panel">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
            <div style={{ color: "#c084fc", fontWeight: 600, flex: 1 }}>From your Downloads folder</div>
            {picked.size > 0 && (
              <button
                className="sidebar-button"
                data-testid="install-picked"
                style={{ ...smallButton, background: "#7c3aed", borderColor: "#a78bfa" }}
                onClick={() => {
                  if (!busy) installPicked();
                }}
              >
                {busy?.startsWith("all:") ? `Installing ${busy.slice(4)}...` : `Install ticked (${picked.size})`}
              </button>
            )}
          </div>
          <div style={{ color: "#9ca3af", fontSize: 12, marginBottom: 10 }}>
            Zips, 7z and RAR archives are unpacked and each file goes where {detail.name} needs it. Newest first, from the last 90 days; new ones that
            look like {detail.name} mods are ticked.
          </div>
          {downloads === null ? (
            <div style={{ color: "#9ca3af" }}>Looking...</div>
          ) : downloads.length === 0 ? (
            <div style={{ color: "#9ca3af" }}>Nothing in Downloads looks like a mod for {detail.name}.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
              {downloads.map((file) => (
                <div key={file.path} data-testid="download-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", background: "#1b1b1b", borderRadius: 8, opacity: file.fits === false ? 0.6 : 1 }}>
                  <input
                    type="checkbox"
                    aria-label={`Tick ${file.name} to install`}
                    checked={picked.has(file.path)}
                    onChange={(event) =>
                      setPicked((now) => {
                        const next = new Set(now);
                        if (event.target.checked) next.add(file.path);
                        else next.delete(file.path);
                        return next;
                      })
                    }
                    style={{ width: 16, height: 16, accentColor: "#7c3aed", flexShrink: 0, cursor: "pointer" }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
                    <div style={{ color: "#6b7280", fontSize: 11 }}>
                      {sizeText(file.size)} • {shortDate(file.modified)}
                      {file.installed ? " • installed" : ""}
                      {file.fits === false ? ` • doesn't look like a ${detail.name} mod` : ""}
                    </div>
                  </div>
                  <button className="sidebar-button" style={{ ...smallButton, ...(file.installed ? {} : { background: "#7c3aed", borderColor: "#a78bfa" }) }} onClick={() => install(file.path)}>
                    {busy === file.path ? "Installing..." : file.installed ? "Reinstall" : "Install"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* LIST */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="mod-list">
        {shown.length === 0 ? (
          <div style={{ color: "#9ca3af", padding: 20, textAlign: "center" }}>
            {mods.length === 0
              ? detail.found
                ? "No mods yet. Add one from Downloads, or find some in Discover Mods."
                : "Once the game's found, its mods show here."
              : "No mods match."}
          </div>
        ) : (
          shown.map((mod) => (
            <div
              key={mod.key}
              data-testid="game-mod"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "12px 14px",
                background: "rgba(27, 27, 27, 0.9)",
                border: `1px solid ${mod.mayNeedUpdate && mod.enabled ? "#b45309" : "#2e2e2e"}`,
                borderRadius: 10,
                opacity: mod.enabled ? 1 : 0.65,
              }}
            >
              <Toggle
                on={mod.enabled}
                label={mod.enabled ? `Turn off ${mod.name}` : `Turn on ${mod.name}`}
                disabled={busy === mod.key}
                onChange={(on) => act(mod.key, () => window.gamesAPI.setEnabled(detail.id, mod.key, on))}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, color: mod.enabled ? "#e9d5ff" : "#a1a1aa" }}>{mod.name}</span>
                  {mod.mayNeedUpdate && (
                    <span data-tip="It changes the game's code and is older than the game's latest update" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "#78350f", color: "#fde68a" }}>
                      May need updating
                    </span>
                  )}
                  {mod.hooks && !mod.mayNeedUpdate && (
                    <span data-tip="It changes the game's code, so game updates can break it" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "#2e1065", color: "#d8b4fe" }}>
                      Script mod
                    </span>
                  )}
                  {mod.kind === "plugin" && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "#1e293b", color: "#93c5fd" }}>Plugin</span>}
                  {sets
                    .filter((set) => set.keys.includes(mod.key))
                    .map((set) => (
                      <span key={set.id} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, border: "1px solid #4c1d95", color: "#c4b5fd" }}>
                        {set.name}
                      </span>
                    ))}
                  {newer.has(mod.key) && (
                    <span data-testid="update-badge" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "#14532d", color: "#bbf7d0" }}>
                      Update{newer.get(mod.key)!.fromVersion || newer.get(mod.key)!.toVersion ? `: ${newer.get(mod.key)!.fromVersion || "?"} → ${newer.get(mod.key)!.toVersion || "newer"}` : " available"}
                    </span>
                  )}
                </div>
                <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 3 }}>
                  {mod.managed
                    ? [
                        PROVIDERS[mod.source?.provider ?? "file"] ?? mod.source?.provider,
                        mod.version ? `version ${mod.version}` : "",
                        mod.areas.map((a) => `${a.count} in ${a.area}`).join(", "),
                        mod.plugins.length ? `plugins: ${mod.plugins.join(", ")}` : "",
                        mod.installedAt ? `installed ${shortDate(mod.installedAt)}` : "",
                      ]
                        .filter(Boolean)
                        .join(" • ")
                    : [`In ${mod.where}`, PROVIDERS.hand, mod.since ? `changed ${shortDate(mod.since)}` : ""].filter(Boolean).join(" • ")}
                </div>
                {mod.notes.slice(0, 2).map((line) => (
                  <div key={line} style={{ color: "#fcd34d", fontSize: 11, marginTop: 2 }}>
                    {line}
                  </div>
                ))}
              </div>
              <SetMenu
                mod={mod}
                sets={sets}
                onMember={(setId, member) => setsApi.member(setId, mod.key, member)}
                onCreate={async (name) => {
                  await setsApi.create(name, mod.key);
                }}
              />
              {newer.has(mod.key) && (
                <IconButton
                  tip={
                    updating === mod.key
                      ? "Updating..."
                      : newer.get(mod.key)!.website
                        ? "Its author only allows downloads from CurseForge's website"
                        : `Update to ${newer.get(mod.key)!.toVersion || newer.get(mod.key)!.toName}`
                  }
                  label={`Update ${mod.name}`}
                  testId="update-mod"
                  variant={updating === mod.key ? "ready" : ""}
                  onClick={() => {
                    if (!updating) onUpdate(newer.get(mod.key)!);
                  }}
                >
                  <DownloadIcon size={18} />
                </IconButton>
              )}
              {mod.canUndo && (
                <IconButton tip="Undo the update: put back the copy from before" label={`Undo the update to ${mod.name}`} testId="undo-update" onClick={() => onUndo(mod)}>
                  <ResetIcon size={18} />
                </IconButton>
              )}
              <IconButton
                tip={confirming === mod.key ? "Click again to delete it" : mod.managed ? "Delete this mod (what it replaced comes back)" : "Delete this from the game's folders"}
                label={`Delete ${mod.name}`}
                variant={confirming === mod.key ? "confirming" : ""}
                onClick={() => {
                  if (confirming !== mod.key) {
                    setConfirming(mod.key);
                    return;
                  }
                  setConfirming(null);
                  act(mod.key, () => window.gamesAPI.remove(detail.id, mod.key));
                }}
              >
                <BinIcon size={18} />
              </IconButton>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
