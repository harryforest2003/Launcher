import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bug, ChevronDown, ClipboardPaste, Folder, ListFilter, MoreHorizontal, Play, Power, Share2, Trash2, TriangleAlert, Undo2, Download, Plus, RefreshCw, FileUp, Ellipsis, X, Pin, PinOff } from "lucide-react";
import { onModSearchRequest } from "../../utils/launchRequests";
import SearchDropdown from "../../components/SearchDropdown";
import FinderPanel from "./FinderPanel";
import LoadOrderNotice from "./LoadOrderNotice";
import HealthPanel from "./HealthPanel";
import ConflictsPanel from "./ConflictsPanel";
import ClashesPanel from "./ClashesPanel";
import RequirementsPanel from "./RequirementsPanel";
import SetMenu from "./SetMenu";
import GameSharePanel from "./GameSharePanel";
import ProfileMenu, { ProfileBar } from "./ProfileMenu";
import useGameProfiles, { type ProfileForm } from "./useGameProfiles";
import ModNameCell from "./ModNameCell";
import { Badge, Button, Menu, Notice, SearchField } from "../../components/ui";
import type { Tone } from "../../components/ui";
import Toggle from "../../components/Toggle";
import { errorText, installSummary, shortDate, sizeText, type IssueTone } from "./shared";
import "./gameMods.css";

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
type SortKey = "name" | "where" | "added";

// Rows drawn at first, and added each time the end of the list scrolls near: a list of
// thousands of mods opens at once and scrolls smoothly.
const PAGE = 120;
const DENSE_KEY = "unity-mods-dense";

const whereOf = (mod: GameMod) => (mod.areas.length ? mod.areas.map((a) => a.area).join(", ") : (mod.where ?? "Game folder"));

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "on", label: "On" },
  { id: "off", label: "Off" },
  // These two show only when a mod has one.
  { id: "newer", label: "Update available" },
  { id: "update", label: "May need updating" },
];

/*
 * A game's mods: each one on or off, what it is and where its files went, the ones that
 * may need updating after a game update, and adding more from Downloads.
 */
