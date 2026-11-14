import BackgroundLogo from "../components/BackgroundLogo";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import CreateInstancePanel from "../components/CreateInstancePanel";
import InstanceArt from "../components/InstanceArt";
import Sidebar from "../components/MCSidebar";
import { Badge, Button, Notice } from "../components/ui";
import { BinIcon, RefreshIcon } from "../components/Icons";
import {
  ArrowLeft,
  Box,
  Check,
  Clock,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Copy,
  Download,
  Folder,
  FolderMinus,
  LayoutGrid,
  List,
  Loader2,
  MoreHorizontal,
  Package,
  PackageOpen,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Square,
  SquarePlus,
  X,
} from "lucide-react";
import InstanceDetail from "./InstanceDetail";
import { AccountClashNotice, PlayAsMenu } from "../components/PlayAs";
import { playAsItems, useAccountChoice } from "../components/playAsChoice";
import { timeAgo } from "./playedAgo";
import { formatDuration } from "../components/charts";
import "./library.css";

type Props = {
  onBack: () => void;

  goHome: () => void;
  goMinecraft: () => void;
  goDiscover: () => void;
  goLibrary: () => void;
  goSkinSelector: () => void;
  goSettings: () => void;
};

type Sort = "name" | "lastPlayed" | "version" | "added";
type GroupBy = "groups" | "loader" | "version" | "none";
type View = "grid" | "list";
type Played = { seconds: number | null; mods: number };
type Counts = { mods: number; modsOn: number; packs: number; shaders: number; datapacks: number; worlds: number };

const LOADER_NAMES: Record<string, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  quilt: "Quilt",
  forge: "Forge",
  neoforge: "NeoForge",
};
const LOADER_ORDER = Object.keys(LOADER_NAMES);

// Newest Minecraft version first: 1.21.10 before 1.21.9, before 1.20.
const compareVersions = (a: string, b: string) => b.localeCompare(a, undefined, { numeric: true });

const SORTS: Record<Sort, (a: Instance, b: Instance) => number> = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
  lastPlayed: (a, b) => (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? ""),
  version: (a, b) => compareVersions(a.version, b.version) || a.name.localeCompare(b.name),
  added: (a, b) => (b.created ?? "").localeCompare(a.created ?? ""),
};

const loaderOf = (instance: Instance) => (instance.loader || "vanilla").toLowerCase();
const loaderName = (instance: Instance) => LOADER_NAMES[loaderOf(instance)] ?? instance.loader;

const plain = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

const formatDate = (iso?: string) =>
  iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Unknown";

// How the library's grouped is remembered on this computer (a convenience, so it's fine if it can't be).
function readGroupBy(): GroupBy {
  try {
    const saved = localStorage.getItem("library-group-by");
    return saved === "loader" || saved === "version" || saved === "none" ? saved : "groups";
  } catch {
    return "groups";
  }
}

