import { useEffect, useState } from "react";
import ContentFilter from "./ContentFilter";
import { ALL_TYPES, NO_FILTERS, activeFilterCount, type FilterCounts, type Filters } from "./contentFilters";
import { BinIcon, FilterIcon, PlusIcon, SearchIcon } from "./Icons";
import Toggle from "./Toggle";
import { ItemUpdateStatus, UpdatesControls, UpdatesMessages } from "./UpdatesBar";
import type { ContentUpdates } from "./useContentUpdates";
import VersionPicker from "./VersionPicker";

type Props = {
  instanceName: string;
  mcVersion: string;
  content: InstanceContent;
  updates: ContentUpdates;
  /** The item a change is running for, if any. */
  busyKey: string | null;
  targetWorld: string;
  onToggle: (item: InstanceMod) => void;
  onDelete: (item: InstanceMod) => void;
  onAddToWorld: (item: InstanceMod, world: string) => void;
  onAddContent: () => void;
};

type Details = Awaited<ReturnType<typeof window.instanceAPI.contentDetails>>;

const TYPE_BADGE: Partial<Record<ContentType, string>> = { resourcepack: "Resource pack", shader: "Shader", datapack: "Data pack" };
const SOURCE_LABEL: Record<string, string> = { modrinth: "Modrinth", curseforge: "CurseForge", github: "GitHub" };

const contentKey = (item: { type: ContentType; world?: string | null; fileName: string }) => `${item.type}/${item.world ?? ""}/${item.fileName}`;

function formatBytes(bytes: number) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

const countBy = (values: (string | null | undefined)[]) => {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
};

