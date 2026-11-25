import { useEffect, useRef, useState } from "react";
import { Clock, Download, ExternalLink, KeyRound } from "lucide-react";
import { Badge, Button, EmptyState, Monogram, Notice, ProgressBar, SearchField, Select, Skeleton, Tabs } from "../components/ui";
import "./discover.css";
import InstallToInstance from "../components/InstallToInstance";
import PackVersionPicker from "../components/PackVersionPicker";
import type { PackVersion } from "../components/packVersions";
import { useModpackInstall } from "../components/useModpackInstall";
import Sidebar from "../components/MCSidebar";
import Pagination from "../components/Pagination";
import DiscoverRow from "./DiscoverRow";
import PlatformPacks, { PlatformPackRow } from "./PlatformPacks";
import { PLATFORM_NAMES } from "./platformSites";
import { useScrollMemory } from "./useScrollMemory";

type Props = {
  onBack: () => void;
  goHome: () => void;
  goMinecraft: () => void;
  goDiscover: () => void;
  goLibrary: () => void;
  goSkinSelector: () => void;
  goSettings: () => void;
  openMod: (
    source: "modrinth" | "curseforge",
    id: string
  ) => void;
};

type Tab =
  | "all"
  | "mods"
  | "modpacks"
  | "shaders"
  | "datapacks"
  | "resourcepacks";

// Tab -> the canonical project type it shows.
const TAB_TYPES: Record<Exclude<Tab, "all">, string> = {
  mods: "mod",
  modpacks: "modpack",
  shaders: "shader",
  datapacks: "datapack",
  resourcepacks: "resourcepack",
};

const TAB_LABELS: Record<Tab, string> = {
  all: "All",
  mods: "Mods",
  modpacks: "Modpacks",
  shaders: "Shaders",
  datapacks: "Data Packs",
  resourcepacks: "Resource Packs",
};

const TYPE_LABELS: Record<string, string> = {
  mod: "Mod",
  modpack: "Modpack",
  shader: "Shader",
  datapack: "Data Pack",
  resourcepack: "Resource Pack",
};

const SITE_NAMES: Record<string, string> = { modrinth: "Modrinth", curseforge: "CurseForge" };

// Modpack sites with launchers of their own, picked in the Source filter on the Modpacks tab.
const PLATFORM_SITES = Object.keys(PLATFORM_NAMES) as PlatformPackSite[];
const siteFromSource = (source: string) => PLATFORM_SITES.find((site) => PLATFORM_NAMES[site] === source) ?? null;
// How many of each site's packs go on a page that mixes every site.
const MIX_PER_SITE = 8;

type Row = { kind: "catalog"; item: CatalogItem } | { kind: "platform"; item: PlatformPackItem };
type SitePage = { site: PlatformPackSite; found: PlatformPackPage | null; error: string | null };

const plain = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const downloadsOf = (row: Row) =>
  row.kind === "catalog" ? row.item.sources.reduce((sum, s) => sum + s.downloads, 0) || row.item.downloads : row.item.downloads;

/*
 * One page from every site: Modrinth and CurseForge's shared page, then each launcher site's
 * page, leaving out packs already listed under the same name. Sorted by downloads or date
 * when asked, else each site's best match first, taking turns.
 */
function mixRows(catalog: CatalogItem[], sites: PlatformPackItem[][], sort: string): Row[] {
  const seen = new Set(catalog.map((item) => squash(item.name)));
  const lists: Row[][] = [
    catalog.map((item) => ({ kind: "catalog" as const, item })),
    ...sites.map((list) =>
      list
        .filter((item) => {
          const key = squash(item.name);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((item) => ({ kind: "platform" as const, item }))
    ),
  ];
  if (sort === "Downloads") return lists.flat().sort((a, b) => downloadsOf(b) - downloadsOf(a));
  if (sort === "Newest") {
    const date = (row: Row) => Date.parse(row.item.date ?? "") || 0;
    return lists.flat().sort((a, b) => date(b) - date(a));
  }
  const rows: Row[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest; i++) for (const list of lists) if (list[i]) rows.push(list[i]);
  return rows;
}

const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

// Loader, game versions and categories, where the listing carries them, else the filters the list is already narrowed by.
function tags(item: CatalogItem & { loaders?: string[]; categories?: string[]; gameVersions?: string[] }, extra: string[] = []) {
  const own = [...(item.loaders ?? []), ...(item.categories ?? []), ...(item.gameVersions ?? []).slice(-1)];
  return [...new Set(own.length ? own : extra)].slice(0, 4);
}

function ago(iso: string) {
  const days = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));
  if (Number.isNaN(days)) return "";
  if (days < 1) return "Today";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 365) return `${Math.round(days / 30)} mo ago`;
  return `${Math.round(days / 365)} yr ago`;
}

