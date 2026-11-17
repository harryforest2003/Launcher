import BackgroundLogo from "../components/BackgroundLogo";
import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button, SearchField, Select, Tabs } from "../components/ui";
import "./discover.css";
import InstallToInstance from "../components/InstallToInstance";
import Sidebar from "../components/MCSidebar";
import Pagination from "../components/Pagination";
import SourceDownloads from "../components/SourceDownloads";
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
        <header className="page-header"><h1 className="page-title">Discover Content</h1></header>

        {/* SEARCH */}
        <SearchField label="Search mods and modpacks" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Modrinth and CurseForge…" />

        {/* FILTERS (one button) and the content TABS, which share the rest of the row equally */}
        <div className="dc-toolbar">
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
              <div id="discover-filters" role="group" aria-label="Filters" className="dc-filters__panel">
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

        {!curseForgeReady && (
          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 10,
              background: "var(--color-warning-bg)",
              border: "1px solid var(--color-warning-border)",
              color: "var(--color-warning-text)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span>{curseForgeOffReason}</span>
            <button className="sidebar-button" style={{ padding: "6px 12px", fontSize: 12 }} onClick={goSettings}>
              Open Settings
            </button>
          </div>
        )}

        {/* MODPACK INSTALL FEEDBACK */}
        {packError && (
          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 10,
              background: "var(--color-danger-bg)",
              border: "1px solid var(--color-danger-border)",
              color: "var(--color-danger-text)",
              whiteSpace: "pre-wrap",
            }}
          >
            {packError}
          </div>
        )}

        {packResult && (
          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 10,
              background: "var(--color-success-bg)",
              border: "1px solid var(--color-success-border)",
              color: "var(--color-success-text)",
            }}
          >
            {packResult}
          </div>
        )}

        {installingPack && packProgress && (
          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 10,
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div style={{ color: "var(--color-accent-text)", marginBottom: 8 }}>
              {packProgress.detail ?? packProgress.stage} ({packProgress.percent}%)
            </div>

            <div style={{ height: 6, background: "var(--color-surface-raised)", borderRadius: 3 }}>
              <div
                style={{
                  width: `${packProgress.percent}%`,
                  height: "100%",
                  background: "var(--color-accent)", color: "var(--color-on-accent)",
                  borderRadius: 3,
                  transition: "width .2s",
                }}
              />
            </div>

            <div style={{ color: "var(--color-text-muted)", fontSize: 12, marginTop: 8 }}>
              Downloading Minecraft, the loader and every mod in the pack.
            </div>
          </div>
        )}

        {[...warnings, ...(loadError ? [loadError] : [])].map((warning) => (
          <div
            key={warning}
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 10,
              background: "var(--color-warning-bg)",
              border: "1px solid var(--color-warning-border)",
              color: "var(--color-warning-text)",
              fontSize: 13,
            }}
          >
            {warning}
          </div>
        ))}

        {/* PAGES */}
        <div ref={listTop} style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {totals && (
            <div data-testid="page-summary" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {source !== "CurseForge" && `${totals.modrinth.toLocaleString()} on Modrinth`}
              {source === "Any Source" && " • "}
              {source !== "Modrinth" &&
                `${totals.curseforge.toLocaleString()}${totals.curseforgeCapped ? "+" : ""} on CurseForge`}
              {` • Page ${result?.page.toLocaleString()} of ${result?.pageCount.toLocaleString()}`}
            </div>
          )}

          {result && (
            <Pagination page={result.page} pageCount={result.pageCount} disabled={loading} onChange={goToPage} />
          )}

          {source !== "Modrinth" && totals?.curseforgeCapped && (
            <div data-testid="curseforge-limit" style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
              CurseForge only lets apps reach the first 10,000 results of a search. Search or filter to get to the rest.
            </div>
          )}
        </div>

        {/* LIST */}
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {loading ? (
            <div>Loading...</div>
          ) : items.length === 0 ? (
            <div style={{ color: "var(--color-text-muted)", padding: 20 }}>
              No {tab === "all" ? "content" : TAB_LABELS[tab].toLowerCase()} found
              {search.trim() ? ` for "${search.trim()}"` : ""}.
              {activeFilters > 0 && " Try clearing the filters."}
            </div>
          ) : (
            items.map((item) => (
              // Clicking anywhere on the card, other than its buttons, opens the project's page.
              <div
                key={`${item.source}-${item.id}`}
                className="game-card"
                data-testid="discover-card"
                role="button"
                tabIndex={0}
                aria-label={`Open ${item.name}`}
                onClick={() => openMod(item.source, item.id)}
                onKeyDown={(event) => {
                  if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    openMod(item.source, item.id);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  minHeight: 100,
                  padding: 12,
                  cursor: "pointer",
                }}
              >
                {/* ICON */}
                <div
                  style={{
                    width: 70,
                    height: 70,
                    borderRadius: 10,
                    overflow: "hidden",
                    border: "1px solid var(--color-border)",
                    flexShrink: 0,
                  }}
                >
                  {/* Modrinth returns "" for projects with no icon, which
                      makes the browser re-request the whole page. */}
                  {item.icon ? (
                    <img
                      src={item.icon}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : null}
                </div>

                {/* TEXT */}
                <div style={{ flex: 1, textAlign: "left" }}>
                  <div style={{ fontWeight: 600, color: "var(--color-accent-text)" }}>
                    {item.name}
                  </div>

                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {item.summary?.slice(0, 120)}
                  </div>

                  <div style={{ fontSize: 11, marginTop: 4 }}>
                    {TYPE_LABELS[item.type] ?? item.type}
                    {" • "}
                    <SourceDownloads sources={item.sources} />
                  </div>
                </div>

                {/* BUTTONS: using these (or what they open) doesn't open the card */}
                <div
                  style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "flex-start", cursor: "default" }}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
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
                    <button
                      className="sidebar-button"
                      style={{ padding: "8px 12px" }}
                      title="This author disabled third-party downloads"
                      onClick={() => item.url && window.modAPI.openUrl(item.url).catch(() => {})}
                    >
                      Open Site
                    </button>
                  )}

                  {item.type === "modpack" && item.installable !== false && (
                    <button
                      className="sidebar-button"
                      style={{ padding: "8px 12px", background: "var(--color-accent)", color: "var(--color-on-accent)" }}
                      disabled={!!installingPack}
                      onClick={() => installModpack(item)}
                      title="Creates a new instance with this pack's Minecraft version, loader and mods"
                    >
                      {installingPack === item.id ? "Installing..." : "Install"}
                    </button>
                  )}

                </div>
              </div>
            ))
          )}
        </div>

        {result && !loading && items.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <Pagination page={result.page} pageCount={result.pageCount} onChange={goToPage} />
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

export default MCDiscover;
