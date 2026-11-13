import BackgroundLogo from "../components/BackgroundLogo";
import { useEffect, useMemo, useState } from "react";
import CreateInstancePanel from "../components/CreateInstancePanel";
import Sidebar from "../components/MCSidebar";
import IconButton from "../components/IconButton";
import { BinIcon, RefreshIcon } from "../components/Icons";
import { Box, Check, ChevronDown, ChevronRight, CircleCheck, Folder, FolderMinus, Loader2, Play, Plus, SquarePlus, X } from "lucide-react";
import InstanceDetail from "./InstanceDetail";

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
// "Fabric 1.21.1": what it runs, as the tiles say it.
const subtitle = (instance: Instance) => `${LOADER_NAMES[loaderOf(instance)] ?? instance.loader} ${instance.version}`;

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// How the library's grouped is remembered on this computer (a convenience, so it's fine if it can't be).
function readGroupBy(): GroupBy {
  try {
    const saved = localStorage.getItem("library-group-by");
    return saved === "loader" || saved === "version" || saved === "none" ? saved : "groups";
  } catch {
    return "groups";
  }
}

const toolbarSelect: React.CSSProperties = {
  padding: "11px 12px",
  borderRadius: 10,
  border: "1px solid #3f3f46",
  background: "#1b1b1b",
  color: "white",
  fontSize: 14,
  fontFamily: "var(--sans)",
};

