import BackgroundLogo from "../components/BackgroundLogo";
import { useEffect, useRef, useState } from "react";
import { Clock, Download, ExternalLink, KeyRound, SlidersHorizontal } from "lucide-react";
import { Badge, Button, EmptyState, Monogram, Notice, ProgressBar, SearchField, Select, Skeleton, Tabs } from "../components/ui";
import "./discover.css";
import InstallToInstance from "../components/InstallToInstance";
import Sidebar from "../components/MCSidebar";
import Pagination from "../components/Pagination";
import DiscoverRow from "./DiscoverRow";
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

  // The loader, version, source and sort choices live behind one Filters button, so the
  // content tabs can take the full width of the page.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const activeFilters = [loader !== "Any Loader", version !== "Any Version", source !== "Any Source", sort !== "Relevance"].filter(Boolean).length;
  const resetFilters = () => {
    setLoader("Any Loader");
    setVersion("Any Version");
    setSource("Any Source");
    setSort("Relevance");
  };
  useEffect(() => {
    if (!filtersOpen) return;
    const away = (event: MouseEvent) => {
      if (!filtersRef.current?.contains(event.target as Node)) setFiltersOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [filtersOpen]);

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
  const [installingPack, setInstallingPack] = useState<string | null>(null);
  const [packProgress, setPackProgress] = useState<InstallProgress | null>(null);
  const [packResult, setPackResult] = useState<string | null>(null);
  const [packError, setPackError] = useState<string | null>(null);

  const [curseForgeReady, setCurseForgeReady] = useState(true);

  useEffect(() => {
    return window.instanceAPI.onProgress(setPackProgress);
  }, []);

  useEffect(() => {
    window.instanceAPI
      .getApiKeys()
      .then((keys) => setCurseForgeReady(keys.curseforge.set))
      .catch(() => {});
  }, []);

  async function installModpack(item: CatalogItem) {
    setInstallingPack(item.id);
    setPackError(null);
    setPackResult(null);
    setPackProgress(null);

    try {
      const created = await window.instanceAPI.installModpack({
        source: item.source,
        projectId: item.id,
        name: item.name,
      });

      const blocked = created.pack?.blocked?.length ?? 0;

      setPackResult(
        `Created instance "${created.name}" — Minecraft ${created.version}, ` +
        `${created.loader} ${created.loaderVersion}, ${created.ram} GB RAM.` +
        (blocked
          ? ` ${blocked} file(s) could not be downloaded automatically.`
          : "")
      );
    } catch (err) {
      setPackError(err instanceof Error ? err.message : String(err));
    }

    setInstallingPack(null);
    setPackProgress(null);
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
    let active = true;

    async function loadPage() {
      setLoading(true);

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

      setLoading(false);
      setLoadedKey(requestKey);
    }

    loadPage();

    return () => {
      active = false;
    };
  }, [debouncedSearch, version, loader, tab, source, sort, page, requestKey]);

  useEffect(() => {
    listTop.current?.scrollIntoView({ block: "start" });
  }, [page]);

  const items = result?.items ?? [];
  const totals = result?.totals;
  const narrowed = [loader, version].filter((v) => !v.startsWith("Any "));
  const goToPage = (next: number) => setChosenPage({ filterKey, page: next });

  // The banner above says why CurseForge is off, so it isn't repeated below.
  const warnings = (result?.warnings ?? []).filter(
    (warning) => curseForgeReady || !warning.startsWith("CurseForge")
  );
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
      <BackgroundLogo />
      <div ref={discoverScroll} className="app-page dc-workspace">
        {/* One sticky toolbar: search, filters and the count, then the content types */}
        <div className="dc-bar">
          <div className="dc-bar__row">
            <SearchField wrapperClassName="dc-searchfield" label="Search Minecraft mods and modpacks" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Minecraft mods" />
            <div className="dc-filters" ref={filtersRef}>
              <Button
                variant={activeFilters ? "primary" : "secondary"}
                icon={<SlidersHorizontal size={16} aria-hidden="true" />}
                aria-expanded={filtersOpen}
                aria-controls="discover-filters"
                onClick={() => setFiltersOpen((open) => !open)}
              >
                Filters
                {activeFilters > 0 && <span className="dc-filters__count">{activeFilters}</span>}
              </Button>

              {filtersOpen && (
                <div id="discover-filters" role="group" aria-label="Filters" className="dc-filters__panel" style={{ left: "auto", right: 0 }}>
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

                  <div className="dc-filters__actions">
                    <Button size="sm" variant="ghost" onClick={resetFilters} disabled={!activeFilters}>
                      Reset
                    </Button>
                    <Button size="sm" onClick={() => setFiltersOpen(false)}>
                      Done
                    </Button>
                  </div>
                </div>
              )}
            </div>
            {totals && (
              <div data-testid="page-summary" className="dc-bar__count">
                {source !== "CurseForge" && `${compact(totals.modrinth)} on Modrinth`}
                {source === "Any Source" && curseForgeReady && " • "}
                {source !== "Modrinth" && curseForgeReady &&
                  `${compact(totals.curseforge)}${totals.curseforgeCapped ? "+" : ""} on CurseForge`}
                {` • Page ${result?.page.toLocaleString()} of ${result?.pageCount.toLocaleString()}`}
              </div>
            )}
          </div>
          <div className="dc-tabs">
            <Tabs
              label="Content type"
              idBase="discover"
              value={tab}
              onChange={setTab}
              tabs={(["all", "mods", "modpacks", "shaders", "datapacks", "resourcepacks"] as Tab[]).map((t) => ({ value: t, label: TAB_LABELS[t] }))}
            />
          </div>
        </div>

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
        </div>

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
        ) : items.length === 0 ? (
          <EmptyState
            title={`No ${tab === "all" ? "content" : TAB_LABELS[tab].toLowerCase()} found${search.trim() ? ` for "${search.trim()}"` : ""}`}
            body={activeFilters > 0 ? "Try clearing the filters." : "Try a different search."}
            actions={activeFilters > 0 ? <Button size="sm" onClick={resetFilters}>Clear filters</Button> : undefined}
          />
        ) : (
          <div className="dc-list">
            {items.map((item) => {
              const downloads = item.sources.reduce((sum, s) => sum + s.downloads, 0) || item.downloads;
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
                          onClick={() => installModpack(item)}
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

        {result && !loading && items.length > 0 && (
          <div className="dc-bottom">
            <Pagination page={result.page} pageCount={result.pageCount} onChange={goToPage} />
          </div>
        )}

        {!curseForgeReady && (
          <p className="dc-foot dc-off" title={curseForgeOffReason} data-testid="curseforge-off">
            <KeyRound size={13} aria-hidden="true" />
            <span className="dc-off__text">CurseForge is off: add its key to include those results.</span>{" "}
            <button type="button" className="dc-link" onClick={goSettings}>Open Settings</button>
          </p>
        )}
        {source !== "Modrinth" && curseForgeReady && totals?.curseforgeCapped && (
          <p data-testid="curseforge-limit" className="dc-foot">
            CurseForge only lets apps reach the first 10,000 results of a search. Search or filter to get to the rest.
          </p>
        )}
      </div>
      </div>
    </div>
  );
}

export default MCDiscover;
