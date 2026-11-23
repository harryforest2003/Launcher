import { useEffect, useMemo, useState } from "react";
import { Badge, EmptyState, Monogram, Notice, SearchField, Select, Skeleton } from "./ui";
import { CHANNEL, channelOf, defaultVersion, newestFirst, versionLabel, type PackVersion } from "./packVersions";
import "./packContents.css";

type Props = {
  source: "modrinth" | "curseforge";
  projectId: string;
  versions: PackVersion[];
  /** Opens a mod's own page, for the ones on a mod site. */
  openProject: (source: "modrinth" | "curseforge", id: string) => void;
};

type Kind = PackItem["kind"];

const GROUPS: { kind: Kind; label: string; one: string }[] = [
  { kind: "mod", label: "Mods", one: "mod" },
  { kind: "resourcepack", label: "Resource packs", one: "resource pack" },
  { kind: "shader", label: "Shaders", one: "shader" },
  { kind: "datapack", label: "Data packs", one: "data pack" },
  { kind: "other", label: "Other files", one: "other file" },
];

const SIDE_LABEL: Record<string, string> = { client: "Client only", server: "Server only" };

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/*
 * Everything in one version of a modpack, read from the pack's own file list: its mods,
 * resource packs, shaders and data packs, each opening its own page when it's on a mod site.
 */
export default function PackContentsList({ source, projectId, versions, openProject }: Props) {
  const sorted = useMemo(() => newestFirst(versions), [versions]);
  // null until one is chosen: the version Install would pick until then.
  const [chosen, setChosen] = useState<string | null>(null);
  const versionId = chosen ?? (defaultVersion(sorted) ? String(defaultVersion(sorted)!.id) : null);
  const [found, setFound] = useState<{ id: string; contents?: PackContents; error?: string } | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!versionId) return;
    let current = true;
    window.launcherAPI
      .packContents(source, projectId, versionId)
      .then((contents) => current && setFound({ id: versionId, contents }))
      .catch((err) => current && setFound({ id: versionId, error: message(err) }));
    return () => {
      current = false;
    };
  }, [source, projectId, versionId]);

  if (!sorted.length) {
    return <EmptyState size="compact" title="No versions listed" body="Open the pack's site to see what's in it." />;
  }

  const loading = found?.id !== versionId;
  const items = (!loading && found?.contents?.items) || [];
  const query = search.trim().toLowerCase();
  const matching = query
    ? items.filter((item) => `${item.name} ${item.fileName ?? ""} ${item.summary ?? ""}`.toLowerCase().includes(query))
    : items;
  const groups = GROUPS.map((group) => ({ ...group, items: matching.filter((item) => item.kind === group.kind) })).filter((g) => g.items.length);
  const totals = GROUPS.map((group) => ({ ...group, count: items.filter((item) => item.kind === group.kind).length })).filter((g) => g.count);

  return (
    <div className="pc">
      <div className="pc-bar">
        <label className="pc-version">
          <span>Version</span>
          <Select size="sm" value={versionId ?? ""} onChange={(event) => setChosen(event.target.value)}>
            {sorted.map((v) => (
              <option key={v.id} value={String(v.id)}>
                {versionLabel(v)}
                {channelOf(v) === "release" ? "" : ` (${CHANNEL[channelOf(v)].label})`}
              </option>
            ))}
          </Select>
        </label>
        {items.length > 12 && (
          <SearchField
            label="Search this pack"
            placeholder={`Search ${items.length} files`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            wrapperClassName="pc-search"
          />
        )}
      </div>

      {loading ? (
        <div className="pc-loading" aria-busy="true" aria-label="Reading the pack's file list">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="pc-row pc-row--static">
              <Skeleton shape="block" width={32} height={32} />
              <Skeleton lines={2} />
            </div>
          ))}
        </div>
      ) : found?.error ? (
        <Notice tone="danger">{found.error}</Notice>
      ) : (
        <>
          <p className="pc-totals" data-testid="pack-totals">
            {totals.length
              ? totals.map((t) => `${t.count.toLocaleString()} ${t.count === 1 ? t.one : t.label.toLowerCase()}`).join(" · ")
              : "This version lists no files."}
          </p>
          {found?.contents?.partial && (
            <Notice tone="info">
              The pack's own file list couldn't be read, so this is only what the mod site lists it as containing.
            </Notice>
          )}
          {query && !matching.length && <p className="pc-none">Nothing in this pack matches "{search.trim()}".</p>}
          {groups.map((group) => (
            <section key={group.kind} className="pc-group" aria-label={group.label}>
              <h3 className="pc-heading">
                {group.label} <span>{group.items.length.toLocaleString()}</span>
              </h3>
              <ul className="pc-list">
                {group.items.map((item, i) => (
                  <li key={`${item.fileName ?? item.name}-${i}`}>
                    <PackRow item={item} openProject={openProject} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function PackRow({ item, openProject }: { item: PackItem; openProject: Props["openProject"] }) {
  const inner = (
    <>
      {item.icon ? (
        <img className="pc-icon" src={item.icon} alt="" width={32} height={32} loading="lazy" />
      ) : (
        <Monogram name={item.name} size={32} />
      )}
      <span className="pc-main">
        <span className="pc-line">
          <span className="pc-name">{item.name}</span>
          {item.version && <span className="pc-ver">{item.version}</span>}
        </span>
        {(item.summary || item.fileName) && <span className="pc-summary">{item.summary || item.fileName}</span>}
      </span>
      <span className="pc-tags">
        {item.side && SIDE_LABEL[item.side] && <Badge>{SIDE_LABEL[item.side]}</Badge>}
        {item.optional && <Badge tone="info">Optional</Badge>}
        {item.bundled && (
          <span title="Shipped inside the pack itself, not downloaded from a mod site">
            <Badge>In the pack</Badge>
          </span>
        )}
      </span>
    </>
  );

  if (item.source && item.projectId) {
    const { source, projectId } = item;
    return (
      <button type="button" className="pc-row" data-testid="pack-item" onClick={() => openProject(source, projectId)} title={`Open ${item.name}`}>
        {inner}
      </button>
    );
  }
  return (
    <div className="pc-row pc-row--static" data-testid="pack-item" title={item.fileName}>
      {inner}
    </div>
  );
}