function readView(): View {
  try {
    return localStorage.getItem("library-view") === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function Library({ onBack, goHome, goMinecraft, goDiscover, goLibrary, goSkinSelector, goSettings }: Props) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [groupBy, setGroupBy] = useState<GroupBy>(readGroupBy);
  const [storageUsed, setStorageUsed] = useState(0);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [groups, setGroups] = useState<Record<string, string[]>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>(readView);
  const [loaderFilter, setLoaderFilter] = useState("all");
  // Real play time and mod counts per instance, from the dashboard data (null seconds = not known).
  const [played, setPlayed] = useState<Record<string, Played>>({});
  // Installs and repairs in progress, by instance.
  const [progress, setProgress] = useState<Record<string, InstallProgress>>({});

  // The instance being managed, which takes over the page.
  const [open, setOpen] = useState<string | null>(null);
  // The instance whose details are on the right (one click picks it).
  const [current, setCurrent] = useState<string | null>(null);
  // Ticked instances, for the bar at the bottom.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // The instance whose Play was pressed, until Minecraft has started.
  const [starting, setStarting] = useState<string | null>(null);
  // Making or importing an instance takes over the list, under the same sidebar.
  const [creating, setCreating] = useState<"new" | "import" | null>(null);
  const [message, setMessage] = useState<{ tone: "bad" | "good"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // The details panel: what's inside the chosen instance, and its inline forms.
  const [counts, setCounts] = useState<Counts | null>(null);
  const [panelForm, setPanelForm] = useState<"copy" | "export" | "group" | null>(null);
  const [copyName, setCopyName] = useState("");
  const [exportWorlds, setExportWorlds] = useState(false);
  const [exportOptions, setExportOptions] = useState(true);
  const [panelGroupName, setPanelGroupName] = useState("");
  const [panelBusy, setPanelBusy] = useState<string | null>(null);
  const [confirmDeleteOne, setConfirmDeleteOne] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);
  // Who each game plays as; Play offers the free accounts when the default one is in another game.
  const choice = useAccountChoice();

  async function loadInstances() {
    try {
      const data = await window.instanceAPI.list();
      setInstances(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load instances:", err);
      setInstances([]);
    }
    setLoaded(true);
  }

  const refreshStorage = () => window.launcherAPI.getInstancesStorage().then(setStorageUsed).catch(() => {});

  const loadPlayed = () =>
    Promise.resolve(window.dashboardAPI?.stats?.())
      .then((stats) => {
        if (!stats) return;
        setPlayed(Object.fromEntries(stats.instances.map((entry) => [entry.name, { seconds: entry.playSeconds, mods: entry.modCount }])));
      })
      .catch(() => {});

  useEffect(() => {
    window.instanceAPI
      .list()
      .then((data) => setInstances(Array.isArray(data) ? data : []))
      .catch(() => setInstances([]))
      .finally(() => setLoaded(true));
    window.instanceAPI
      .getSettings()
      .then((settings) => setGroups(settings.instanceGroups ?? {}))
      .catch(() => {});
    refreshStorage();
    loadPlayed();
  }, []);

  // Installs and repairs show on their card while they run.
  useEffect(
    () =>
      window.instanceAPI.onProgress((update: InstallProgress) => {
        if (!update?.name) return;
        setProgress((now) => ({ ...now, [update.name]: update }));
        if (update.percent >= 100)
          setTimeout(
            () =>
              setProgress((now) => {
                if (now[update.name]?.percent !== update.percent) return now;
                const rest = { ...now };
                delete rest[update.name];
                return rest;
              }),
            1500
          );
      }),
    []
  );

  // A game closing changes Running back to Play.
  useEffect(
    () =>
      window.instanceAPI.onExit(({ name }: { name: string }) => {
        setInstances((list) => list.map((instance) => (instance.name === name ? { ...instance, running: false, playingAs: null } : instance)));
        loadPlayed();
      }),
    []
  );

  // A second press of Delete is needed within a few seconds.
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

  useEffect(() => {
    if (!confirmDeleteOne) return;
    const timer = setTimeout(() => setConfirmDeleteOne(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmDeleteOne]);

  // The right-click menu closes on any click, scroll or Escape; Escape also clears the ticks.
  useEffect(() => {
    const close = () => setMenu(null);
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenu(null);
      if (!naming) setPicked(new Set());
    };
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", key);
    };
  }, [naming]);

  const names = useMemo(() => new Set(instances.map((i) => i.name)), [instances]);
  // Groups only list instances that still exist.
  const liveGroups = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(groups)
          .map(([group, members]) => [group, members.filter((name) => names.has(name))] as const)
          .filter(([, members]) => members.length)
      ),
    [groups, names]
  );

  const shown = useMemo(
    () =>
      instances
        .filter((instance) => instance.name.toLowerCase().includes(search.trim().toLowerCase()))
        .filter((instance) => loaderFilter === "all" || loaderOf(instance) === loaderFilter)
        .sort(SORTS[sort]),
    [instances, search, sort, loaderFilter]
  );

  // The details panel always shows someone: the one picked, else the one played last.
  const chosen = useMemo(() => {
    const found = current ? instances.find((i) => i.name === current) : undefined;
    if (found) return found;
    return [...instances].sort((a, b) => SORTS.lastPlayed(a, b) || SORTS.name(a, b))[0] ?? null;
  }, [current, instances]);
  const chosenName = chosen?.name ?? null;

  // Picking another instance resets the panel (done while rendering, as React suggests).
  const [panelFor, setPanelFor] = useState<string | null>(null);
  if (panelFor !== chosenName) {
    setPanelFor(chosenName);
    setCounts(null);
    setPanelForm(null);
    setConfirmDeleteOne(false);
  }

  // What's inside it, for the panel.
  useEffect(() => {
    if (!chosenName) return;
    let live = true;
    window.instanceAPI
      .content(chosenName)
      .then((content) => {
        if (!live) return;
        setCounts({
          mods: content.mod.length,
          modsOn: content.mod.filter((m) => m.enabled).length,
          packs: content.resourcepack.length,
          shaders: content.shader.length,
          datapacks: content.datapack.length,
          worlds: content.worlds.length,
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [chosenName]);

  const sections = useMemo(() => {
    if (groupBy === "none") return [{ id: "all", title: null as string | null, items: shown }];
    if (groupBy === "groups") {
      const grouped = new Set(Object.values(liveGroups).flat());
      const list = Object.keys(liveGroups)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
        .map((group) => ({ id: `g:${group}`, title: group as string | null, items: shown.filter((i) => liveGroups[group].includes(i.name)) }));
      const rest = shown.filter((i) => !grouped.has(i.name));
      if (!list.length) return [{ id: "all", title: null as string | null, items: shown }];
      return [...list, { id: "rest", title: "Not in a group", items: rest }].filter((section) => section.items.length);
    }
    const keyOf = (i: Instance) => (groupBy === "loader" ? loaderOf(i) : i.version);
    const keys = [...new Set(shown.map(keyOf))].sort(groupBy === "loader" ? (a, b) => LOADER_ORDER.indexOf(a) - LOADER_ORDER.indexOf(b) : compareVersions);
    return keys.map((key) => ({
      id: `${groupBy}:${key}`,
      title: groupBy === "loader" ? (LOADER_NAMES[key] ?? key) : `Minecraft ${key}`,
      items: shown.filter((i) => keyOf(i) === key),
    }));
  }, [groupBy, shown, liveGroups]);

  async function saveGroups(next: Record<string, string[]>) {
    setGroups(next);
    try {
      const settings = await window.instanceAPI.setSettings({ instanceGroups: next });
      setGroups(settings.instanceGroups ?? next);
    } catch (err) {
      setMessage({ tone: "bad", text: plain(err) });
    }
  }

  function chooseView(next: View) {
    setView(next);
    try {
      localStorage.setItem("library-view", next);
    } catch {
      // Grid again next time.
    }
  }

  // The card's "..." button opens the same menu as a right-click, under the button.
  function openMenuAt(name: string, x: number, y: number) {
    setCurrent(name);
    setMenu({ name, x: Math.min(x, window.innerWidth - 210), y: Math.min(y, window.innerHeight - 260) });
  }

  function chooseGroupBy(next: GroupBy) {
    setGroupBy(next);
    try {
      localStorage.setItem("library-group-by", next);
    } catch {
      // Back to the default next time.
    }
  }

  function toggle(name: string) {
    setConfirmDelete(false);
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  /* Starts it alongside any others that are open: as accountId, or the active account. */
  async function play(name: string, accountId?: string) {
    if (starting) return;
    // That account is in another game: the panel says so and offers the free ones.
    if (!choice.check(name, accountId)) return setCurrent(name);
    setStarting(name);
    setMessage(null);
    try {
      await window.instanceAPI.launch(name, accountId);
      loadInstances();
    } catch (err) {
      if (await choice.explain(name, accountId)) setCurrent(name);
      else setMessage({ tone: "bad", text: plain(err) });
    }
    setStarting(null);
  }

  async function stop(name: string) {
    setPanelBusy("stop");
    try {
      await window.instanceAPI.stop(name);
      await loadInstances();
    } catch (err) {
      setMessage({ tone: "bad", text: plain(err) });
    }
    setPanelBusy(null);
  }

  async function deletePicked() {
    if (!confirmDelete) return setConfirmDelete(true);
    setConfirmDelete(false);
    setBusy(true);
    const failed: string[] = [];
    const list = [...picked];
    for (const name of list) {
      try {
        await window.instanceAPI.remove(name);
      } catch (err) {
        failed.push(`${name}: ${plain(err)}`);
      }
    }
    setBusy(false);
    setPicked(new Set());
    await loadInstances();
    refreshStorage();
    const done = list.length - failed.length;
    setMessage(
      failed.length
        ? { tone: "bad", text: `Couldn't delete ${failed.join("; ")}` }
        : { tone: "good", text: `Deleted ${done === 1 ? list[0] : `${done} instances`}.` }
    );
  }

  async function deleteOne(name: string) {
    if (!confirmDeleteOne) return setConfirmDeleteOne(true);
    setConfirmDeleteOne(false);
    setPanelBusy("delete");
    try {
      await window.instanceAPI.remove(name);
      setCurrent(null);
      setPicked((now) => {
        const next = new Set(now);
        next.delete(name);
        return next;
      });
      setMessage({ tone: "good", text: `Deleted ${name}.` });
    } catch (err) {
      setMessage({ tone: "bad", text: `Couldn't delete ${name}: ${plain(err)}` });
    }
    setPanelBusy(null);
    await loadInstances();
    refreshStorage();
  }

  async function duplicate(name: string) {
    const newName = copyName.trim();
    if (!newName) return;
    setPanelBusy("copy");
    try {
      const copy = await window.instanceAPI.duplicate(name, newName);
      setPanelForm(null);
      await loadInstances();
      setCurrent(copy.name);
      setMessage({ tone: "good", text: `Made a copy called "${copy.name}".` });
    } catch (err) {
      setMessage({ tone: "bad", text: plain(err) });
    }
    setPanelBusy(null);
  }

  async function exportPack(name: string) {
    setPanelBusy("export");
    try {
      const done = await window.instanceAPI.exportModpack(name, { worlds: exportWorlds, options: exportOptions });
      if (done) {
        setPanelForm(null);
        setMessage({
          tone: "good",
          text:
            `Saved ${done.file.split(/[\\/]/).pop()} (${formatBytes(done.bytes)}): ${done.linked} linked from Modrinth` +
            (done.included.length ? `, ${done.included.length} packed in` : "") +
            (done.configFiles ? `, plus ${plural(done.configFiles, "config file")}` : "") +
            ".",
        });
      }
    } catch (err) {
      setMessage({ tone: "bad", text: plain(err) });
    }
    setPanelBusy(null);
  }

  function makeGroup() {
    const name = (naming ?? "").trim();
    if (!name) return;
    const next = { ...groups, [name]: [...new Set([...(groups[name] ?? []), ...picked])] };
    saveGroups(next);
    setNaming(null);
    setPicked(new Set());
    if (groupBy !== "groups") chooseGroupBy("groups");
  }

  function addToGroup(group: string, members: Iterable<string> = picked) {
    saveGroups({ ...groups, [group]: [...new Set([...(groups[group] ?? []), ...members])] });
    if (members === picked) setPicked(new Set());
  }

  function removeFromGroup(group: string, name: string) {
    const members = (groups[group] ?? []).filter((n) => n !== name);
    const next = { ...groups };
    if (members.length) next[group] = members;
    else delete next[group];
    saveGroups(next);
  }

  function deleteGroup(group: string) {
    const next = { ...groups };
    delete next[group];
    saveGroups(next);
  }

  // Arrow keys move between tiles, in the order they're shown.
  function moveFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step || event.target !== event.currentTarget) return;
    const tiles = [...(gridRef.current?.querySelectorAll<HTMLElement>(".lx-tile") ?? [])];
    const at = tiles.indexOf(event.currentTarget);
    const target = tiles[at + step];
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  // Managing one instance takes over the content area, keeping the sidebar in place.
  if (open) {
    // The sidebar's Back and Library both lead back to the list of instances.
    const backToList = () => {
      setOpen(null);
      loadInstances();
    };
    return (
      <div className="app-screen">
        <Sidebar
          currentPage="library"
          goHome={goHome}
          goMinecraft={goMinecraft}
          goDiscover={goDiscover}
          goLibrary={backToList}
          goSkinSelector={goSkinSelector}
          goSettings={goSettings}
          showBack
          onBack={backToList}
        />

        <div className="app-main" style={{ display: "flex" }}>
          <div className="app-logo-tint">
            <BackgroundLogo />
          </div>
          <InstanceDetail instanceName={open} onBack={backToList} />
        </div>
      </div>
    );
  }

  const selecting = picked.size > 0;
  const groupNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  const menuGroups = menu ? Object.keys(liveGroups).filter((group) => liveGroups[group].includes(menu.name)) : [];
  const chosenGroups = chosen ? Object.keys(liveGroups).filter((group) => liveGroups[group].includes(chosen.name)).sort() : [];
  const otherGroups = chosen ? groupNames.filter((group) => !chosenGroups.includes(group)) : [];

  const statusLine = (instance: Instance) => {
    const busyWith = progress[instance.name];
    if (busyWith) return <span className="lx-meta live">{busyWith.stage === "starter" ? "Adding mods" : "Installing"} {Math.round(busyWith.percent)}%</span>;
    if (starting === instance.name) return <span className="lx-meta live">Starting...</span>;
    if (instance.running)
      return (
        <span className="lx-meta live">
          <span className="lx-live-dot" aria-hidden="true" />
          {instance.playingAs ? `Running as ${instance.playingAs.name}` : "Running now"}
        </span>
      );
    if (!instance.installed) return <span className="lx-meta warn">Not fully installed</span>;
    const ago = timeAgo(instance.lastPlayed);
    return <span className="lx-meta">{ago ? `Played ${ago}` : "Not played yet"}</span>;
  };

  const tile = (instance: Instance) => {
    const on = picked.has(instance.name);
    const isStarting = starting === instance.name;
    const isCurrent = chosenName === instance.name;
    const stat = played[instance.name];
    const busyWith = progress[instance.name];
    const loaderText = `${loaderName(instance)}${loaderOf(instance) !== "vanilla" && instance.loaderVersion ? ` ${instance.loaderVersion}` : ""}`;
    const playedFor = stat?.seconds ? formatDuration(stat.seconds) : null;
    const moreButton = (
  <button
    type="button"
    className="lx-more"
    aria-label={`More for ${instance.name}`}
    data-tip="More actions"
    aria-haspopup="menu"
    onClick={(event) => {
      event.stopPropagation();
      const r = event.currentTarget.getBoundingClientRect();
      openMenuAt(instance.name, r.left, r.bottom + 4);
    }}
    onDoubleClick={(event) => event.stopPropagation()}
  >
    <MoreHorizontal size={16} aria-hidden="true" />
  </button>
    );
    return (
      <div
        key={instance.name}
        className={`lx-tile${on ? " ticked" : ""}${instance.running ? " running" : ""}`}
        data-testid="instance-card"
        role="button"
        tabIndex={0}
        aria-current={isCurrent || undefined}
        aria-label={selecting ? `${on ? "Untick" : "Tick"} ${instance.name}` : `${instance.name}, Minecraft ${instance.version}, ${loaderText}. Press Enter to open`}
        data-tip={selecting ? undefined : "Click to see it on the right, double-click to open"}
        onClick={(event) => {
          if (selecting || event.metaKey || event.ctrlKey || event.shiftKey) toggle(instance.name);
          else setCurrent(instance.name);
        }}
        onDoubleClick={(event) => {
          if (selecting || event.metaKey || event.ctrlKey || event.shiftKey) return;
          setOpen(instance.name);
        }}
        onFocus={(event) => {
          if (event.target === event.currentTarget && !selecting) setCurrent(instance.name);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenuAt(instance.name, event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          moveFocus(event);
          if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          if (selecting) toggle(instance.name);
          else setOpen(instance.name);
        }}
      >
        <InstanceArt name={instance.name} />
        <button
          type="button"
          className={`lx-tick${on ? " on" : ""}`}
          aria-pressed={on}
          aria-label={on ? `Untick ${instance.name}` : `Tick ${instance.name}`}
          data-tip={on ? "Untick" : "Tick, to do things to several at once"}
          onClick={(event) => {
            event.stopPropagation();
            toggle(instance.name);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {on && <Check size={13} strokeWidth={3} aria-hidden="true" />}
        </button>
        <div className="lx-text">
          <span className="lx-name">{instance.name}</span>
          <span className="lx-sub">
            <span className="lx-ver">{instance.version}</span> {loaderText}
          </span>
          {view === "grid" && statusLine(instance)}
        </div>
        {view === "list" && (
          <>
            <span className="lx-cell">{stat ? plural(stat.mods, "mod") : ""}</span>
            <span className="lx-cell">{playedFor ?? ""}</span>
            <span className="lx-cell lx-cell-status">{statusLine(instance)}</span>
          </>
        )}
        <div className="lx-tile-actions">
          {view === "list" && moreButton}
          <button
            type="button"
            className={`lx-play${isStarting ? " busy" : ""}`}
            data-testid="quick-play"
            aria-label={isStarting ? `Starting ${instance.name}` : `Play ${instance.name}`}
            data-tip={instance.installed ? "Play" : "Finish installing it and play"}
            aria-disabled={Boolean(starting) || undefined}
            onClick={(event) => {
              event.stopPropagation();
              setCurrent(instance.name);
              play(instance.name);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {isStarting ? <Loader2 size={16} className="lib-spin" aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />}
          </button>
        </div>
        {view === "grid" && (
          <div className="lx-facts-row">
            {stat && (
              <span>
                <Package size={13} aria-hidden="true" /> {plural(stat.mods, "mod")}
              </span>
            )}
            {playedFor && (
              <span title="Total play time">
                <Clock size={13} aria-hidden="true" /> {playedFor}
              </span>
            )}
            {moreButton}
          </div>
        )}
        {busyWith && (
          <div className="lx-progress" role="progressbar" aria-label={`${instance.name}: ${busyWith.stage}`} aria-valuenow={Math.round(busyWith.percent)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${busyWith.percent}%` }} />
          </div>
        )}
      </div>
    );
  };

  // The right-hand panel: everything about the chosen instance, Play first, Delete last.
  const panel = chosen ? (
    <aside className="lx-panel" aria-label={`${chosen.name} details`} data-testid="library-panel">
      <InstanceArt name={chosen.name} cols={14} rows={6} />
      <div className="lx-panel-inner">
        <div>
          <h2 className="lx-panel-title">{chosen.name}</h2>
          <p className="lx-panel-sub">
            Minecraft {chosen.version}, {loaderName(chosen)}
            {loaderOf(chosen) !== "vanilla" && chosen.loaderVersion ? ` ${chosen.loaderVersion}` : ""}
          </p>
          <div className="lx-panel-badges">
            {chosen.running ? (
              <Badge tone="accent">{chosen.playingAs ? `Running as ${chosen.playingAs.name}` : "Running"}</Badge>
            ) : chosen.installed ? (
              <Badge tone="success">Ready to play</Badge>
            ) : (
              <Badge tone="warning">Not fully installed</Badge>
            )}
            {chosenGroups.map((group) => (
              <Badge key={group}>{group}</Badge>
            ))}
          </div>
        </div>

        <div className="lx-play-row">
          <Button
            variant="primary"
            size="lg"
            data-testid="panel-play"
            disabled={Boolean(starting) || chosen.running}
            icon={starting === chosen.name ? <Loader2 size={18} className="lib-spin" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
            onClick={() => play(chosen.name)}
          >
            {starting === chosen.name ? "Starting..." : chosen.running ? "Running" : chosen.installed ? "Play" : "Install and play"}
          </Button>
          {!chosen.running && !starting && <PlayAsMenu choice={choice} instance={chosen.name} size="lg" onPlayAs={(id) => play(chosen.name, id)} />}
          {chosen.running && (
            <Button variant="danger" size="lg" icon={<Square size={14} fill="currentColor" aria-hidden="true" />} disabled={panelBusy === "stop"} onClick={() => stop(chosen.name)}>
              Stop
            </Button>
          )}
        </div>
        <AccountClashNotice choice={choice} instance={chosen.name} onPlayAs={(id) => play(chosen.name, id)} />
        <p className="lx-play-hint">
          {chosen.lastPlayed ? `Last played ${timeAgo(chosen.lastPlayed)}` : "Not played yet"}
          {chosen.created ? `, added ${formatDate(chosen.created)}` : ""}.
        </p>

        <dl className="lx-facts">
          <div>
            <dt>Mods</dt>
            <dd>{counts ? (counts.mods === counts.modsOn ? counts.mods : `${counts.modsOn} of ${counts.mods} on`) : "..."}</dd>
          </div>
          <div>
            <dt>Worlds</dt>
            <dd>{counts ? counts.worlds : "..."}</dd>
          </div>
          {played[chosen.name]?.seconds ? (
            <div>
              <dt>Play time</dt>
              <dd>{formatDuration(played[chosen.name].seconds ?? 0)}</dd>
            </div>
          ) : (
            <div>
              <dt>Packs and shaders</dt>
              <dd>{counts ? counts.packs + counts.shaders : "..."}</dd>
            </div>
          )}
          <div>
            <dt>Memory</dt>
            <dd>{chosen.ram} GB</dd>
          </div>
        </dl>

        <div className="lx-actions">
          <button type="button" className="lx-action" data-testid="panel-open" onClick={() => setOpen(chosen.name)}>
            <SlidersHorizontal size={16} aria-hidden="true" /> Mods, worlds and settings
            <span className="lx-action-hint">Open</span>
          </button>
          <button
            type="button"
            className="lx-action"
            onClick={() => window.instanceAPI.openFolder(chosen.name).catch((err) => setMessage({ tone: "bad", text: plain(err) }))}
          >
            <Folder size={16} aria-hidden="true" /> Show files
          </button>
          <button
            type="button"
            className="lx-action"
            aria-expanded={panelForm === "copy"}
            disabled={chosen.running}
            title={chosen.running ? "Stop it first" : undefined}
            onClick={() => {
              setCopyName(`${chosen.name} (copy)`);
              setPanelForm(panelForm === "copy" ? null : "copy");
            }}
          >
            <Copy size={16} aria-hidden="true" /> Make a copy
          </button>
          {panelForm === "copy" && (
            <form
              className="lx-inline"
              onSubmit={(event) => {
                event.preventDefault();
                duplicate(chosen.name);
              }}
            >
              <p>Same mods, worlds and settings under a new name. Logs and play history aren't copied.</p>
              <div className="lx-inline-row">
                <input className="ui-input" autoFocus value={copyName} aria-label="Name for the copy" onChange={(e) => setCopyName(e.target.value)} />
                <Button type="submit" size="md" disabled={!copyName.trim() || panelBusy === "copy"}>
                  {panelBusy === "copy" ? "Copying..." : "Copy"}
                </Button>
              </div>
            </form>
          )}
          <button
            type="button"
            className="lx-action"
            aria-expanded={panelForm === "export"}
            onClick={() => setPanelForm(panelForm === "export" ? null : "export")}
          >
            <PackageOpen size={16} aria-hidden="true" /> Share as a modpack
          </button>
          {panelForm === "export" && (
            <div className="lx-inline">
              <p>Saves a Modrinth modpack (.mrpack) that this launcher, Prism and the Modrinth App can install. Turned-off mods are left out.</p>
              <label>
                <input type="checkbox" checked={exportWorlds} onChange={(e) => setExportWorlds(e.target.checked)} /> Include worlds
              </label>
              <label>
                <input type="checkbox" checked={exportOptions} onChange={(e) => setExportOptions(e.target.checked)} /> Include game settings
              </label>
              <div className="lx-inline-row">
                <Button size="md" icon={<Download size={15} aria-hidden="true" />} disabled={panelBusy === "export"} onClick={() => exportPack(chosen.name)}>
                  {panelBusy === "export" ? "Saving..." : "Save modpack..."}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="lx-groups">
          <span className="lx-groups-label" id="lx-groups-label">
            Groups
          </span>
          <div className="lx-chips" aria-labelledby="lx-groups-label">
            {chosenGroups.map((group) => (
              <span className="lx-chip" key={group}>
                {group}
                <button type="button" aria-label={`Take ${chosen.name} out of ${group}`} data-tip={`Take it out of ${group}`} onClick={() => removeFromGroup(group, chosen.name)}>
                  <X size={13} aria-hidden="true" />
                </button>
              </span>
            ))}
            <select
              className="lx-select"
              aria-label={`Put ${chosen.name} in a group`}
              value=""
              onChange={(e) => {
                const value = e.target.value;
                if (value === "__new") {
                  setPanelGroupName("");
                  setPanelForm("group");
                } else if (value) addToGroup(value, [chosen.name]);
              }}
            >
              <option value="">{chosenGroups.length ? "Add to another group..." : "Add to a group..."}</option>
              {otherGroups.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
              <option value="__new">New group...</option>
            </select>
          </div>
          {panelForm === "group" && (
            <form
              className="lx-inline"
              onSubmit={(event) => {
                event.preventDefault();
                const name = panelGroupName.trim();
                if (!name) return;
                addToGroup(name, [chosen.name]);
                setPanelForm(null);
                if (groupBy !== "groups") chooseGroupBy("groups");
              }}
            >
              <div className="lx-inline-row">
                <input
                  className="ui-input"
                  autoFocus
                  value={panelGroupName}
                  placeholder="Group name"
                  aria-label="New group's name"
                  onChange={(e) => setPanelGroupName(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setPanelForm(null)}
                />
                <Button type="submit" disabled={!panelGroupName.trim()}>
                  Make group
                </Button>
              </div>
            </form>
          )}
        </div>

        <button
          type="button"
          className={`lx-delete${confirmDeleteOne ? " confirming" : ""}`}
          data-testid="panel-delete"
          disabled={panelBusy === "delete" || chosen.running}
          onClick={() => deleteOne(chosen.name)}
        >
          <BinIcon size={16} />
          {panelBusy === "delete" ? "Deleting..." : confirmDeleteOne ? `Click again to delete ${chosen.name}` : "Delete instance"}
        </button>
      </div>
    </aside>
  ) : (
    <aside className="lx-panel" aria-label="Instance details">
      <p className="lx-panel-empty">{loaded ? "Your instances show up here once you make or import one." : "Loading..."}</p>
    </aside>
  );

  return (
    <div className="app-screen">
      <Sidebar
        currentPage="library"
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

        {creating ? (
          <div className="app-page">
            <div className="nc-page">
              <Button variant="ghost" className="nc-back" icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={() => setCreating(null)}>
                Back to Library
              </Button>
              <h1 className="page-title">New Instance</h1>
              <p className="page-lead">Make a new instance from a Minecraft version or a modpack, or bring one in from elsewhere.</p>
              <CreateInstancePanel
                initialTab={creating === "import" ? "import" : "version"}
                onCancel={() => setCreating(null)}
                onDone={(name?: string) => {
                  setCreating(null);
                  if (name) setCurrent(name);
                  loadInstances();
                  refreshStorage();
                }}
              />
            </div>
          </div>
        ) : (
          <div className="lx">
            <div className="lx-col">
              <div className={`lx-body${selecting ? " lx-ticking" : ""}`} style={selecting ? { paddingBottom: 110 } : undefined}>
                <div className="lx-head">
                  <div>
                    <h1 className="page-title">Library</h1>
                    <p className="page-lead" style={{ marginBottom: 0 }}>
                      {plural(instances.length, "instance")}, {formatBytes(storageUsed)} on disk
                    </p>
                  </div>
                  <div className="lx-head-actions">
                    <Button
                      variant="ghost"
                      icon={<RefreshIcon size={16} />}
                      onClick={() => {
                        loadInstances();
                        loadPlayed();
                      }}
                      data-tip="Look for instances again"
                    >
                      Refresh
                    </Button>
                    <Button
                      icon={<Download size={16} aria-hidden="true" />}
                      onClick={() => setCreating("import")}
                      data-tip="From another launcher, a folder, a zip or your cloud folder"
                    >
                      Import
                    </Button>
                    <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setCreating("new")}>
                      New Instance
                    </Button>
                  </div>
                </div>

                <div className="lx-tools">
                  <label className="lx-search">
                    <Search size={16} aria-hidden="true" />
                    <span className="u-visually-hidden">Search instances</span>
                    <input className="ui-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search instances..." />
                  </label>
                  <select className="lx-select" aria-label="Filter by loader" value={loaderFilter} onChange={(e) => setLoaderFilter(e.target.value)}>
                    <option value="all">All loaders</option>
                    {LOADER_ORDER.filter((key) => instances.some((i) => loaderOf(i) === key)).map((key) => (
                      <option key={key} value={key}>
                        {LOADER_NAMES[key]} only
                      </option>
                    ))}
                  </select>
                  <select className="lx-select" aria-label="Sort instances" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                    <option value="name">Sort: Name</option>
                    <option value="lastPlayed">Sort: Last played</option>
                    <option value="version">Sort: Version</option>
                    <option value="added">Sort: Recently added</option>
                  </select>
                  <select className="lx-select" aria-label="Group instances" value={groupBy} onChange={(e) => chooseGroupBy(e.target.value as GroupBy)}>
                    <option value="groups">Group: Your groups</option>
                    <option value="loader">Group: Loader</option>
                    <option value="version">Group: Version</option>
                    <option value="none">Group: None</option>
                  </select>
                  <div className="lx-views" role="radiogroup" aria-label="Show as">
                    {(
                      [
                        ["grid", "Cards", LayoutGrid],
                        ["list", "List", List],
                      ] as const
                    ).map(([value, label, Icon]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={view === value}
                        aria-label={label}
                        data-tip={label}
                        onClick={() => chooseView(value)}
                      >
                        <Icon size={16} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>

                {message && (
                  <Notice
                    className="lx-notice"
                    tone={message.tone === "bad" ? "danger" : "success"}
                    actions={
                      <button type="button" className="lx-dismiss" onClick={() => setMessage(null)} aria-label="Dismiss">
                        <X size={16} aria-hidden="true" />
                      </button>
                    }
                  >
                    {message.text}
                  </Notice>
                )}

                {loaded && !instances.length ? (
                  <div className="lx-empty">
                    <h2>No instances yet</h2>
                    <p>Make one from any Minecraft version or modpack, or bring in the ones you have in another launcher.</p>
                    <div className="lx-head-actions">
                      <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setCreating("new")}>
                        New Instance
                      </Button>
                      <Button icon={<Download size={16} aria-hidden="true" />} onClick={() => setCreating("import")}>
                        Import
                      </Button>
                    </div>
                  </div>
                ) : instances.length > 0 && !shown.length ? (
                  <p className="lx-nomatch">No instances match "{search}".</p>
                ) : (
                  <div ref={gridRef}>
                    {view === "list" && (
                      <div className="lx-list-head" aria-hidden="true">
                        <span />
                        <span>Name</span>
                        <span>Mods</span>
                        <span>Play time</span>
                        <span>Last played</span>
                        <span />
                      </div>
                    )}
                    {sections.map((section) => {
                      const folded = section.title !== null && collapsed.has(section.id);
                      const userGroup = section.id.startsWith("g:") ? section.id.slice(2) : null;
                      return (
                        <section key={section.id} aria-label={section.title ?? "Instances"} style={section.title === null ? { marginTop: "var(--space-6)" } : undefined}>
                          {section.title !== null && (
                            <div className="lx-section-head">
                              <button
                                type="button"
                                className="lx-fold"
                                aria-expanded={!folded}
                                onClick={() =>
                                  setCollapsed((now) => {
                                    const next = new Set(now);
                                    if (next.has(section.id)) next.delete(section.id);
                                    else next.add(section.id);
                                    return next;
                                  })
                                }
                              >
                                {folded ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                                {section.title}
                                <span className="lx-count">{section.items.length}</span>
                              </button>
                              <span className="lx-rule" />
                              {userGroup && (
                                <button
                                  type="button"
                                  className="lx-group-delete"
                                  data-tip="Delete this group (its instances stay)"
                                  aria-label={`Delete the group ${userGroup}`}
                                  onClick={() => deleteGroup(userGroup)}
                                >
                                  <X size={14} aria-hidden="true" /> Ungroup
                                </button>
                              )}
                            </div>
                          )}
                          {!folded && <div className={view === "list" ? "lx-list" : "lx-grid"}>{section.items.map(tile)}</div>}
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* What can be done with the ticked instances. */}
              {selecting && (
                <div className="lx-bar" role="toolbar" aria-label="Ticked instances" data-testid="library-bar">
                  <span className="lx-bar-count">{picked.size} selected</span>
                  <span className="lx-sep" />
                  {naming !== null ? (
                    <>
                      <input
                        className="ui-input"
                        autoFocus
                        value={naming}
                        placeholder="Group name"
                        aria-label="New group's name"
                        onChange={(e) => setNaming(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") makeGroup();
                          if (e.key === "Escape") setNaming(null);
                        }}
                      />
                      <button onClick={makeGroup} disabled={!naming.trim()}>
                        <CircleCheck size={16} aria-hidden="true" /> Make group
                      </button>
                      <button onClick={() => setNaming(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setPicked(new Set(shown.map((i) => i.name)))} disabled={picked.size === shown.length}>
                        Select all
                      </button>
                      <button
                        onClick={() => {
                          setPicked(new Set());
                          setConfirmDelete(false);
                        }}
                      >
                        Clear
                      </button>
                      <span className="lx-sep" />
                      {groupNames.length > 0 && (
                        <select aria-label="Add to a group" value="" onChange={(e) => e.target.value && addToGroup(e.target.value)}>
                          <option value="">Add to group...</option>
                          {groupNames.map((group) => (
                            <option key={group} value={group}>
                              {group}
                            </option>
                          ))}
                        </select>
                      )}
                      <button onClick={() => setNaming("")}>
                        <SquarePlus size={16} aria-hidden="true" /> New group
                      </button>
                      <span className="lx-sep" />
                      <button className={`danger${confirmDelete ? " confirming" : ""}`} onClick={deletePicked} disabled={busy}>
                        <BinIcon size={16} /> {busy ? "Deleting..." : confirmDelete ? `Click again to delete ${picked.size === 1 ? "it" : `all ${picked.size}`}` : "Delete"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {panel}
          </div>
        )}
      </main>

      {menu && (
        <div className="lib-menu" style={{ left: menu.x, top: menu.y }} role="menu" onClick={(e) => e.stopPropagation()}>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(null);
              play(menu.name);
            }}
          >
            <Play size={15} aria-hidden="true" /> Play
          </button>
          {/* With several accounts: the others to play as (the active one is Play itself). */}
          {choice.accounts.length > 1 &&
            !instances.find((instance) => instance.name === menu.name)?.running &&
            playAsItems(choice, menu.name, (id) => {
              setMenu(null);
              play(menu.name, id);
            })
              .filter((_item, index) => !choice.accounts[index].active)
              .map((item) => (
                <button key={item.label} role="menuitem" className="play-as__item" disabled={item.disabled} onClick={item.onSelect}>
                  {item.icon} {item.label}
                </button>
              ))}
          <button
            role="menuitem"
            onClick={() => {
              setMenu(null);
              setOpen(menu.name);
            }}
          >
            <Box size={15} aria-hidden="true" /> Open
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(null);
              window.instanceAPI.openFolder(menu.name).catch(() => {});
            }}
          >
            <Folder size={15} aria-hidden="true" /> Open folder
          </button>
          <hr />
          <button
            role="menuitem"
            onClick={() => {
              setMenu(null);
              toggle(menu.name);
            }}
          >
            <CircleCheck size={15} aria-hidden="true" /> {picked.has(menu.name) ? "Deselect" : "Select"}
          </button>
          {menuGroups.map((group) => (
            <button
              key={group}
              role="menuitem"
              onClick={() => {
                setMenu(null);
                removeFromGroup(group, menu.name);
              }}
            >
              <FolderMinus size={15} aria-hidden="true" /> Remove from {group}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default Library;