/* An instance's mods, resource packs, shaders and data packs: searchable, filterable, one thin card each. */
export default function InstanceContentList({ instanceName, mcVersion, content, updates, busyKey, targetWorld, onToggle, onDelete, onAddToWorld, onAddContent }: Props) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [showFilter, setShowFilter] = useState(false);
  // The item whose versions are being chosen from.
  const [picking, setPicking] = useState<{ key: string; name: string; icon: string | null; suggested?: string } | null>(null);

  // Icons and authors from inside the files; fetched again when files are added or removed.
  const files = ALL_TYPES.flatMap(({ type }) => content[type].map(contentKey)).sort().join("|");
  const [details, setDetails] = useState<Details>({});
  useEffect(() => {
    if (!files) return;
    let current = true;
    window.instanceAPI
      .contentDetails(instanceName)
      .then((found) => current && setDetails(found))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [instanceName, files]);

  const all = ALL_TYPES.flatMap(({ type }) => content[type]).map((item) => {
    const status = item.kind === "file" ? updates.statusOf(item) : null;
    const own = details[contentKey(item)];
    return {
      item,
      key: contentKey(item),
      status,
      name: status?.name ?? item.name,
      icon: item.iconUrl ?? status?.iconUrl ?? own?.icon ?? null,
      author: status?.author ?? own?.authors[0] ?? null,
      version: item.versionNumber ?? status?.current ?? null,
      // Where it came from, or else whether Modrinth knows it (found by its hash).
      source: SOURCE_LABEL[item.source ?? ""] ?? (status && status.state !== "unknown" ? "Modrinth" : "Not on Modrinth or CurseForge"),
      updateState: item.kind === "file" ? (status?.state ?? null) : ("unknown" as const),
    };
  });

  const counts: FilterCounts = {
    types: Object.fromEntries(ALL_TYPES.map(({ type }) => [type, content[type].length])),
    authors: [...countBy(all.map((entry) => entry.author)).entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" })),
    state: Object.fromEntries(countBy(all.map((entry) => (entry.item.enabled ? "on" : "off")))),
    updates: Object.fromEntries(countBy(all.map((entry) => entry.updateState))),
    sources: [...countBy(all.map((entry) => entry.source)).entries()].sort((a, b) => b[1] - a[1]),
  };

  const query = search.trim().toLowerCase();
  const shown = all
    .filter(
      (entry) =>
        filters.types.includes(entry.item.type) &&
        (!filters.authors.length || (entry.author !== null && filters.authors.includes(entry.author))) &&
        (!filters.state.length || filters.state.includes(entry.item.enabled ? "on" : "off")) &&
        (!filters.updates.length || (entry.updateState !== null && filters.updates.includes(entry.updateState))) &&
        (!filters.sources.length || filters.sources.includes(entry.source)) &&
        (!query || `${entry.name} ${entry.item.fileName} ${entry.author ?? ""}`.toLowerCase().includes(query))
    )
    .sort((a, b) => {
      if (filters.sort === "recent") return Date.parse(b.item.installedAt ?? b.item.modified ?? "0") - Date.parse(a.item.installedAt ?? a.item.modified ?? "0");
      if (filters.sort === "size") return (b.item.size ?? 0) - (a.item.size ?? 0);
      if (filters.sort === "updates") {
        const rank = (entry: typeof a) => (entry.updateState === "update" ? 0 : 1);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

  const active = activeFilterCount(filters);
  const narrowed = Boolean(query) || active > 0;

  return (
    <div style={{ textAlign: "left" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <label
          style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 220px", maxWidth: 340, padding: "6px 10px", borderRadius: 10, background: "var(--color-surface-sunken)", border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}
        >
          <SearchIcon size={14} />
          <input
            data-testid="content-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${all.length} items...`}
            aria-label="Search this instance's content"
            style={{ flex: 1, minWidth: 0, background: "none", border: "none", outline: "none", color: "var(--color-text)", fontSize: 13 }}
          />
          {search && (
            <button aria-label="Clear search" onClick={() => setSearch("")} style={{ background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer", padding: 0, fontSize: 15 }}>
              ×
            </button>
          )}
        </label>

        <button
          className="sidebar-button"
          data-testid="filter-button"
          onClick={() => setShowFilter(true)}
          style={{ padding: "6px 12px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6, background: active ? "var(--color-accent-subtle)" : undefined }}
        >
          <FilterIcon size={14} />
          Filter{active ? ` (${active})` : ""}
        </button>

        <button className="sidebar-button" data-testid="add-content" onClick={onAddContent} style={{ padding: "6px 12px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <PlusIcon size={14} />
          Add Content
        </button>

        <UpdatesControls updates={updates} />
      </div>

      <UpdatesMessages updates={updates} />

      {narrowed && all.length > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", color: "var(--color-text-muted)", fontSize: 12, marginBottom: 10 }}>
          Showing {shown.length} of {all.length}
          <button
            onClick={() => {
              setSearch("");
              setFilters({ ...NO_FILTERS, sort: filters.sort });
            }}
            style={{ background: "none", border: "none", color: "var(--color-accent-text)", cursor: "pointer", fontSize: 12, padding: 0 }}
          >
            Show everything
          </button>
        </div>
      )}

      {all.length === 0 ? (
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: 16, color: "var(--color-text-muted)" }}>
          Nothing here yet. Use <b>Add Content</b> to find mods, resource packs and shaders that work on Minecraft {mcVersion}.
        </div>
      ) : shown.length === 0 ? (
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: 16, color: "var(--color-text-muted)" }}>Nothing matches your search or filters.</div>
      ) : (
        <div data-testid="content-list" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {shown.map(({ item, key, status, name, icon, author, version }) => (
            <div
              key={key}
              data-testid="content-item"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "7px 12px",
                background: "var(--color-surface)",
                border: `1px solid ${item.enabled ? "var(--color-border)" : "var(--color-border)"}`,
                borderRadius: 10,
                opacity: item.enabled ? 1 : 0.55,
                // Turned off: the whole item goes grey.
                filter: item.enabled ? undefined : "grayscale(1)",
              }}
            >
              {icon ? (
                <img src={icon} alt="" width={36} height={36} style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", flexShrink: 0, imageRendering: "auto" }} />
              ) : (
                <div
                  aria-hidden="true"
                  style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0, background: "var(--color-accent-subtle)", color: "var(--color-accent-text)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}
                >
                  {name.charAt(0).toUpperCase()}
                </div>
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span title={item.fileName} style={{ color: "var(--color-accent-text)", fontWeight: 600, fontSize: 14, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}
                  </span>
                  {TYPE_BADGE[item.type] && (
                    <span style={{ flexShrink: 0, fontSize: 10, color: "var(--color-accent-text)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "1px 6px" }}>{TYPE_BADGE[item.type]}</span>
                  )}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.35, color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[
                    author && `by ${author}`,
                    version && (
                      <span key="version">
                        {version}
                        {status?.state === "update" && <span style={{ color: "var(--color-success-text)" }}> → {status.latest}</span>}
                      </span>
                    ),
                    formatBytes(item.size),
                    item.type === "datapack" ? (item.world ? `World: ${item.world}` : "Not in a world yet") : null,
                    item.enabled ? null : "off",
                  ]
                    .filter(Boolean)
                    .map((part, i) => (
                      <span key={i}>
                        {i > 0 && " · "}
                        {part}
                      </span>
                    ))}
                </div>
              </div>

              {item.type === "datapack" && !item.world && content.worlds.length > 0 && (
                <button className="sidebar-button" disabled={busyKey === key} onClick={() => onAddToWorld(item, targetWorld || content.worlds[0])} style={{ padding: "5px 10px", fontSize: 12 }}>
                  Add to {targetWorld || content.worlds[0]}
                </button>
              )}

              <ItemUpdateStatus
                item={item}
                updates={updates}
                onPick={() => setPicking({ key: `${item.type}/${item.fileName}`, name, icon, suggested: status?.state === "update" ? status.latest : undefined })}
              />

              {item.kind === "file" && (
                <Toggle on={item.enabled} disabled={busyKey === key} onChange={() => onToggle(item)} label={`${item.enabled ? "Turn off" : "Turn on"} ${name}`} />
              )}

              <button
                data-testid="item-delete"
                className="bin-button"
                title={`Delete ${name}`}
                aria-label={`Delete ${name}`}
                disabled={busyKey === key}
                onClick={() => onDelete(item)}
              >
                <BinIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      {picking && (
        <VersionPicker
          instanceName={instanceName}
          itemKey={picking.key}
          name={picking.name}
          icon={picking.icon}
          suggested={picking.suggested}
          onDone={updates.finish}
          onClose={() => setPicking(null)}
        />
      )}

      {showFilter && <ContentFilter filters={filters} counts={counts} matching={shown.length} onChange={setFilters} onClose={() => setShowFilter(false)} />}
    </div>
  );
}