// Preserve browsing context when opening a project or switching launcher pages.
const discoverContext = {
  search: "", source: "Any Source", loader: "Any Loader", version: "Any Version",
  sort: "Relevance", tab: "all" as Tab,
  chosenPage: { filterKey: "", page: 1 },
};

function MCDiscover({
  onBack,
  goHome,
  goMinecraft,
  goDiscover,
  goLibrary,
  goSkinSelector,
  goSettings,
  openMod,
}: Props) {
  const [search, setSearch] = useState(discoverContext.search);
  const [debouncedSearch, setDebouncedSearch] = useState(discoverContext.search.trim());
  const [source, setSource] = useState(discoverContext.source);
  const [loader, setLoader] = useState(discoverContext.loader);
  const [version, setVersion] = useState(discoverContext.version);
  const [sort, setSort] = useState(discoverContext.sort);

  const [tab, setTab] = useState<Tab>(discoverContext.tab);
  // FTB, Technic or ATLauncher, when the Source filter on the Modpacks tab is one of them.
  const platformSite = tab === "modpacks" ? siteFromSource(source) : null;
  // Every site's modpacks together.
  const mixPacks = tab === "modpacks" && source === "Any Source";
  // Those sites only list modpacks, so other tabs go back to any source.
  const changeTab = (next: Tab) => {
    setTab(next);
    if (next !== "modpacks" && siteFromSource(source)) setSource("Any Source");
  };

  // The loader, version, source and sort choices stay in a column beside the results, the
  // way the mod sites themselves list them, so what's narrowing the list is always in view.
  const activeFilters = [loader !== "Any Loader", version !== "Any Version", source !== "Any Source", sort !== "Relevance"].filter(Boolean).length;
  const resetFilters = () => {
    setLoader("Any Loader");
    setVersion("Any Version");
    setSource("Any Source");
    setSort("Relevance");
  };

  const [versions, setVersions] = useState<(string | { version?: string; id?: string })[]>([]);
  const [result, setResult] = useState<CatalogPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // A chosen page belongs to the search it was chosen in, so any new search starts
  // at page 1 without first asking for that page of the new results.
  const filterKey = JSON.stringify([debouncedSearch, version, loader, tab, source, sort]);
  const [chosenPage, setChosenPage] = useState(discoverContext.chosenPage);
  const page = chosenPage.filterKey === filterKey ? chosenPage.page : 1;
  const requestKey = JSON.stringify([filterKey, page]);
  const discoverScroll = useScrollMemory(`discover:${requestKey}`, loadedKey === requestKey && !loading);
  useEffect(() => {
    Object.assign(discoverContext, { search, source, loader, version, sort, tab, chosenPage });
  }, [search, source, loader, version, sort, tab, chosenPage]);
  const listTop = useRef<HTMLDivElement>(null);

  // Installing a modpack creates a whole instance, so it gets its own
  // progress reporting rather than a spinner on the button.
  const { installing: installingPack, progress: packProgress, result: packResult, error: packError, install: installPack } = useModpackInstall();
  // The pack whose versions are on show, before one is picked to install.
  const [pickingPack, setPickingPack] = useState<CatalogItem | null>(null);
  const [pickingPlatform, setPickingPlatform] = useState<PlatformPackItem | null>(null);
  // FTB, Technic and ATLauncher's pages, when every site's modpacks are mixed.
  const [sitePages, setSitePages] = useState<SitePage[]>([]);

  const [curseForgeReady, setCurseForgeReady] = useState(true);

  useEffect(() => {
    window.instanceAPI
      .getApiKeys()
      .then((keys) => setCurseForgeReady(keys.curseforge.set))
      .catch(() => {});
  }, []);

  function installModpack(item: CatalogItem, version: PackVersion) {
    setPickingPack(null);
    void installPack({ source: item.source, projectId: item.id, name: item.name, icon: item.icon }, version);
  }

  /* ---------------- versions ---------------- */
  useEffect(() => {
    window.launcherAPI
      .getMinecraftVersions()
      .then((d) => setVersions(Array.isArray(d) ? d : []))
      .catch(() => setVersions([]));
  }, []);

  /* ---------------- debounce ---------------- */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  /* ---------------- fetch one page ---------------- */
  useEffect(() => {
    // Those sites' packs are listed by PlatformPacks instead.
    if (platformSite) return;
    let active = true;

    async function loadPage() {
      setLoading(true);
      const sites = mixPacks ? PLATFORM_SITES : [];
      const fromSites = Promise.all(
        sites.map((site) =>
          window.instanceAPI
            .searchPlatformPacks(site, {
              query: debouncedSearch,
              page,
              loader: loader === "Any Loader" ? undefined : loader,
              mcVersion: version === "Any Version" ? undefined : version,
              perPage: MIX_PER_SITE,
            })
            .then(
              (found): SitePage => ({ site, found, error: null }),
              (err): SitePage => ({ site, found: null, error: plain(err) })
            )
        )
      );

      try {
        const next = await window.launcherAPI.browseCatalog({
          query: debouncedSearch,
          type: tab === "all" ? undefined : TAB_TYPES[tab],
          mcVersion: version === "Any Version" ? undefined : version,
          loader: loader === "Any Loader" ? undefined : loader,
          source: source === "Any Source" ? undefined : source.toLowerCase(),
          sort: sort.toLowerCase(),
          page,
        });

        if (!active) return;
        setResult(next);
        setLoadError(null);
      } catch (err) {
        if (!active) return;
        setResult(null);
        setLoadError(err instanceof Error ? err.message : String(err));
      }

      const pages = await fromSites;
      if (!active) return;
      setSitePages(pages);
      setLoading(false);
      setLoadedKey(requestKey);
    }

    loadPage();

    return () => {
      active = false;
    };
  }, [debouncedSearch, version, loader, tab, source, sort, page, requestKey, platformSite, mixPacks]);

  useEffect(() => {
    listTop.current?.scrollIntoView({ block: "start" });
  }, [page]);

  const items = result?.items ?? [];
  const totals = result?.totals;
  // The sites' own pages count only when they're for this page (past their last, they repeat it).
  const sitesHere = mixPacks ? sitePages.filter((entry) => entry.found && entry.found.page === page) : [];
  const rows: Row[] = mixPacks
    ? mixRows(result && result.page === page ? items : [], sitesHere.map((entry) => entry.found?.items ?? []), sort)
    : items.map((item) => ({ kind: "catalog", item }));
  const shownPage = mixPacks ? page : (result?.page ?? 1);
  // FTB, Technic and ATLauncher's counts, as one figure to keep the bar short.
  const otherSites = sitePages.reduce((sum, entry) => sum + (mixPacks ? (entry.found?.total ?? 0) : 0), 0);
  const otherSitesDetail = sitePages.map((entry) => `${(entry.found?.total ?? 0).toLocaleString()} on ${PLATFORM_NAMES[entry.site]}`).join(", ");
  const pageCount = Math.max(result?.pageCount ?? 1, ...(mixPacks ? sitePages.map((entry) => entry.found?.pageCount ?? 1) : []));
  const narrowed = [loader, version].filter((v) => !v.startsWith("Any "));
  const goToPage = (next: number) => setChosenPage({ filterKey, page: next });

  // The banner above says why CurseForge is off, so it isn't repeated below.
  const warnings = [
    ...(result?.warnings ?? []).filter((warning) => curseForgeReady || !warning.startsWith("CurseForge")),
    ...(mixPacks ? sitePages.flatMap((entry) => (entry.error ? [`${PLATFORM_NAMES[entry.site]}: ${entry.error}`] : [])) : []),
  ];
  const curseForgeOffReason =
    result?.warnings.find((warning) => warning.startsWith("CurseForge: "))?.slice("CurseForge: ".length) ??
    "CurseForge isn't available in this copy of the launcher yet.";



  return (
    <div className="app-screen">
      <Sidebar
        currentPage="discover"
        goHome={goHome}
        goMinecraft={goMinecraft}
        goDiscover={goDiscover}
        goLibrary={goLibrary}
        goSkinSelector={goSkinSelector}
        goSettings={goSettings}
        showBack
        onBack={onBack}
      />

      <div style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden", display: "flex" }}>
      <div ref={discoverScroll} className="app-page dc-workspace">
        {/* One sticky toolbar: search, filters and the count, then the content types */}
        <div className="dc-bar">
          <div className="dc-bar__row">
            <SearchField wrapperClassName="dc-searchfield" label="Search Minecraft mods and modpacks" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Minecraft mods" />
            {totals && !platformSite && (
              <div data-testid="page-summary" className="dc-bar__count">
                {source !== "CurseForge" && `${compact(totals.modrinth)} on Modrinth`}
                {source === "Any Source" && curseForgeReady && " • "}
                {source !== "Modrinth" && curseForgeReady &&
                  `${compact(totals.curseforge)}${totals.curseforgeCapped ? "+" : ""} on CurseForge`}
                {otherSites > 0 && <span title={otherSitesDetail}>{` • ${compact(otherSites)} on other sites`}</span>}
                {` • Page ${shownPage.toLocaleString()} of ${pageCount.toLocaleString()}`}
              </div>
            )}
          </div>
          <div className="dc-tabs">
            <Tabs
              label="Content type"
              idBase="discover"
              value={tab}
              onChange={changeTab}
              tabs={(["all", "mods", "modpacks", "shaders", "datapacks", "resourcepacks"] as Tab[]).map((t) => ({ value: t, label: TAB_LABELS[t] }))}
            />
          </div>
        </div>

        <div className="dc-body">
        <aside className="dc-facets" aria-label="Filters">
          <div className="dc-facets__head">
            <span className="dc-facets__title">Filters</span>
            <Button size="sm" variant="ghost" onClick={resetFilters} disabled={!activeFilters}>
              Reset
            </Button>
          </div>
          <label className="dc-field">
            <span>Loader</span>
            <Select value={loader} onChange={(e) => setLoader(e.target.value)}>
              <option>Any Loader</option>
              <option>Fabric</option>
              <option>Forge</option>
              <option>NeoForge</option>
              <option>Quilt</option>
            </Select>
          </label>

          <label className="dc-field">
            <span>Minecraft version</span>
            <Select value={version} onChange={(e) => setVersion(e.target.value)}>
              <option>Any Version</option>
              {versions.map((v, i) => {
                const val = typeof v === "string" ? v : v.version || v.id;
                return <option key={i}>{val}</option>;
              })}
            </Select>
          </label>

          <label className="dc-field">
            <span>Source</span>
            <Select value={source} onChange={(e) => setSource(e.target.value)}>
              <option>Any Source</option>
              <option>Modrinth</option>
              <option>CurseForge</option>
              {tab === "modpacks" && PLATFORM_SITES.map((site) => <option key={site}>{PLATFORM_NAMES[site]}</option>)}
            </Select>
          </label>

          <label className="dc-field">
            <span>Sort by</span>
            <Select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option>Relevance</option>
              <option>Downloads</option>
              <option>Newest</option>
            </Select>
          </label>
        </aside>
        <div className="dc-results">
        <div className="dc-notices">
          {packError && <Notice tone="danger" style={{ whiteSpace: "pre-wrap" }}>{packError}</Notice>}
          {packResult && <Notice tone="success">{packResult}</Notice>}
          {installingPack && packProgress && (
            <Notice tone="info">
              <div>{packProgress.detail ?? packProgress.stage} ({packProgress.percent}%)</div>
              <ProgressBar value={packProgress.percent / 100} label="Modpack install progress" />
              <div className="dc-note">Downloading Minecraft, the loader and every mod in the pack.</div>
            </Notice>
          )}
          {[...warnings, ...(loadError ? [loadError] : [])].map((warning) => (
            <Notice key={warning} tone="warning">{warning}</Notice>
          ))}
          {mixPacks && loader !== "Any Loader" && (
            <p className="dc-note">Technic and ATLauncher don't say which loader a pack uses, so with a loader chosen their packs are left out.</p>
          )}
          {platformSite && sort !== "Relevance" && (
            <p className="dc-note">{PLATFORM_NAMES[platformSite]} packs are listed in {PLATFORM_NAMES[platformSite]}'s own order, so Sort doesn't apply.</p>
          )}
        </div>

        {platformSite ? (
          <PlatformPacks
            platform={platformSite}
            query={debouncedSearch}
            loader={loader === "Any Loader" ? undefined : loader}
            mcVersion={version === "Any Version" ? undefined : version}
            installing={installingPack}
            onInstall={(item, picked) => void installPack({ source: item.source, projectId: item.id, name: item.name, icon: item.icon }, picked)}
          />
        ) : (
        <>
        {pickingPack && (
          <PackVersionPicker
            source={pickingPack.source}
            projectId={pickingPack.id}
            name={pickingPack.name}
            icon={pickingPack.icon}
            onPick={(version) => installModpack(pickingPack, version)}
            onClose={() => setPickingPack(null)}
          />
        )}
        {pickingPlatform && (
          <PackVersionPicker
            source={pickingPlatform.source}
            projectId={pickingPlatform.id}
            name={pickingPlatform.name}
            icon={pickingPlatform.icon}
            onPick={(picked) => {
              setPickingPlatform(null);
              void installPack({ source: pickingPlatform.source, projectId: pickingPlatform.id, name: pickingPlatform.name, icon: pickingPlatform.icon }, picked);
            }}
            onClose={() => setPickingPlatform(null)}
          />
        )}

        <div ref={listTop} />
        {/* LIST */}
        {loading ? (
          <div className="dc-list" aria-busy="true" aria-label="Loading results">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="dc-skeleton">
                <Skeleton shape="block" width={48} height={48} />
                <Skeleton lines={2} />
                <Skeleton width={100} />
                <Skeleton width={84} height={32} shape="block" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={`No ${tab === "all" ? "content" : TAB_LABELS[tab].toLowerCase()} found${search.trim() ? ` for "${search.trim()}"` : ""}`}
            body={activeFilters > 0 ? "Try clearing the filters." : "Try a different search."}
            actions={activeFilters > 0 ? <Button size="sm" onClick={resetFilters}>Clear filters</Button> : undefined}
          />
        ) : (
          <div className="dc-list">
            {rows.map((row) => {
              if (row.kind === "platform")
                return <PlatformPackRow key={`${row.item.source}-${row.item.id}`} item={row.item} installing={installingPack} onInstall={setPickingPlatform} />;
              const item = row.item;
              const downloads = downloadsOf(row);
              return (
                <DiscoverRow
                  key={`${item.source}-${item.id}`}
                  testId="discover-card"
                  name={item.name}
                  author={item.author}
                  summary={item.summary}
                  onOpen={() => openMod(item.source, item.id)}
                  art={/* Modrinth returns "" for projects with no icon, which makes the browser re-request the page. */
                    item.icon ? <img src={item.icon} alt="" loading="lazy" /> : <Monogram name={item.name} size={48} />}
                  meta={
                    <>
                      <span className="dc-stat" title={`${downloads.toLocaleString()} downloads`}>
                        <Download size={12} aria-hidden="true" />
                        <strong>{compact(downloads)}</strong>
                      </span>
                      {item.date && (
                        <span className="dc-stat" title={new Date(item.date).toLocaleDateString()}>
                          <Clock size={12} aria-hidden="true" />
                          {ago(item.date)}
                        </span>
                      )}
                      <Badge className="dc-chip">{TYPE_LABELS[item.type] ?? item.type}</Badge>
                      {item.sources.map((s) => (
                        <Badge key={s.source} className="dc-chip" tone={s.source === "modrinth" ? "accent" : "neutral"} data-testid="source-downloads">
                          {SITE_NAMES[s.source]}
                        </Badge>
                      ))}
                      {tags(item, narrowed).slice(0, 2).map((t) => (
                        <span key={t} className="dc-tag">{t}</span>
                      ))}
                    </>
                  }
                  action={
                    <>
                      {item.type !== "modpack" && (
                        <InstallToInstance
                          source={item.source}
                          projectId={item.id}
                          name={item.name}
                          icon={item.icon}
                          type={item.type}
                          installable={item.installable}
                          url={item.url}
                          alternatives={item.sources}
                        />
                      )}
                      {item.type === "modpack" && item.installable === false && (
                        <Button
                          variant="secondary"
                          icon={<ExternalLink size={14} aria-hidden="true" />}
                          title="This author disabled third-party downloads"
                          onClick={() => item.url && window.modAPI.openUrl(item.url).catch(() => {})}
                        >
                          Open site
                        </Button>
                      )}
                      {item.type === "modpack" && item.installable !== false && (
                        <Button
                          className="iti__install"
                          icon={<Download size={14} aria-hidden="true" />}
                          disabled={!!installingPack}
                          onClick={() => setPickingPack(item)}
                          title="Creates a new instance with this pack's Minecraft version, loader and mods"
                        >
                          {installingPack === item.id ? "Installing..." : "Install"}
                        </Button>
                      )}
                    </>
                  }
                />
              );
            })}
          </div>
        )}

        {(result || mixPacks) && !loading && rows.length > 0 && (
          <div className="dc-bottom">
            <Pagination page={shownPage} pageCount={pageCount} onChange={goToPage} />
          </div>
        )}
        </>
        )}

        {!curseForgeReady && !platformSite && (
          <p className="dc-foot dc-off" title={curseForgeOffReason} data-testid="curseforge-off">
            <KeyRound size={13} aria-hidden="true" />
            <span className="dc-off__text">CurseForge is off: add its key to include those results.</span>{" "}
            <button type="button" className="dc-link" onClick={goSettings}>Open Settings</button>
          </p>
        )}
        {source !== "Modrinth" && curseForgeReady && totals?.curseforgeCapped && !platformSite && (
          <p data-testid="curseforge-limit" className="dc-foot">
            CurseForge only lets apps reach the first 10,000 results of a search. Search or filter to get to the rest.
          </p>
        )}
        </div>
        </div>
      </div>
      </div>
    </div>
  );
}

export default MCDiscover;
