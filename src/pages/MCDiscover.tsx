import BackgroundLogo from "../components/BackgroundLogo";
import { useEffect, useRef, useState } from "react";
import InstallToInstance from "../components/InstallToInstance";
import Sidebar from "../components/MCSidebar";
import Pagination from "../components/Pagination";
import SourceDownloads from "../components/SourceDownloads";

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
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [source, setSource] = useState("Any Source");
  const [loader, setLoader] = useState("Any Loader");
  const [version, setVersion] = useState("Any Version");
  const [sort, setSort] = useState("Relevance");

  const [tab, setTab] = useState<Tab>("all");

  const [versions, setVersions] = useState<any[]>([]);
  const [result, setResult] = useState<CatalogPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // A chosen page belongs to the search it was chosen in, so any new search starts
  // at page 1 without first asking for that page of the new results.
  const filterKey = JSON.stringify([debouncedSearch, version, loader, tab, source, sort]);
  const [chosenPage, setChosenPage] = useState({ filterKey, page: 1 });
  const page = chosenPage.filterKey === filterKey ? chosenPage.page : 1;
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
    }

    loadPage();

    return () => {
      active = false;
    };
  }, [debouncedSearch, version, loader, tab, source, sort, page]);

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

  const dropdownStyle = {
    padding: "10px 12px",
    borderRadius: 10,
    background: "#1b1b1b",
    color: "white",
    border: "1px solid #6d28d9",
    fontSize: 13,
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "#0d0d0d", color: "white" }}>
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
      <div style={{ flex: 1, minWidth: 0, padding: 30, overflowY: "auto", position: "relative" }}>
        <h1 style={{ color: "#c084fc" }}>Discover Content</h1>

        {/* SEARCH */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Modrinth and CurseForge..."
          style={{
            width: "100%",
            padding: 14,
            borderRadius: 10,
            background: "#1b1b1b",
            color: "white",
            border: "1px solid #6d28d9",
          }}
        />

        {/* TABS */}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {(["all", "mods", "modpacks", "shaders", "datapacks", "resourcepacks"] as Tab[]).map(
            (t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="sidebar-button"
                style={{
                  fontSize: 12,
                  padding: "6px 10px",
                  opacity: tab === t ? 1 : 0.6,
                }}
              >
                {TAB_LABELS[t]}
              </button>
            )
          )}
        </div>

        {/* DROPDOWNS */}
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <select style={dropdownStyle} value={loader} onChange={(e) => setLoader(e.target.value)}>
            <option>Any Loader</option>
            <option>Fabric</option>
            <option>Forge</option>
            <option>NeoForge</option>
            <option>Quilt</option>
          </select>

          <select style={dropdownStyle} value={version} onChange={(e) => setVersion(e.target.value)}>
            <option>Any Version</option>
            {versions.map((v: any, i) => {
              const val = typeof v === "string" ? v : v.version || v.id;
              return <option key={i}>{val}</option>;
            })}
          </select>
	  <select
	    style={dropdownStyle}
	    value={source}
	    onChange={(e) => setSource(e.target.value)}
	  >
	    <option>Any Source</option>
	    <option>Modrinth</option>
	    <option>CurseForge</option>
	  </select>
          <select style={dropdownStyle} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option>Relevance</option>
            <option>Downloads</option>
            <option>Newest</option>
          </select>
        </div>

        {!curseForgeReady && (
          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 10,
              background: "#2a1a05",
              border: "1px solid #b45309",
              color: "#fcd34d",
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
              background: "#2a0d0d",
              border: "1px solid #ef4444",
              color: "#fca5a5",
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
              background: "#0d2a12",
              border: "1px solid #166534",
              color: "#86efac",
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
              background: "#1a1a1a",
              border: "1px solid #6d28d9",
            }}
          >
            <div style={{ color: "#d8b4fe", marginBottom: 8 }}>
              {packProgress.detail ?? packProgress.stage} ({packProgress.percent}%)
            </div>

            <div style={{ height: 6, background: "#333", borderRadius: 3 }}>
              <div
                style={{
                  width: `${packProgress.percent}%`,
                  height: "100%",
                  background: "#7c3aed",
                  borderRadius: 3,
                  transition: "width .2s",
                }}
              />
            </div>

            <div style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}>
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
              background: "#2a1a05",
              border: "1px solid #b45309",
              color: "#fcd34d",
              fontSize: 13,
            }}
          >
            {warning}
          </div>
        ))}

        {/* PAGES */}
        <div ref={listTop} style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {totals && (
            <div data-testid="page-summary" style={{ fontSize: 12, color: "#9ca3af" }}>
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
            <div data-testid="curseforge-limit" style={{ fontSize: 11, color: "#6b7280" }}>
              CurseForge only lets apps reach the first 10,000 results of a search. Search or filter to get to the rest.
            </div>
          )}
        </div>

        {/* LIST */}
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {loading ? (
            <div>Loading...</div>
          ) : items.length === 0 ? (
            <div style={{ color: "#9ca3af", padding: 20 }}>
              No {tab === "all" ? "content" : TAB_LABELS[tab].toLowerCase()} found
              {search.trim() ? ` for "${search.trim()}"` : ""}.
              {(loader !== "Any Loader" ||
                version !== "Any Version" ||
                source !== "Any Source") &&
                " Try clearing the filters."}
            </div>
          ) : (
            items.map((item) => (
              <div
                key={`${item.source}-${item.id}`}
                className="game-card"
                data-testid="discover-card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  minHeight: 100,
                  padding: 12,
                }}
              >
                {/* ICON */}
                <div
                  style={{
                    width: 70,
                    height: 70,
                    borderRadius: 10,
                    overflow: "hidden",
                    border: "1px solid #6d28d9",
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
                  <div style={{ fontWeight: 600, color: "#c084fc" }}>
                    {item.name}
                  </div>

                  <div style={{ fontSize: 12, color: "#aaa" }}>
                    {item.summary?.slice(0, 120)}
                  </div>

                  <div style={{ fontSize: 11, marginTop: 4 }}>
                    {TYPE_LABELS[item.type] ?? item.type}
                    {" • "}
                    <SourceDownloads sources={item.sources} />
                  </div>
                </div>

                {/* BUTTONS */}
                <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "flex-start" }}>
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
                      style={{ padding: "8px 12px", background: "#7c3aed" }}
                      disabled={!!installingPack}
                      onClick={() => installModpack(item)}
                      title="Creates a new instance with this pack's Minecraft version, loader and mods"
                    >
                      {installingPack === item.id ? "Installing..." : "Install"}
                    </button>
                  )}

                  <button
                    className="sidebar-button"
                    style={{ padding: "8px 12px" }}
                    onClick={() =>
                      openMod(item.source, item.id)
                    }
                  >
                    View
                  </button>
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