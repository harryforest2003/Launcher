import { useCallback, useEffect, useState } from "react";
import { Download, ExternalLink, FileArchive, FolderOpen, Globe, Link2, RefreshCw } from "lucide-react";
import { Badge, Button, EmptyState, Notice, ProgressBar, SearchField, Segmented, Select } from "./ui";
import Pagination from "./Pagination";
import "./instanceWorlds.css";

type Props = { instanceName: string; mcVersion: string };
type View = "yours" | "find";
type Sort = NonNullable<WorldSearchOptions["sort"]>;

// CurseForge's world categories (electron/minecraft/worlds.cjs keeps the same list).
const CATEGORIES = [
  { id: 248, name: "Adventure" },
  { id: 249, name: "Creation" },
  { id: 250, name: "Game Map" },
  { id: 251, name: "Parkour" },
  { id: 252, name: "Puzzle" },
  { id: 253, name: "Survival" },
  { id: 4464, name: "Modded World" },
];

const SORTS: { value: Sort; label: string }[] = [
  { value: "popular", label: "Popular" },
  { value: "downloads", label: "Most downloaded" },
  { value: "updated", label: "Recently updated" },
  { value: "newest", label: "Newest" },
];

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/* What was added, in one line, with anything that might stop it opening. */
function addedNote(added: AddedWorld[], mcVersion: string): { tone: "success" | "warning"; text: string } {
  const names = added.map((w) => `"${w.name}"`).join(", ");
  const lead = `Added ${names}. ${added.length === 1 ? "It's" : "They're"} in Singleplayer next time you play.`;
  const newer = added.find((w) => w.newer);
  if (newer) {
    return {
      tone: "warning",
      text: `${lead} "${newer.name}" was saved in Minecraft ${newer.version}, newer than this instance's ${mcVersion}: opening it here can lose blocks or fail. Back it up first, or play it in an instance on ${newer.version}.`,
    };
  }
  const other = added.find((w) => w.madeFor);
  if (other) {
    return { tone: "warning", text: `${lead} It has no version for Minecraft ${mcVersion}, so this is the one made for ${other.madeFor}.` };
  }
  return { tone: "success", text: lead };
}