export default function GameMods({
  detail,
  mods: allMods,
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
  const [message, setMessage] = useState<{ tone: "good" | "bad" | "warn"; text: string; notes?: string[] } | null>(null);
  // Mod profiles: only the chosen one's mods are listed, as only they're in the game's folder.
  const profileApi = useGameProfiles(detail.id, allMods, reload, setMessage);
  const [profileForm, setProfileForm] = useState<ProfileForm | null>(null);
  const mods = useMemo(() => (profileApi.hidden.size ? allMods.filter((mod) => !profileApi.hidden.has(mod.key)) : allMods), [allMods, profileApi.hidden]);
  // A set shown on its own ("All mods" for every one), and naming a new set or renaming one.
  const [setShown, setSetShown] = useState(ALL);
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null);
  const currentSet = sets.find((set) => set.name === setShown) ?? null;
  // Updates for mods kept at their version aren't offered, only named on the Kept badge.
  const allNewer = useMemo(() => new Map((updates?.updates ?? []).map((one) => [one.key, one])), [updates]);
  const newer = useMemo(() => {
    const kept = new Set(mods.filter((mod) => mod.kept).map((mod) => mod.key));
    return new Map([...allNewer].filter(([key]) => !kept.has(key)));
  }, [allNewer, mods]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // The search palette opens this page on one mod: search for it with nothing else filtering.
  useEffect(
    () =>
      onModSearchRequest(detail.id, (text) => {
        setFilter("all");
        setQuery(text);
      }),
    [detail.id]
  );
  const [sharing, setSharing] = useState<"make" | "paste" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
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

  // Sorted by a column's header (first press A to Z or newest first, second press reverses),
  // or as the game lists them until one is pressed.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return shown;
    const value = (mod: GameMod) => (sort.key === "name" ? mod.name : sort.key === "where" ? whereOf(mod) : (mod.installedAt ?? ""));
    return [...shown].sort((a, b) => value(a).localeCompare(value(b), undefined, { sensitivity: "base", numeric: true }) * sort.dir || a.name.localeCompare(b.name));
  }, [shown, sort]);
  const sortBy = (key: SortKey) =>
    setSort((now) => (now?.key === key ? (now.dir === (key === "added" ? -1 : 1) ? { key, dir: now.dir === 1 ? -1 : 1 } : null) : { key, dir: key === "added" ? -1 : 1 }));
  const ariaSort = (key: SortKey) => (sort?.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none");

  // Compact rows, remembered.
  const [dense, setDense] = useState(() => {
    try {
      return localStorage.getItem(DENSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleDense = () =>
    setDense((now) => {
      try {
        localStorage.setItem(DENSE_KEY, now ? "0" : "1");
      } catch {
        // Not remembered this time.
      }
      return !now;
    });

  // How many rows are drawn: more as the end comes near; back to the first page when the list changes.
  const listKey = `${query}|${activeFilter}|${sort?.key}|${sort?.dir}|${currentSet?.name ?? ""}`;
  const [paging, setPaging] = useState({ key: listKey, limit: PAGE });
  const limit = paging.key === listKey ? paging.limit : PAGE;
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const end = more.current;
    if (!end || limit >= sorted.length) return;
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setPaging({ key: listKey, limit: limit + PAGE });
    }, { rootMargin: "800px 0px" });
    watch.observe(end);
    return () => watch.disconnect();
  }, [limit, sorted.length, listKey]);

  // Ticked mods, for turning many on or off at once.
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const tickedHere = sorted.filter((mod) => ticked.has(mod.key));
  const allTicked = sorted.length > 0 && tickedHere.length === sorted.length;
  const tick = (key: string, on: boolean) =>
    setTicked((now) => {
      const next = new Set(now);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const [bulkBusy, setBulkBusy] = useState(false);
  async function setTickedEnabled(on: boolean) {
    const change = tickedHere.filter((mod) => mod.enabled !== on);
    if (!change.length) return;
    setBulkBusy(true);
    let failed = 0;
    for (const mod of change) {
      try {
        await window.gamesAPI.setEnabled(detail.id, mod.key, on);
      } catch {
        failed += 1;
      }
    }
    await reload();
    setBulkBusy(false);
    setMessage(
      failed
        ? { tone: "bad", text: `${change.length - failed} of ${change.length} mods turned ${on ? "on" : "off"}; ${failed} couldn't be changed.` }
        : { tone: "good", text: `Turned ${on ? "on" : "off"} ${change.length} mod${change.length === 1 ? "" : "s"}.` }
    );
  }

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
  const simsOff = Boolean(sims && (!sims.scripts || !sims.mods));

  // What the panels below found, for the issues strip.
  const [found, setFound] = useState<Record<string, { count: number; tone: IssueTone }>>({});
  const [issuesOpen, setIssuesOpen] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!issuesOpen) return;
    const away = (event: PointerEvent) => {
      if (!strip.current?.contains(event.target as Node)) setIssuesOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIssuesOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [issuesOpen]);
  const report = useCallback((kind: string, count: number, tone: IssueTone) => {
    setFound((now) => {
      const had = now[kind];
      if (!count) {
        if (!had) return now;
        const next = { ...now };
        delete next[kind];
        return next;
      }
      return had && had.count === count && had.tone === tone ? now : { ...now, [kind]: { count, tone } };
    });
  }, []);
  const say = useCallback((next: { tone: "good" | "bad" | "warn"; text: string; notes?: string[] }) => setMessage(next), []);

  const gameCount = (detail.found ? 0 : 1) + (detail.cantRun ? 1 : 0) + (detail.updated ? 1 : 0) + (simsOff ? 1 : 0);
  const problemsTone: IssueTone = detail.problems.some((p) => p.kind === "outdated") ? "warning" : "danger";
  const chips: { kind: string; count: number; tone: IssueTone }[] = [
    ...(detail.problems.length ? [{ kind: "Crashes", count: detail.problems.length, tone: problemsTone }] : []),
    ...(gameCount ? [{ kind: "Game", count: gameCount, tone: "warning" as IssueTone }] : []),
    ...["Load order", "Health", "Same files", "Clashes", "Missing"].filter((kind) => found[kind]).map((kind) => ({ kind, count: found[kind].count, tone: found[kind].tone })),
  ];
  const issueTotal = chips.reduce((sum, chip) => sum + chip.count, 0);
  const worst: IssueTone = chips.some((c) => c.tone === "danger") ? "danger" : chips.some((c) => c.tone === "warning") ? "warning" : "info";
  const badgeTone: Record<IssueTone, Tone> = { danger: "danger", warning: "warning", info: "info" };

  const folderUnavailable = detail.id === "sims4" ? !detail.docsDir : !detail.gameDir;
  const folderLabel = detail.id === "sims4" ? "Open The Sims 4's Documents folder" : "Open the game's folder";

  const updateText =
    !updates || (checking && !newer.size)
      ? "Checking for updates..."
      : updates.error
        ? `Couldn't check for updates: ${updates.error}`
        : newer.size
          ? `${newer.size} mod${newer.size === 1 ? " has a newer version" : "s have newer versions"}.`
          : updates.checked
            ? `All ${updates.checked} mod${updates.checked === 1 ? "" : "s"} from Nexus Mods and CurseForge ${updates.checked === 1 ? "is" : "are"} up to date.`
            : "No mods from Nexus Mods or CurseForge to check for updates yet.";

  const headerTip = [
    detail.found ? `Found via ${detail.source}` : "Not found on this computer",
    detail.version ? (/^\d/.test(detail.version) ? `Version ${detail.version}` : detail.version) : "",
    detail.lastPlayed ? `Last played from here ${shortDate(detail.lastPlayed)}` : "",
  ]
    .filter(Boolean)
    .join(" • ");
  const filterLabel = FILTERS.find((option) => option.id === activeFilter)?.label ?? "All";
  const confirmUse = currentSet ? confirming === `use:${currentSet.id}` : false;

  return (
    <div className="gm-page">
      {/* FINDING A BROKEN MOD */}
      {finder.active && (
        <FinderPanel detail={detail} finder={finder} busy={finderBusy} playing={playing} onPlay={onPlay} onAnswer={finderApi.answer} onStop={finderApi.stop} />
      )}
      {!finder.active && finderIntro && (
        <div className="gm-finder" data-testid="finder-intro">
          <div className="gm-finder__head">
            <Bug size={18} aria-hidden="true" />
            <span className="gm-finder__title">Find the mod that's breaking {detail.name}</span>
          </div>
          <div className="gm-finder__text">
            First every mod is turned off, to check it's a mod at all. Then half of them are turned off at a time: each round, play, try whatever went
            wrong, and say whether it happened. With {onCount} mods on that's about {Math.ceil(Math.log2(Math.max(onCount, 2))) + 1} plays. Your saves are backed up
            first, and stopping at any point puts every mod back as it was.
          </div>
          <div className="gm-finder__buttons">
            <Button variant="primary" data-testid="finder-start" onClick={() => !finderBusy && finderApi.start()}>
              {finderBusy ? "Starting..." : "Start"}
            </Button>
            <Button onClick={finderApi.cancelIntro}>Cancel</Button>
          </div>
        </div>
      )}

      {/* HEADER: title and count, the issues chip, Play, the one primary action and a menu for the rest */}
      <header className="gm-header">
        <div className="gm-header__main" title={headerTip}>
          <h1 className="gm-header__title">{detail.name}</h1>
          <div className="gm-header__meta">
            {onCount} of {mods.length} mod{mods.length === 1 ? "" : "s"} on
          </div>
        </div>
        <ProfileMenu api={profileApi} onForm={setProfileForm} />
        {/* ISSUES: a small chip; the details open over the list */}
        <div ref={strip} className={`gm-strip gm-strip--${worst}`} data-testid="issues-strip" hidden={issueTotal === 0}>
          <button type="button" className="gm-strip__bar" aria-expanded={issuesOpen} aria-controls="gm-strip-body" onClick={() => setIssuesOpen((now) => !now)}>
            <TriangleAlert size={14} className="gm-strip__icon" aria-hidden="true" />
            <strong className="gm-strip__count">
              {issueTotal} issue{issueTotal === 1 ? "" : "s"}
            </strong>
            <ChevronDown size={14} className={`gm-strip__chev${issuesOpen ? " gm-strip__chev--open" : ""}`} aria-hidden="true" />
          </button>
          <div id="gm-strip-body" className="gm-strip__body" hidden={!issuesOpen}>
            <div className="gm-strip__chips">
              {chips.map((chip) => (
                <Badge key={chip.kind} tone={badgeTone[chip.tone]}>
                  {chip.kind} {chip.count}
                </Badge>
              ))}
            </div>
          {!detail.found && (
            <section className="gm-issue gm-issue--warning">
              <div className="gm-issue__head">
                <TriangleAlert size={16} className="gm-issue__icon" aria-hidden="true" />
                <span className="gm-issue__text">
                  {detail.name} wasn't found on this computer.
                  {detail.windowsOnly && detail.platform === "darwin"
                    ? " It only runs on Windows: on a Mac, install it in CrossOver or Whisky and the launcher finds it in their bottles."
                    : " If it's somewhere unusual, choose its folder."}
                </span>
                <div className="gm-issue__actions">
                  <Button size="sm" onClick={goSettings}>
                    Choose folder
                  </Button>
                </div>
              </div>
            </section>
          )}

          {detail.cantRun && (
            <section className="gm-issue gm-issue--warning" data-testid="game-cant-run">
              <div className="gm-issue__head">
                <TriangleAlert size={16} className="gm-issue__icon" aria-hidden="true" />
                <span className="gm-issue__text">{detail.cantRun} You can still install and manage its mods here.</span>
              </div>
            </section>
          )}

          {detail.updated && (
            <section className="gm-issue gm-issue--warning" data-testid="game-updated">
              <div className="gm-issue__head">
                <TriangleAlert size={16} className="gm-issue__icon" aria-hidden="true" />
                <span className="gm-issue__text">
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
                </span>
              </div>
            </section>
          )}

          {sims && simsOff && (
            <section className="gm-issue gm-issue--info">
              <div className="gm-issue__head">
                <TriangleAlert size={16} className="gm-issue__icon" aria-hidden="true" />
                <span className="gm-issue__text">
                  {!sims.mods
                    ? "Custom content and mods are off in The Sims 4's own options, so none of these load."
                    : "Script mods are off in The Sims 4's own options, so .ts4script mods don't load."}
                </span>
                <div className="gm-issue__actions">
                  <Button size="sm" onClick={() => act("options", () => window.gamesAPI.setSimsOptions({ mods: true, scripts: true }))}>
                    Turn them on
                  </Button>
                </div>
              </div>
            </section>
          )}

          {detail.problems.length > 0 && (
            <section className={`gm-issue gm-issue--${problemsTone}`} data-testid="game-problems">
              <div className="gm-issue__head">
                <TriangleAlert size={16} className="gm-issue__icon" aria-hidden="true" />
                <span className="gm-issue__text">
                  {detail.problems.some((p) => p.kind === "crash")
                    ? `${detail.name} crashed${detail.problems.length > 1 ? ` (${detail.problems.length} reports)` : ""} since you last played from here.`
                    : `${detail.name} reported ${detail.problems.length === 1 ? "a problem" : `${detail.problems.length} problems`} since you last played from here.`}{" "}
                  {detail.problems.some((p) => p.mods.length) ? "A mod it names is the likeliest cause." : ""}
                </span>
                {!finder.active && (
                  <div className="gm-issue__actions">
                    <Button size="sm" onClick={finderApi.intro}>
                      Find the broken mod
                    </Button>
                  </div>
                )}
              </div>
              <div className="gm-issue__list">
                {detail.problems.slice(0, 4).map((problem) => {
                  const matches = namedMods(problem.mods);
                  return (
                    <div key={problem.file + problem.time} className="gm-issue__item">
                      <div className="gm-issue__item-text">
                        {problem.file} • {shortDate(problem.time)}
                        {problem.mods.length ? ` • names ${problem.mods.join(", ")}` : " • no mod named"}
                      </div>
                      {problem.line && <div className="gm-issue__files gm-issue__files--inline">{problem.line}</div>}
                      {matches.length > 0 && (
                        <div className="gm-issue__buttons">
                          {matches.slice(0, 4).map((mod) => (
                            <Button key={mod.key} size="sm" onClick={() => act(mod.key, () => window.gamesAPI.setEnabled(detail.id, mod.key, false))}>
                              Turn off {mod.name}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <LoadOrderNotice detail={detail} mods={mods} goLoadOrder={goLoadOrder} onGetRequirements={onGetRequirements} report={report} say={say} />
          <HealthPanel detail={detail} mods={mods} reload={reload} report={report} say={say} />
          <ConflictsPanel detail={detail} mods={mods} report={report} />
          <ClashesPanel detail={detail} mods={mods} reload={reload} report={report} say={say} />
          <RequirementsPanel requirements={requirements} getting={getting} onGet={onGetRequirements} report={report} />
          </div>
        </div>
        {/* UPDATES: a compact chip, with Update all when there is something to update */}
        <div className={`gm-updates${updates?.error ? " gm-updates--bad" : newer.size ? " gm-updates--good" : ""}`} data-testid="updates-line" title={updateText}>
          <span className="gm-updates__text">
            {!updates || (checking && !newer.size)
              ? "Checking..."
              : updates.error
                ? "Update check failed"
                : newer.size
                  ? `${newer.size} update${newer.size === 1 ? "" : "s"}`
                  : updates.checked
                    ? "Up to date"
                    : "No updates to check"}
            {updates && updates.needsKey > 0 && (
              <>
                {" "}
                <button type="button" className="gm-link" title={`${updates.needsKey} from Nexus Mods can be checked once your Nexus Mods key is in Settings → API keys`} onClick={goLauncherSettings}>
                  Add key
                </button>
              </>
            )}
          </span>
          {newer.size > 0 && (
            <Button
              size="sm"
              variant="secondary"
              data-testid="update-all"
              onClick={() => {
                if (!updating) onUpdateAll();
              }}
            >
              {updating?.startsWith("all:") ? `Updating ${updating.slice(4)}...` : `Update all (${newer.size})`}
            </Button>
          )}
        </div>
        <span className="gm-spacer" />
        <Button
          variant="secondary"
          size="sm"
          data-testid="game-play"
          onClick={onPlay}
          disabled={Boolean(playing) || Boolean(detail.cantRun)}
          title={detail.cantRun ?? undefined}
          icon={<Play size={14} aria-hidden="true" />}
        >
          {playing ?? "Play"}
        </Button>
        <Button
          size="sm"
          variant={showDownloads ? "secondary" : "primary"}
          data-testid="add-from-downloads"
          aria-expanded={showDownloads}
          aria-label="Add from Downloads"
          icon={<Download size={14} aria-hidden="true" />}
          onClick={() => setShowDownloads((open) => !open)}
        >
          <span className="gm-long">Add from Downloads</span>
          <span className="gm-short">Add</span>
        </Button>
        <Menu
          label="More actions"
          triggerClassName="ui-button ui-button--ghost ui-button--sm gm-iconbtn"
          trigger={<Ellipsis size={16} aria-hidden="true" />}
          items={[
            { label: "Install from a file...", icon: <FileUp size={14} aria-hidden="true" />, onSelect: () => install() },
            { label: "Share this mod list", icon: <Share2 size={14} aria-hidden="true" />, onSelect: () => setSharing("make") },
            { label: "Install a shared list...", icon: <ClipboardPaste size={14} aria-hidden="true" />, onSelect: () => setSharing("paste") },
            {
              label: checking ? "Checking for updates..." : "Check for updates",
              icon: <RefreshCw size={14} aria-hidden="true" />,
              disabled: checking,
              onSelect: () =>
                act("refresh", async () => {
                  await reload();
                  await onCheckUpdates();
                }),
            },
            {
              label: folderUnavailable ? `${folderLabel} (not found: choose it in Settings)` : folderLabel,
              icon: <Folder size={14} aria-hidden="true" />,
              onSelect: () => {
                if (folderUnavailable) return goSettings();
                window.gamesAPI.openFolder(detail.id, detail.id === "sims4" ? "docs" : "game").catch((err) => setMessage({ tone: "bad", text: errorText(err) }));
              },
            },
          ]}
        />
      </header>

      {profileForm && <ProfileBar api={profileApi} form={profileForm} setForm={setProfileForm} />}

      {/* TOAST-LIKE RESULT OF THE LAST ACTION */}
      {message && (
        <Notice
          tone={message.tone === "good" ? "success" : message.tone === "bad" ? "danger" : "warning"}
          data-testid="mods-message"
          actions={
            <Button variant="ghost" size="sm" className="gm-iconbtn" aria-label="Dismiss" icon={<X size={16} aria-hidden="true" />} onClick={() => setMessage(null)} />
          }
        >
          {message.text}
          {message.notes?.map((line) => (
            <div key={line} className="gm-notice-note">
              • {line}
            </div>
          ))}
        </Notice>
      )}

      {/* TOOLBAR: search, filter, sets, and the add and refresh actions on one row */}
      <div className="gm-toolbar" data-testid="sets-bar">
        <SearchField label="Search your mods" wrapperClassName="gm-toolbar__search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
        <Menu
          label="Filter mods"
          triggerClassName="ui-button ui-button--secondary ui-button--sm gm-filter"
          trigger={
            <>
              <ListFilter size={14} aria-hidden="true" />
              {filterLabel}
              <ChevronDown size={14} aria-hidden="true" />
            </>
          }
          items={FILTERS.filter((option) => counts[option.id] !== 0).map((option) => ({
            label: `${activeFilter === option.id ? "✓ " : ""}${option.label}${counts[option.id] ? ` (${counts[option.id]})` : ""}`,
            onSelect: () => setFilter(option.id),
          }))}
        />
        <div className="gm-toolbar__sets">
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
        {!currentSet && !naming && (
          <Button
            size="sm"
            variant="ghost"
            className="gm-iconbtn"
            data-testid="new-set"
            data-tip="Make a new set of mods"
            aria-label="New set"
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={() => setNaming({ id: null, name: "" })}
          />
        )}
        <span className="gm-spacer" />
        <Button
          size="sm"
          variant="ghost"
          className={`gm-iconbtn${finder.active || finderIntro ? " gm-iconbtn--on" : ""}`}
          data-testid="finder-button"
          data-tip={finder.active ? "Already finding a broken mod: see the top of the page" : "Find the mod that's breaking the game, by turning half off at a time"}
          aria-label="Find a broken mod"
          icon={<Bug size={16} aria-hidden="true" />}
          onClick={() => !finder.active && finderApi.intro()}
        />
      </div>

      {/* A set's own actions, only while one is shown or being named */}
      {(naming || currentSet) && (
        <div className="gm-setbar">
          {naming ? (
            <form
              className="gm-setbar__form"
              onSubmit={async (event) => {
                event.preventDefault();
                const name = naming.name.trim();
                if (!name) return;
                if (naming.id) await setsApi.rename(naming.id, name);
                else if (!(await setsApi.create(name))) return;
                setSetShown(name);
                setNaming(null);
              }}
            >
              <input
                autoFocus
                className="ui-input"
                value={naming.name}
                onChange={(event) => setNaming({ ...naming, name: event.target.value })}
                placeholder={naming.id ? "New name..." : "Name the set..."}
                aria-label={naming.id ? "New name for the set" : "Name for the new set"}
                maxLength={40}
              />
              <Button type="submit" size="sm" variant="primary">
                {naming.id ? "Rename" : "Make set"}
              </Button>
              <Button size="sm" onClick={() => setNaming(null)}>
                Cancel
              </Button>
            </form>
          ) : (
            currentSet && (
              <>
                <span className="gm-muted">Set: {currentSet.name}</span>
                <Button
                  size="sm"
                  variant={confirmUse ? "danger" : "secondary"}
                  data-testid="use-set"
                  onClick={() => {
                    if (!confirmUse) return setConfirming(`use:${currentSet.id}`);
                    setConfirming(null);
                    setsApi.use(currentSet);
                  }}
                >
                  {confirmUse ? "Click again: the rest go off" : "Turn on just this set"}
                </Button>
                <Button size="sm" onClick={() => setNaming({ id: currentSet.id, name: currentSet.name })}>
                  Rename
                </Button>
                <Button
                  size="sm"
                  variant={confirming === `set:${currentSet.id}` ? "danger" : "ghost"}
                  className="gm-iconbtn"
                  data-tip={confirming === `set:${currentSet.id}` ? "Click again to delete the set (its mods stay)" : "Delete this set (its mods stay)"}
                  aria-label={`Delete the ${currentSet.name} set`}
                  icon={<Trash2 size={16} aria-hidden="true" />}
                  onClick={() => {
                    if (confirming !== `set:${currentSet.id}`) return setConfirming(`set:${currentSet.id}`);
                    setConfirming(null);
                    setsApi.remove(currentSet.id);
                    setSetShown(ALL);
                  }}
                />
                {!currentSet.keys.some((key) => mods.some((m) => m.key === key)) && <span className="gm-muted">Add mods to it with the tag button on each one.</span>}
              </>
            )
          )}
        </div>
      )}

      {/* DOWNLOADS */}
      {sharing && <GameSharePanel key={sharing} detail={detail} mode={sharing} onClose={() => setSharing(null)} reload={reload} onInstalled={onInstalled} />}

      {showDownloads && (
        <section className="gm-downloads" data-testid="downloads-panel">
          <div className="gm-downloads__head">
            <div className="gm-downloads__title">From your Downloads folder</div>
            {picked.size > 0 && (
              <Button
                size="sm"
                variant="primary"
                data-testid="install-picked"
                onClick={() => {
                  if (!busy) installPicked();
                }}
              >
                {busy?.startsWith("all:") ? `Installing ${busy.slice(4)}...` : `Install ticked (${picked.size})`}
              </Button>
            )}
          </div>
          <div className="gm-muted gm-downloads__hint">
            Zips, 7z and RAR archives are unpacked and each file goes where {detail.name} needs it. Newest first, from the last 90 days; new ones that
            look like {detail.name} mods are ticked.
          </div>
          {downloads === null ? (
            <div className="gm-muted">Looking...</div>
          ) : downloads.length === 0 ? (
            <div className="gm-muted">Nothing in Downloads looks like a mod for {detail.name}.</div>
          ) : (
            <div className="gm-downloads__list">
              {downloads.map((file) => (
                <div key={file.path} data-testid="download-row" className={`gm-download${file.fits === false ? " gm-download--dim" : ""}`}>
                  <input
                    type="checkbox"
                    className="gm-check"
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
                  />
                  <div className="gm-download__main">
                    <div className="gm-download__name">{file.name}</div>
                    <div className="gm-muted gm-download__meta">
                      {sizeText(file.size)} • {shortDate(file.modified)}
                      {file.installed ? " • installed" : ""}
                      {file.fits === false ? ` • doesn't look like a ${detail.name} mod` : ""}
                    </div>
                  </div>
                  <Button size="sm" variant={file.installed ? "secondary" : "primary"} onClick={() => install(file.path)}>
                    {busy === file.path ? "Installing..." : file.installed ? "Reinstall" : "Install"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Ticked mods: turn them all on or off at once */}
      {tickedHere.length > 0 && (
        <div className="gm-bulk" role="toolbar" aria-label="Ticked mods" data-testid="mod-bulk">
          <span className="gm-bulk__count">{tickedHere.length} ticked</span>
          <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => setTickedEnabled(true)}>
            Turn on
          </Button>
          <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => setTickedEnabled(false)}>
            Turn off
          </Button>
          <span className="gm-spacer" />
          <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setTicked(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* LIST: a table, one row per mod, columns that line up */}
      <div className={`gm-table${dense ? " gm-table--dense" : ""}`} role="table" aria-label="Mods" aria-rowcount={sorted.length + 1} data-testid="mod-list">
        {shown.length > 0 && (
          <div className="gm-row gm-row--head" role="row">
            <div role="columnheader" className="gm-cell gm-cell--tick">
              <input
                type="checkbox"
                className="gm-check"
                aria-label={allTicked ? "Untick all shown mods" : `Tick all ${sorted.length} shown mods`}
                checked={allTicked}
                ref={(box) => {
                  if (box) box.indeterminate = tickedHere.length > 0 && !allTicked;
                }}
                onChange={() => setTicked(allTicked ? new Set() : new Set(sorted.map((mod) => mod.key)))}
              />
            </div>
            <div role="columnheader" className="gm-cell gm-cell--toggle">
              <span className="u-visually-hidden">On or off</span>
            </div>
            {(
              [
                ["name", "Name", ""],
                ["where", "Where", " gm-cell--area"],
                ["added", "Added", " gm-cell--added"],
              ] as const
            ).map(([key, label, cls]) => (
              <div key={key} role="columnheader" aria-sort={ariaSort(key)} className={`gm-cell${cls}`}>
                <button type="button" className="gm-sort" data-testid={`sort-${key}`} onClick={() => sortBy(key)}>
                  {label}
                  {sort?.key === key && (sort.dir === 1 ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}
                </button>
              </div>
            ))}
            <div role="columnheader" className="gm-cell gm-cell--actions">
              <button
                type="button"
                className="gm-sort"
                data-testid="mods-dense"
                aria-pressed={dense}
                data-tip="Compact rows: more mods on screen"
                onClick={toggleDense}
              >
                Compact
              </button>
            </div>
          </div>
        )}
        {shown.length === 0 ? (
          <div className="gm-empty">
            {mods.length === 0
              ? profileApi.active && allMods.length
                ? `No mods in ${profileApi.active.name} yet. Add some from Downloads or Discover, or pick another profile and put its mods in this one from each mod's ... menu.`
                : detail.found
                ? "No mods yet. Add one from Downloads, or find some in Discover."
                : "Once the game's found, its mods show here."
              : "No mods match."}
          </div>
        ) : (
          sorted.slice(0, limit).map((mod) => {
            const update = newer.get(mod.key);
            const inSets = sets.filter((set) => set.keys.includes(mod.key));
            const extra = inSets.length ? `Sets: ${inSets.map((set) => set.name).join(", ")}` : "";
            return (
              <div key={mod.key} role="row" data-testid="game-mod" className={`gm-row${mod.enabled ? "" : " gm-row--off"}${mod.mayNeedUpdate && mod.enabled ? " gm-row--warn" : ""}${ticked.has(mod.key) ? " gm-row--ticked" : ""}`}>
                <div role="cell" className="gm-cell gm-cell--tick">
                  <input type="checkbox" className="gm-check" aria-label={`Tick ${mod.name}`} checked={ticked.has(mod.key)} onChange={(event) => tick(mod.key, event.target.checked)} />
                </div>
                <div role="cell" className="gm-cell gm-cell--toggle">
                  <Toggle
                    on={mod.enabled}
                    label={mod.enabled ? `Turn off ${mod.name}` : `Turn on ${mod.name}`}
                    disabled={busy === mod.key}
                    onChange={(on) => act(mod.key, () => window.gamesAPI.setEnabled(detail.id, mod.key, on))}
                  />
                </div>
                <div role="cell" className="gm-cell gm-cell--name">
                  <ModNameCell
                    gameId={detail.id}
                    mod={mod}
                    extra={extra}
                    badge={
                      mod.kept ? (
                        <Badge
                          tone="neutral"
                          data-testid="kept-badge"
                          data-tip={`Kept at ${mod.version || "this version"}${allNewer.get(mod.key) ? `. ${allNewer.get(mod.key)?.toVersion || "A newer version"} is out` : ""}. Let it update from the ... menu`}
                        >
                          Kept
                        </Badge>
                      ) : update ? (
                        <Badge
                          tone="success"
                          data-testid="update-badge"
                          data-tip={`${update.fromVersion || "?"} → ${update.toVersion || "newer"}${mod.mayNeedUpdate ? ". It changes the game's code and is older than the game's latest update" : ""}`}
                        >
                          Update available
                        </Badge>
                      ) : mod.mayNeedUpdate ? (
                        <Badge tone="warning" data-tip="It changes the game's code and is older than the game's latest update">
                          May need updating
                        </Badge>
                      ) : null
                    }
                  />
                </div>
                <div role="cell" className="gm-cell gm-cell--area">
                  {whereOf(mod)}
                </div>
                <div role="cell" className="gm-cell gm-cell--added">
                  {mod.installedAt ? shortDate(mod.installedAt) : "-"}
                </div>
                <div role="cell" className="gm-cell gm-cell--actions">
                  {confirming === mod.key ? (
                    <>
                      <Button
                        size="sm"
                        variant="danger"
                        aria-label={`Delete ${mod.name}`}
                        data-tip={mod.managed ? "Click again to delete it: what it replaced comes back" : "Click again to delete it from the game's folders"}
                        onClick={() => {
                          setConfirming(null);
                          act(mod.key, () => window.gamesAPI.remove(detail.id, mod.key));
                        }}
                      >
                        Delete?
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      {update && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className={`gm-iconbtn${updating === mod.key ? " gm-iconbtn--on" : ""}`}
                          data-testid="update-mod"
                          data-tip={
                            updating === mod.key ? "Updating..." : update.website ? "Its author only allows downloads from CurseForge's website" : `Update to ${update.toVersion || update.toName}`
                          }
                          aria-label={`Update ${mod.name}`}
                          icon={<Download size={16} aria-hidden="true" />}
                          onClick={() => {
                            if (!updating) onUpdate(update);
                          }}
                        />
                      )}
                      {mod.canUndo && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gm-iconbtn"
                          data-testid="undo-update"
                          data-tip="Undo the update: put back the copy from before"
                          aria-label={`Undo the update to ${mod.name}`}
                          icon={<Undo2 size={16} aria-hidden="true" />}
                          onClick={() => onUndo(mod)}
                        />
                      )}
                      <SetMenu
                        mod={mod}
                        sets={sets}
                        onMember={(setId, member) => setsApi.member(setId, mod.key, member)}
                        onCreate={async (name) => {
                          await setsApi.create(name, mod.key);
                        }}
                      />
                      <Menu
                        floating
                        label={`More for ${mod.name}`}
                        triggerClassName="ui-button ui-button--ghost ui-button--sm gm-iconbtn"
                        trigger={<MoreHorizontal size={16} aria-hidden="true" />}
                        items={[
                          {
                            label: mod.enabled ? "Turn off" : "Turn on",
                            icon: <Power size={14} aria-hidden="true" />,
                            disabled: busy === mod.key,
                            onSelect: () => act(mod.key, () => window.gamesAPI.setEnabled(detail.id, mod.key, !mod.enabled)),
                          },
                          ...(update
                            ? [{ label: `Update to ${update.toVersion || update.toName}`, icon: <Download size={14} aria-hidden="true" />, disabled: Boolean(updating), onSelect: () => onUpdate(update) }]
                            : []),
                          ...(mod.canUndo ? [{ label: "Undo the update", icon: <Undo2 size={14} aria-hidden="true" />, onSelect: () => onUndo(mod) }] : []),
                          ...(mod.managed
                            ? [
                                {
                                  label: mod.kept ? "Let it update" : "Keep this version",
                                  icon: mod.kept ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />,
                                  disabled: busy === mod.key,
                                  onSelect: () => act(mod.key, () => window.gamesAPI.keepVersion(detail.id, mod.key, !mod.kept)),
                                },
                              ]
                            : []),
                          // Which profiles it's in: taken out of the chosen one, it leaves the list and the game.
                          ...(profileApi.profiles.length > 1 ? ["separator" as const] : []),
                          ...(profileApi.profiles.length > 1
                            ? profileApi.profiles.map((profile) => {
                                const member = profile.keys.includes(mod.key) || profile.id === profileApi.active?.id;
                                return {
                                  label: `${member ? "✓ " : ""}In ${profile.name}${profile.id === profileApi.active?.id ? " (chosen)" : ""}`,
                                  disabled: Boolean(profileApi.busy),
                                  onSelect: () => void profileApi.member(profile.id, mod.key, !member),
                                };
                              })
                            : []),
                          "separator" as const,
                          {
                            label: mod.managed ? "Delete this mod" : "Delete from the game's folders",
                            icon: <Trash2 size={14} aria-hidden="true" />,
                            danger: true,
                            onSelect: () => setConfirming(mod.key),
                          },
                        ]}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
        {limit < sorted.length && (
          <div ref={more} className="gm-more" role="row">
            <span role="cell">
              Showing {limit} of {sorted.length}.{" "}
              <button type="button" className="gm-sort" onClick={() => setPaging({ key: listKey, limit: sorted.length })}>
                Show all
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