function Library({ onBack, goHome, goMinecraft, goDiscover, goLibrary, goSkinSelector, goSettings }: Props) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [groupBy, setGroupBy] = useState<GroupBy>(readGroupBy);
  const [storageUsed, setStorageUsed] = useState(0);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [groups, setGroups] = useState<Record<string, string[]>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // The instance being managed, which takes over the page.
  const [open, setOpen] = useState<string | null>(null);
  // Ticked instances, for the bar at the bottom.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // The instance whose Play was pressed, until Minecraft has started.
  const [starting, setStarting] = useState<string | null>(null);
  // Making or importing an instance takes over the list, under the same sidebar.
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ tone: "bad" | "good"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadInstances() {
    try {
      const data = await window.instanceAPI.list();
      setInstances(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load instances:", err);
      setInstances([]);
    }
  }

  useEffect(() => {
    window.instanceAPI
      .list()
      .then((data) => setInstances(Array.isArray(data) ? data : []))
      .catch(() => setInstances([]));
    window.instanceAPI
      .getSettings()
      .then((settings) => setGroups(settings.instanceGroups ?? {}))
      .catch(() => {});
    window.launcherAPI
      .getInstancesStorage()
      .then(setStorageUsed)
      .catch(() => {});
  }, []);

  // A second press of Delete is needed within a few seconds.
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

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
    () => instances.filter((instance) => instance.name.toLowerCase().includes(search.trim().toLowerCase())).sort(SORTS[sort]),
    [instances, search, sort]
  );

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
      setMessage({ tone: "bad", text: err instanceof Error ? err.message : String(err) });
    }
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

  async function play(name: string) {
    if (starting) return;
    setStarting(name);
    setMessage(null);
    try {
      await window.instanceAPI.launch(name);
      loadInstances();
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof Error ? err.message : String(err) });
    }
    setStarting(null);
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
        failed.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setBusy(false);
    setPicked(new Set());
    await loadInstances();
    window.launcherAPI.getInstancesStorage().then(setStorageUsed).catch(() => {});
    const done = list.length - failed.length;
    setMessage(
      failed.length
        ? { tone: "bad", text: `Couldn't delete ${failed.join("; ")}` }
        : { tone: "good", text: `Deleted ${done === 1 ? list[0] : `${done} instances`}.` }
    );
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

  function addToGroup(group: string) {
    saveGroups({ ...groups, [group]: [...new Set([...(groups[group] ?? []), ...picked])] });
    setPicked(new Set());
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

  // Managing one instance takes over the content area, keeping the sidebar in place.
  if (open) {
    // The sidebar's Back and Library both lead back to the list of instances.
    const backToList = () => {
      setOpen(null);
      loadInstances();
    };
    return (
      <div style={{ display: "flex", height: "100vh", background: "#0d0d0d", color: "white", fontFamily: "'Orbitron', sans-serif" }}>
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

        <div style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden", display: "flex" }}>
          <BackgroundLogo />
          <InstanceDetail instanceName={open} onBack={backToList} />
        </div>
      </div>
    );
  }

  const selecting = picked.size > 0;
  const groupNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  const menuGroups = menu ? Object.keys(liveGroups).filter((group) => liveGroups[group].includes(menu.name)) : [];

  const tile = (instance: Instance) => {
    const on = picked.has(instance.name);
    const isStarting = starting === instance.name;
    return (
      <div
        key={instance.name}
        className={`lib-tile${on ? " selected" : ""}`}
        data-testid="instance-card"
        role="button"
        tabIndex={0}
        title={instance.name}
        aria-label={selecting ? `${on ? "Untick" : "Tick"} ${instance.name}` : `Open ${instance.name}`}
        onClick={(event) => {
          if (selecting || event.metaKey || event.ctrlKey || event.shiftKey) toggle(instance.name);
          else setOpen(instance.name);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenu({ name: instance.name, x: Math.min(event.clientX, window.innerWidth - 210), y: Math.min(event.clientY, window.innerHeight - 260) });
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          if (selecting) toggle(instance.name);
          else setOpen(instance.name);
        }}
      >
        <div className="lib-icon">
          <Box size="58%" strokeWidth={1.4} aria-hidden="true" />
          <button
            type="button"
            className={`lib-select${on ? " on" : ""}`}
            aria-pressed={on}
            aria-label={on ? `Untick ${instance.name}` : `Tick ${instance.name}`}
            data-tip={on ? "Deselect instance" : "Select instance"}
            onClick={(event) => {
              event.stopPropagation();
              toggle(instance.name);
            }}
          >
            {on && <Check size={15} strokeWidth={3} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className={`lib-play${isStarting ? " busy" : ""}`}
            data-testid="quick-play"
            aria-label={isStarting ? `Starting ${instance.name}` : `Play ${instance.name}`}
            data-tip={instance.installed ? "Play" : "Finish installing it and play"}
            aria-disabled={Boolean(starting) || undefined}
            onClick={(event) => {
              event.stopPropagation();
              play(instance.name);
            }}
          >
            {isStarting ? <Loader2 size={20} className="lib-spin" aria-hidden="true" /> : <Play size={20} fill="currentColor" aria-hidden="true" />}
          </button>
        </div>
        <div className="lib-name">{instance.name}</div>
        <div className="lib-sub" style={instance.installed ? undefined : { color: "#fcd34d" }}>
          {instance.installed ? subtitle(instance) : `${subtitle(instance)} • not installed`}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "#0d0d0d", color: "white", fontFamily: "'Orbitron', sans-serif" }}>
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

      <div style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden" }}>
        <BackgroundLogo />

        <div
          className={selecting ? "lib-selecting" : undefined}
          style={{
            position: "relative",
            zIndex: 1,
            padding: "35px",
            paddingBottom: selecting ? 110 : 35,
            height: "100%",
            overflowY: "auto",
            // Padding inside the height, so the bottom of the page can be scrolled to.
            boxSizing: "border-box",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <h1 style={{ color: "#c084fc", margin: 0 }}>{creating ? "New Instance" : "Library"}</h1>
              <p style={{ color: "#9ca3af", margin: "8px 0 0", fontFamily: "var(--sans)", fontSize: 15 }}>
                {creating
                  ? "Make a new instance, or bring one in from elsewhere."
                  : `${instances.length} instance${instances.length === 1 ? "" : "s"} • ${formatBytes(storageUsed)} on disk`}
              </p>
            </div>
            {!creating && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", whiteSpace: "nowrap" }}>
                <IconButton tip="Look for instances again" label="Refresh" onClick={loadInstances}>
                  <RefreshIcon size={18} />
                </IconButton>
                <button className="sidebar-button" onClick={() => setCreating(true)} data-tip="Import from another launcher, a folder, a zip or your cloud folder">
                  Import
                </button>
                <button className="sidebar-button" style={{ background: "#7c3aed", display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setCreating(true)}>
                  <Plus size={16} aria-hidden="true" /> New Instance
                </button>
              </div>
            )}
          </div>

          {creating ? (
            <>
              <button className="sidebar-button" style={{ marginBottom: 25 }} onClick={() => setCreating(false)}>
                ← Back to Library
              </button>
              <CreateInstancePanel
                onCancel={() => setCreating(false)}
                onDone={() => {
                  setCreating(false);
                  loadInstances();
                }}
              />
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search instances..."
                  style={{
                    flex: "1 1 240px",
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: "1px solid #6d28d9",
                    background: "#1b1b1b",
                    color: "white",
                    fontSize: 15,
                    fontFamily: "var(--sans)",
                    boxSizing: "border-box",
                  }}
                />
                <select style={toolbarSelect} aria-label="Sort instances" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="name">Sort: Name</option>
                  <option value="lastPlayed">Sort: Last played</option>
                  <option value="version">Sort: Version</option>
                  <option value="added">Sort: Recently added</option>
                </select>
                <select style={toolbarSelect} aria-label="Group instances" value={groupBy} onChange={(e) => chooseGroupBy(e.target.value as GroupBy)}>
                  <option value="groups">Group: Your groups</option>
                  <option value="loader">Group: Loader</option>
                  <option value="version">Group: Version</option>
                  <option value="none">Group: None</option>
                </select>
              </div>

              {message && (
                <div
                  style={{
                    marginTop: 16,
                    padding: "10px 14px",
                    borderRadius: 10,
                    fontFamily: "var(--sans)",
                    fontSize: 14,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    background: message.tone === "bad" ? "rgba(127, 29, 29, 0.35)" : "rgba(20, 83, 45, 0.35)",
                    border: `1px solid ${message.tone === "bad" ? "#b91c1c" : "#15803d"}`,
                    color: message.tone === "bad" ? "#fecaca" : "#bbf7d0",
                  }}
                >
                  <span style={{ flex: 1 }}>{message.text}</span>
                  <button onClick={() => setMessage(null)} aria-label="Dismiss" style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", display: "flex" }}>
                    <X size={16} />
                  </button>
                </div>
              )}

              {!instances.length ? (
                <div style={{ marginTop: 40, color: "#9ca3af", fontFamily: "var(--sans)", textAlign: "center" }}>
                  <Box size={48} strokeWidth={1.4} style={{ opacity: 0.6 }} />
                  <p>No instances yet. Make one, or import one from another launcher.</p>
                </div>
              ) : !shown.length ? (
                <p style={{ marginTop: 30, color: "#9ca3af", fontFamily: "var(--sans)" }}>No instances match "{search}".</p>
              ) : (
                sections.map((section) => {
                  const folded = section.title !== null && collapsed.has(section.id);
                  const userGroup = section.id.startsWith("g:") ? section.id.slice(2) : null;
                  return (
                    <div key={section.id} style={section.title === null ? { marginTop: 24 } : undefined}>
                      {section.title !== null && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            type="button"
                            className="lib-section"
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
                            {folded ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                            {section.title}
                            <span className="lib-count">{section.items.length}</span>
                          </button>
                          {userGroup && (
                            <button
                              type="button"
                              data-tip="Delete this group (its instances stay)"
                              aria-label={`Delete the group ${userGroup}`}
                              onClick={() => deleteGroup(userGroup)}
                              style={{ marginTop: 14, background: "none", border: "none", color: "#6b7280", cursor: "pointer", display: "flex", padding: 4 }}
                            >
                              <X size={15} />
                            </button>
                          )}
                        </div>
                      )}
                      {!folded && <div className="lib-grid">{section.items.map(tile)}</div>}
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>

        {/* What can be done with the ticked instances. */}
        {selecting && !creating && (
          <div className="lib-bar" role="toolbar" aria-label="Ticked instances" data-testid="library-bar">
            <span style={{ padding: "0 10px", fontWeight: 700, fontSize: 16 }}>{picked.size} selected</span>
            <span className="lib-sep" />
            {naming !== null ? (
              <>
                <input
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
                  <CircleCheck size={18} /> Make group
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
                <span style={{ flex: 1, minWidth: 20 }} />
                {groupNames.length > 0 && (
                  <select
                    aria-label="Add to a group"
                    value=""
                    onChange={(e) => e.target.value && addToGroup(e.target.value)}
                    style={{ appearance: "none" }}
                  >
                    <option value="">Add to group...</option>
                    {groupNames.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                )}
                <button onClick={() => setNaming("")}>
                  <SquarePlus size={18} /> New group
                </button>
                <span className="lib-sep" />
                <button className={`lib-danger${confirmDelete ? " confirming" : ""}`} onClick={deletePicked} disabled={busy}>
                  <BinIcon size={18} /> {busy ? "Deleting..." : confirmDelete ? `Click again to delete ${picked.size === 1 ? "it" : `all ${picked.size}`}` : "Delete"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {menu && (
        <div className="lib-menu" style={{ left: menu.x, top: menu.y }} role="menu" onClick={(e) => e.stopPropagation()}>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(null);
              play(menu.name);
            }}
          >
            <Play size={15} /> Play
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(null);
              setOpen(menu.name);
            }}
          >
            <Box size={15} /> Open
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(null);
              window.instanceAPI.openFolder(menu.name).catch(() => {});
            }}
          >
            <Folder size={15} /> Open folder
          </button>
          <hr />
          <button
            role="menuitem"
            onClick={() => {
              setMenu(null);
              toggle(menu.name);
            }}
          >
            <CircleCheck size={15} /> {picked.has(menu.name) ? "Deselect" : "Select"}
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
              <FolderMinus size={15} /> Remove from {group}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default Library;