/* An instance's worlds: the ones it has, adding more from this computer or a link, and finding them on CurseForge. */
export default function InstanceWorlds({ instanceName, mcVersion }: Props) {
  const [view, setView] = useState<View>("yours");
  const [worlds, setWorlds] = useState<InstanceWorld[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [busy, setBusy] = useState<{ label: string; value: number | null; detail: string } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");

  const load = useCallback(() => {
    window.instanceAPI
      .worlds(instanceName)
      .then((list) => {
        setWorlds(list);
        setError(null);
      })
      .catch((err) => setError(message(err)));
  }, [instanceName]);

  useEffect(load, [load]);

  useEffect(
    () =>
      window.instanceAPI.onWorldProgress?.((progress) => {
        if (progress.name !== instanceName) return;
        setBusy((now) => (now ? { ...now, value: progress.value, detail: progress.detail } : now));
      }),
    [instanceName]
  );

  /* Runs one import at a time, then says what came of it. */
  const run = async (label: string, work: () => Promise<AddedWorld[] | null>) => {
    if (busy) return false;
    setBusy({ label, value: null, detail: "Starting" });
    setError(null);
    setNote(null);
    try {
      const added = await work();
      if (!added) return false;
      setNote(addedNote(added, mcVersion));
      load();
      return true;
    } catch (err) {
      setError(message(err));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const act = async (request: Parameters<typeof window.instanceAPI.fileAction>[1]) => {
    try {
      await window.instanceAPI.fileAction(instanceName, request);
      if (request.action === "trash") load();
    } catch (err) {
      setError(message(err));
    }
  };

  const addLink = async () => {
    const url = link.trim();
    if (!url) return;
    if (await run("Downloading the world", () => window.instanceAPI.importWorldLink(instanceName, url))) {
      setLink("");
      setLinkOpen(false);
    }
  };

  return (
    <div data-testid="worlds-tab" className="worlds">
      <div className="worlds__bar">
        <Segmented<View>
          label="Worlds"
          value={view}
          onChange={setView}
          options={[
            { value: "yours", label: worlds ? `In this instance · ${worlds.length}` : "In this instance" },
            { value: "find", label: "Find worlds" },
          ]}
        />
        {view === "yours" && (
          <div className="worlds__actions">
            <Button size="sm" icon={<FileArchive size={15} />} disabled={!!busy} onClick={() => run("Importing the world", () => window.instanceAPI.importWorldFile(instanceName))}>
              Import .zip
            </Button>
            <Button size="sm" icon={<FolderOpen size={15} />} disabled={!!busy} onClick={() => run("Copying the world", () => window.instanceAPI.importWorldFolder(instanceName))}>
              Import folder
            </Button>
            <Button size="sm" icon={<Link2 size={15} />} disabled={!!busy} aria-expanded={linkOpen} onClick={() => setLinkOpen((open) => !open)}>
              From a link
            </Button>
            <Button size="sm" variant="ghost" onClick={() => act({ kind: "world", action: "folder" })}>
              Open folder
            </Button>
            <Button size="sm" variant="ghost" icon={<RefreshCw size={15} />} aria-label="Refresh" title="Refresh" onClick={load} />
          </div>
        )}
      </div>

      {view === "yours" && linkOpen && (
        <form
          className="worlds__link"
          onSubmit={(e) => {
            e.preventDefault();
            addLink();
          }}
        >
          <label className="worlds__link-label" htmlFor={`world-link-${instanceName}`}>
            A link straight to a world's .zip (Dropbox, GitHub, a map's own site)
          </label>
          <div className="worlds__link-row">
            <input
              id={`world-link-${instanceName}`}
              className="ui-input worlds__input"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={link}
              autoFocus
              disabled={!!busy}
              onChange={(e) => setLink(e.target.value)}
            />
            <Button type="submit" variant="primary" size="sm" disabled={!!busy || !link.trim()}>
              Add world
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {busy && (
        <div className="worlds__progress">
          <ProgressBar value={busy.value ?? undefined} label={`${busy.label}: ${busy.detail}`} showValue={busy.value !== null} />
          <span className="worlds__progress-text">
            {busy.label} · {busy.detail}
          </span>
        </div>
      )}

      {error && (
        <Notice tone="danger" className="worlds__notice">
          {error}
        </Notice>
      )}
      {note && (
        <Notice tone={note.tone} className="worlds__notice" actions={view === "find" ? <Button size="sm" variant="ghost" onClick={() => setView("yours")}>See worlds</Button> : undefined}>
          {note.text}
        </Notice>
      )}

      {view === "yours" ? (
        <YourWorlds worlds={worlds} onAct={act} onFind={() => setView("find")} />
      ) : (
        <FindWorlds
          instanceName={instanceName}
          mcVersion={mcVersion}
          busy={!!busy}
          onInstall={(world) => run(`Adding "${world.name}"`, () => window.instanceAPI.installWorld(instanceName, world.id))}
        />
      )}
    </div>
  );
}

function YourWorlds({
  worlds,
  onAct,
  onFind,
}: {
  worlds: InstanceWorld[] | null;
  onAct: (request: Parameters<typeof window.instanceAPI.fileAction>[1]) => void;
  onFind: () => void;
}) {
  if (!worlds) return <p className="worlds__muted">Loading…</p>;

  if (!worlds.length) {
    return (
      <EmptyState
        icon={<Globe size={28} />}
        title="No worlds yet"
        body="Worlds you play appear here. You can also import one from a .zip or folder, paste a download link, or find adventure maps, parkour and survival worlds on CurseForge."
        actions={
          <Button variant="primary" icon={<Download size={16} />} onClick={onFind}>
            Find worlds
          </Button>
        }
      />
    );
  }

  return (
    <ul className="worlds__list">
      {worlds.map((world) => (
        <li key={world.folder} data-testid="world" className="worlds__item">
          {world.icon ? <img src={world.icon} alt="" width={56} height={56} className="worlds__icon worlds__icon--pixel" /> : <div className="worlds__icon" aria-hidden="true" />}

          <div className="worlds__body">
            <div className="worlds__name">{world.name}</div>
            <div className="worlds__meta">
              {[world.hardcore ? "Hardcore" : world.gameMode, world.cheats ? "Cheats on" : null, world.version ? `Minecraft ${world.version}` : null].filter(Boolean).join(" · ")}
            </div>
            <div className="worlds__meta worlds__meta--small">
              Last played {new Date(world.lastPlayed).toLocaleString()} · {formatBytes(world.size)}
              {world.folder !== world.name ? ` · folder "${world.folder}"` : ""}
            </div>
          </div>

          <div className="worlds__item-actions">
            <Button size="sm" variant="ghost" onClick={() => onAct({ kind: "world", name: world.folder, action: "show" })}>
              Show files
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (window.confirm(`Move "${world.name}" to the Bin? You can get it back from there.`)) {
                  onAct({ kind: "world", name: world.folder, action: "trash" });
                }
              }}
            >
              Move to Bin
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function FindWorlds({
  instanceName,
  mcVersion,
  busy,
  onInstall,
}: {
  instanceName: string;
  mcVersion: string;
  busy: boolean;
  onInstall: (world: WorldListing) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");
  const [category, setCategory] = useState<number | null>(null);
  const [sort, setSort] = useState<Sort>("popular");
  const [anyVersion, setAnyVersion] = useState(false);
  const [page, setPage] = useState(1);
  const [found, setFound] = useState<WorldSearch | null>(null);
  // Which search last finished, and how; a search is loading until its own answer is in.
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const searchKey = JSON.stringify([instanceName, query, category, sort, anyVersion, page]);
  const loading = settled?.key !== searchKey;
  const error = settled?.key === searchKey ? settled.error : null;

  // Typing settles for a moment before it searches.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(typed.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [typed]);

  useEffect(() => {
    let live = true;
    window.instanceAPI
      .searchWorlds(instanceName, { query, category, sort, anyVersion, page: page - 1 })
      .then((result) => {
        if (!live) return;
        setFound(result);
        setSettled({ key: searchKey, error: null });
      })
      .catch((err) => {
        if (live) setSettled({ key: searchKey, error: message(err) });
      });
    return () => {
      live = false;
    };
  }, [instanceName, query, category, sort, anyVersion, page, searchKey]);

  const pageCount = found ? Math.max(1, Math.ceil(found.total / found.pageSize)) : 1;

  return (
    <div className="worlds__find">
      <div className="worlds__filters">
        <SearchField label="Search worlds" placeholder="Search CurseForge's worlds" value={typed} onChange={(e) => setTyped(e.target.value)} wrapperClassName="worlds__search" />
        <Select
          size="sm"
          aria-label="Category"
          value={category ?? ""}
          onChange={(e) => {
            setCategory(e.target.value ? Number(e.target.value) : null);
            setPage(1);
          }}
        >
          <option value="">Every kind</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          size="sm"
          aria-label="Sort by"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as Sort);
            setPage(1);
          }}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <label className="worlds__check">
          <input
            type="checkbox"
            checked={!anyVersion}
            onChange={(e) => {
              setAnyVersion(!e.target.checked);
              setPage(1);
            }}
          />
          Only for Minecraft {mcVersion}
        </label>
      </div>

      <p className="worlds__muted worlds__source">
        {found && !loading ? `${found.total.toLocaleString()}${found.total >= 10000 ? "+" : ""} worlds on CurseForge` : "Worlds on CurseForge"}
        {anyVersion ? ", for every version. A world from a newer Minecraft may not open here." : `, made for Minecraft ${mcVersion}.`}
      </p>

      {error && <Notice tone="danger" className="worlds__notice">{error}</Notice>}

      {loading && !found ? (
        <p className="worlds__muted">Searching…</p>
      ) : found && found.results.length === 0 && !loading ? (
        <EmptyState
          size="compact"
          title={query ? `No worlds match "${query}"` : "No worlds here"}
          body={anyVersion ? "Try other words or another category." : `Few worlds list Minecraft ${mcVersion} exactly. Untick "Only for Minecraft ${mcVersion}" to see the rest.`}
        />
      ) : (
        <ul className="worlds__list" aria-busy={loading}>
          {found?.results.map((world) => {
            const done = added.has(world.id);
            return (
              <li key={world.id} data-testid="world-result" className="worlds__item">
                {world.icon ? <img src={world.icon} alt="" width={56} height={56} loading="lazy" className="worlds__icon" /> : <div className="worlds__icon" aria-hidden="true" />}
                <div className="worlds__body">
                  <div className="worlds__name">
                    {world.name}
                    {world.author && <span className="worlds__by"> by {world.author}</span>}
                  </div>
                  {world.summary && <div className="worlds__summary">{world.summary}</div>}
                  <div className="worlds__meta worlds__meta--small">
                    {compact.format(world.downloads)} downloads
                    {world.versions.length ? ` · Minecraft ${world.versions.slice(0, 3).join(", ")}${world.versions.length > 3 ? "…" : ""}` : ""}
                    {world.updated ? ` · updated ${new Date(world.updated).toLocaleDateString()}` : ""}
                  </div>
                  {world.categories.length > 0 && (
                    <div className="worlds__tags">
                      {world.categories.slice(0, 3).map((c) => (
                        <Badge key={c}>{c}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="worlds__item-actions">
                  {world.url && (
                    <a className="worlds__site" href={world.url} target="_blank" rel="noopener noreferrer" title="Its page on CurseForge" aria-label={`${world.name} on CurseForge`}>
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  )}
                  {done ? (
                    <Button size="sm" disabled>
                      Added
                    </Button>
                  ) : world.installable ? (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Download size={15} />}
                      disabled={busy}
                      onClick={async () => {
                        setAdding(world.id);
                        if (await onInstall(world)) setAdded((now) => new Set(now).add(world.id));
                        setAdding(null);
                      }}
                    >
                      {adding === world.id ? "Adding…" : "Add world"}
                    </Button>
                  ) : (
                    world.url && (
                      <a className="ui-button ui-button--secondary ui-button--sm" href={world.url} target="_blank" rel="noopener noreferrer" title="Its author only allows downloads from CurseForge's site. Download it there, then use Import .zip.">
                        Get on CurseForge
                      </a>
                    )
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination page={page} pageCount={pageCount} disabled={loading} onChange={setPage} />
    </div>
  );
}
