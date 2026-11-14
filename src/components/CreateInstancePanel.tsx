import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Download, Layers, Package, Plus } from "lucide-react";
import ImportPanel from "./ImportPanel";
import InstanceArt from "./InstanceArt";
import SearchDropdown from "./SearchDropdown";
import { Button, Notice } from "./ui";
import "../pages/library.css";

type Tab = "version" | "modpack" | "import";

type Props = {
  /** Called once an instance has been made or imported, with its name when known. */
  onDone: (name?: string) => void;
  onCancel: () => void;
  /** Which way in to show first: the Library's Import button opens on "import". */
  initialTab?: Tab;
};

type MinecraftVersion = { id: string; type: string };
type LoaderOption = { id: string; name: string };
type LoaderVersion = { version?: string; version_number?: string; loader?: { version?: string } };

const loaderVersionOf = (v: LoaderVersion) => v.version || v.loader?.version || v.version_number || "";

// What each loader is for, in a player's words.
const LOADER_HINTS: Record<string, string> = {
  vanilla: "No mods",
  fabric: "Light, fast mods",
  forge: "Classic big mods",
  neoforge: "Newer Forge mods",
  quilt: "Runs Fabric mods",
};

const DEFAULT_LOADERS: LoaderOption[] = [
  { id: "vanilla", name: "Vanilla" },
  { id: "fabric", name: "Fabric" },
  { id: "forge", name: "Forge" },
  { id: "neoforge", name: "NeoForge" },
  { id: "quilt", name: "Quilt" },
];

// The listing to install from: Modrinth's when a pack is on both sites and allows it.
const installableSource = (item: CatalogItem) => {
  const usable = item.sources.filter((source) => source.installable);
  return usable.find((source) => source.source === "modrinth") ?? usable[0] ?? null;
};

const siteName = (source: string) => (source === "modrinth" ? "Modrinth" : "CurseForge");

const formatDownloads = (count: number) =>
  count >= 1e6 ? `${(count / 1e6).toFixed(1)}M` : count >= 1e3 ? `${Math.round(count / 1e3)}K` : String(count);

const plain = (err: unknown, fallback?: string) =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : (fallback ?? String(err));

const TABS: { id: Tab; label: string; icon: typeof Plus }[] = [
  { id: "version", label: "Pick a version", icon: Layers },
  { id: "modpack", label: "From a modpack", icon: Package },
  { id: "import", label: "Import", icon: Download },
];

/* Making a new instance, or importing one, inside the Library. */
export default function CreateInstancePanel({ onDone, onCancel, initialTab = "version" }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Starts at the Default RAM from Settings once that has loaded.
  const [ram, setRam] = useState(4);
  const [instanceName, setInstanceName] = useState("");
  // Until the name is typed, it follows the version and loader ("Fabric 1.21.1").
  const [nameTyped, setNameTyped] = useState(false);
  const [version, setVersion] = useState("");
  const [loader, setLoader] = useState("vanilla");
  const [versions, setVersions] = useState<MinecraftVersion[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [loaders, setLoaders] = useState<LoaderOption[]>([]);
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([]);
  const [loaderVersion, setLoaderVersion] = useState("");
  const [jvmArgs, setJvmArgs] = useState("");

  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Starting from a modpack instead: what's searched, found and chosen.
  const startFrom = tab === "modpack" ? "modpack" : "blank";
  const [packQuery, setPackQuery] = useState("");
  const [packResults, setPackResults] = useState<CatalogItem[] | null>(null);
  const [searchingPacks, setSearchingPacks] = useState(false);
  const [pack, setPack] = useState<CatalogItem | null>(null);
  const [packNotice, setPackNotice] = useState<string | null>(null);
  const [packDoneName, setPackDoneName] = useState<string | null>(null);

  // Popular packs at first, then whatever's typed, a moment after typing stops.
  useEffect(() => {
    if (startFrom !== "modpack") return;
    let current = true;
    const timer = setTimeout(async () => {
      setSearchingPacks(true);
      try {
        const page = await window.launcherAPI.browseCatalog({
          query: packQuery.trim(),
          type: "modpack",
          sort: packQuery.trim() ? "relevance" : "downloads",
          page: 1,
        });
        if (current) setPackResults(page.items.slice(0, 8));
      } catch (err) {
        if (current) setCreateError(plain(err));
      }
      if (current) setSearchingPacks(false);
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [startFrom, packQuery]);

  // Starter mods: the list from Settings, whether to add them, and what happened.
  const [starterList, setStarterList] = useState<StarterMod[]>([]);
  const [addStarter, setAddStarter] = useState(true);
  const [starterResult, setStarterResult] = useState<{ name: string; version: string; summary: StarterSummary } | null>(null);

  useEffect(() => {
    window.instanceAPI.starterModsList().then(setStarterList).catch(() => {});
    window.instanceAPI
      .getSettings()
      .then((settings) => setRam(settings.defaultRam))
      .catch(() => {});
    window.launcherAPI.getLoaders().then(setLoaders).catch(() => {});
    window.launcherAPI
      .getMinecraftVersions()
      .then((list) => {
        setVersions(list);
        // The newest full release, so most people never need to touch it.
        setVersion((now) => now || list.find((v) => v.type === "release")?.id || "");
      })
      .catch(() => {});
  }, []);

  // Mods need a loader; resource packs and the like don't.
  const hasLoader = loader !== "" && loader !== "vanilla";
  const starterCount = starterList.filter((entry) => entry.enabled && (hasLoader || entry.type !== "mod")).length;
  const loaderList = loaders.length ? loaders : DEFAULT_LOADERS;
  const loaderLabel = loaderList.find((option) => option.id === loader)?.name ?? "Vanilla";

  // The name follows the choices until it's typed.
  const autoName = version ? (hasLoader ? `${loaderLabel} ${version}` : `Minecraft ${version}`) : "";
  const nameValue = tab === "version" && !nameTyped ? autoName : instanceName;

  // Live install progress from the main process.
  useEffect(() => window.instanceAPI.onProgress(setProgress), []);

  useEffect(() => {
    let current = true;
    const versionsFor: Record<string, ((mc: string) => Promise<LoaderVersion[]>) | undefined> = {
      fabric: window.launcherAPI.getFabricVersions,
      quilt: window.launcherAPI.getQuiltVersions,
      forge: window.launcherAPI.getForgeVersions,
      neoforge: window.launcherAPI.getNeoForgeVersions,
    };
    const fetchVersions = loader && version ? versionsFor[loader] : undefined;

    (fetchVersions ? fetchVersions(version) : Promise.resolve([]))
      .then((list) => current && setLoaderVersions(list ?? []))
      .catch(() => current && setLoaderVersions([]));

    return () => {
      current = false;
    };
  }, [loader, version]);

  const shownVersions = versions.filter((v) => showSnapshots || v.type === "release");

  function chooseTab(next: Tab) {
    setTab(next);
    setCreateError(null);
  }

  // Tabs: arrow keys move between them, as in any tab row.
  function onTabKey(event: KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + TABS.length) % TABS.length;
    chooseTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  async function createFromPack(chosen: CatalogItem) {
    const source = installableSource(chosen);
    if (!source) return setCreateError(`${chosen.name}'s authors don't allow launchers to download it.`);

    setCreating(true);
    setCreateError(null);
    setProgress(null);
    setPackNotice(null);

    try {
      const created = await window.instanceAPI.installModpack({
        source: source.source,
        projectId: source.id,
        name: instanceName.trim() || chosen.name,
      });
      const blocked = created.pack?.blocked?.length ?? 0;

      if (blocked) {
        // Stay, to say which files need downloading by hand.
        setPackNotice(
          `Made ${created.name}: Minecraft ${created.version}, ${created.loader} ${created.loaderVersion}. ` +
            `${blocked} file${blocked === 1 ? "" : "s"} couldn't be downloaded automatically, as their authors don't allow it.`
        );
        setStarterResult(null);
        setPackDoneName(created.name);
      } else {
        onDone(created.name);
      }
    } catch (err) {
      setCreateError(plain(err));
    }

    setCreating(false);
  }

  async function create() {
    if (startFrom === "modpack") {
      if (!pack) return setCreateError("Choose a modpack first.");
      return createFromPack(pack);
    }

    const name = nameValue.trim();

    if (!name) return setCreateError("Give the instance a name first.");
    if (!version) return setCreateError("Pick a Minecraft version first.");

    setCreating(true);
    setCreateError(null);
    setProgress(null);
    setStarterResult(null);

    try {
      // Leaving loaderVersion empty makes the backend pick the latest build for this version.
      const created = await window.instanceAPI.create({
        name,
        version,
        loader: loader || "vanilla",
        loaderVersion,
        ram,
        jvmArgs,
        starterMods: addStarter && starterCount > 0,
      });

      // Stay to say how the starter mods went; otherwise there's nothing to add.
      if (created.starter) {
        setStarterResult({ name: created.name, version: created.version, summary: created.starter });
      } else {
        onDone(created.name);
      }
    } catch (err) {
      setCreateError(plain(err, "Instance creation failed."));
    }

    setCreating(false);
  }

  const tabs = (
    <div className="nc-tabs" role="tablist" aria-label="How to start">
      {TABS.map((entry, index) => {
        const Icon = entry.icon;
        return (
          <button
            key={entry.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`nc-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls="nc-tabpanel"
            tabIndex={tab === entry.id ? 0 : -1}
            className="nc-tab"
            onClick={() => chooseTab(entry.id)}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            <Icon size={16} aria-hidden="true" /> {entry.label}
          </button>
        );
      })}
    </div>
  );

  if (tab === "import") {
    return (
      <>
        {tabs}
        <div role="tabpanel" id="nc-tabpanel" aria-labelledby="nc-tab-import">
          <ImportPanel onImported={(name) => onDone(name)} />
        </div>
      </>
    );
  }

  const nameRow = (
    <div className="nc-row">
      <label className="nc-q" htmlFor="nc-name">
        Name
        <small>{startFrom === "modpack" ? "Filled in from the modpack." : "How it shows in your Library."}</small>
      </label>
      <div className="nc-a">
        <input
          id="nc-name"
          className="ui-input"
          value={nameValue}
          onChange={(e) => {
            setNameTyped(true);
            setInstanceName(e.target.value);
          }}
          placeholder="Instance name"
          aria-label="Instance name"
        />
      </div>
    </div>
  );

  const done = Boolean(starterResult || packNotice);

  return (
    <>
      {tabs}
      <div className="nc" role="tabpanel" id="nc-tabpanel" aria-labelledby={`nc-tab-${tab}`} data-testid="create-instance">
        <div className="nc-form">
          {startFrom === "modpack" ? (
            <>
              <div className="nc-row" data-testid="modpack-picker">
                <label className="nc-q" htmlFor="nc-pack-search">
                  Modpack
                  <small>Searches Modrinth and CurseForge. Most downloaded first.</small>
                </label>
                <div className="nc-a">
                  <input
                    id="nc-pack-search"
                    className="ui-input"
                    type="search"
                    value={packQuery}
                    onChange={(e) => setPackQuery(e.target.value)}
                    placeholder="Search modpacks..."
                    aria-label="Search modpacks"
                  />

                  {searchingPacks && <p className="nc-hint">Searching...</p>}
                  {packResults && !searchingPacks && packResults.length === 0 && <p className="nc-hint">No modpacks found.</p>}

                  <div className="nc-packs" role="radiogroup" aria-label="Modpacks">
                    {packResults?.map((item) => {
                      const source = installableSource(item);
                      const chosen = pack?.id === item.id && pack.source === item.source;
                      return (
                        <button
                          key={`${item.source}:${item.id}`}
                          type="button"
                          role="radio"
                          aria-checked={chosen}
                          className="nc-pack"
                          data-testid="modpack-result"
                          disabled={!source}
                          title={source ? undefined : "Its authors don't allow launchers to download it."}
                          onClick={() => {
                            setPack(item);
                            setCreateError(null);
                            if (!instanceName.trim() || instanceName === pack?.name || !nameTyped) setInstanceName(item.name);
                          }}
                        >
                          {item.icon ? <img src={item.icon} alt="" width={44} height={44} /> : <span className="nc-pack-blank" />}
                          <span style={{ minWidth: 0 }}>
                            <span className="nc-pack-name">{item.name}</span>
                            <span className="nc-pack-meta">
                              {item.sources.map((entry) => siteName(entry.source)).join(" and ")}, {formatDownloads(item.downloads)} downloads
                              {source ? "" : ". Its authors don't allow launchers to download it"}
                            </span>
                            <span className="nc-pack-summary">{item.summary}</span>
                          </span>
                          <span className="nc-pack-mark" aria-hidden="true">
                            {chosen && <Check size={12} strokeWidth={3} />}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <p className="nc-hint">
                    The pack sets the Minecraft version, loader, mods and its recommended memory. You can change the memory and
                    Java in the instance's settings afterwards.
                  </p>
                </div>
              </div>
              {nameRow}
            </>
          ) : (
            <>
              {nameRow}

              <div className="nc-row">
                <div className="nc-q">
                  Minecraft version
                  <small>The newest release is picked for you.</small>
                </div>
                <div className="nc-a">
                  <SearchDropdown
                    value={version}
                    onChange={setVersion}
                    label="Minecraft version"
                    placeholder="Search Minecraft version..."
                    options={shownVersions.map((v) => ({ value: v.id, label: v.type === "release" ? v.id : `${v.id} (${v.type.replace("_", " ")})` }))}
                  />
                  <label className="nc-check">
                    <input type="checkbox" checked={showSnapshots} onChange={(e) => setShowSnapshots(e.target.checked)} />
                    Show snapshots and old versions
                  </label>
                </div>
              </div>

              <div className="nc-row">
                <div className="nc-q" id="nc-loader-label">
                  Mod loader
                  <small>What lets mods run. Pick Vanilla to play without mods.</small>
                </div>
                <div className="nc-a">
                  <div className="nc-loaders" role="radiogroup" aria-labelledby="nc-loader-label">
                    {loaderList.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={loader === option.id}
                        className="nc-loader"
                        onClick={() => {
                          setLoader(option.id);
                          setLoaderVersion("");
                        }}
                      >
                        <b>{option.name}</b>
                        <span>{LOADER_HINTS[option.id] ?? "Mod loader"}</span>
                      </button>
                    ))}
                  </div>
                  {hasLoader && (
                    <label className="nc-check" style={{ alignItems: "center" }}>
                      <span style={{ minWidth: 120 }}>{loaderLabel} version</span>
                      <select
                        className="lx-select"
                        style={{ flex: 1 }}
                        value={loaderVersion}
                        aria-label="Loader version"
                        onChange={(e) => setLoaderVersion(e.target.value)}
                      >
                        <option value="">Latest</option>
                        {loaderVersions.map((v) => (
                          <option key={loaderVersionOf(v)} value={loaderVersionOf(v)}>
                            {loaderVersionOf(v)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </div>

              <div className="nc-row">
                <label className="nc-q" htmlFor="nc-ram">
                  Memory
                  <small>How much of this computer's memory Minecraft may use. Starts at your default from Settings.</small>
                </label>
                <div className="nc-a">
                  <div className="nc-range">
                    <input id="nc-ram" type="range" min={1} max={32} step={1} value={ram} aria-label="Allocated RAM" onChange={(e) => setRam(Number(e.target.value))} />
                    <output htmlFor="nc-ram">{ram} GB</output>
                  </div>
                </div>
              </div>

              <div className="nc-row">
                <label className="nc-q" htmlFor="nc-jvm">
                  Java arguments
                  <small>Optional. Leave empty unless a mod tells you to add some.</small>
                </label>
                <div className="nc-a">
                  <textarea
                    id="nc-jvm"
                    className="ui-input nc-textarea"
                    rows={2}
                    value={jvmArgs}
                    onChange={(e) => setJvmArgs(e.target.value)}
                    placeholder="Additional JVM arguments (optional)"
                    aria-label="Additional JVM arguments"
                  />
                  <p className="nc-hint">The right Java for this version is downloaded automatically. You can choose a different one in the instance's settings.</p>
                </div>
              </div>

              <div className="nc-row">
                <div className="nc-q">Starter mods</div>
                <div className="nc-a">
                  <label className="nc-check" data-testid="starter-toggle">
                    <input
                      type="checkbox"
                      checked={addStarter && starterCount > 0}
                      disabled={starterCount === 0}
                      onChange={(event) => setAddStarter(event.target.checked)}
                    />
                    <span>
                      Add starter mods ({starterCount})
                      <small>
                        {!hasLoader && starterList.some((entry) => entry.enabled && entry.type === "mod")
                          ? "Mods need a mod loader, so only packs are added."
                          : "Choose which ones in Settings."}
                      </small>
                    </span>
                  </label>
                </div>
              </div>
            </>
          )}
        </div>

        {/* What will be made, and the button that makes it. */}
        <aside className="nc-summary" aria-label="What will be made">
          {startFrom === "modpack" && pack?.icon ? (
            <span className="nc-summary-icon">
              <img src={pack.icon} alt="" />
            </span>
          ) : (
            <InstanceArt name={nameValue || (startFrom === "modpack" ? pack?.name : "") || "?"} cols={12} rows={5} />
          )}
          <p className={`nc-summary-name${nameValue.trim() ? "" : " blank"}`}>{nameValue.trim() || "Name your instance"}</p>
          <dl>
            {startFrom === "modpack" ? (
              <>
                <dt>Modpack</dt>
                <dd>{pack ? pack.name : "Not chosen yet"}</dd>
                <dt>From</dt>
                <dd>{pack ? siteName(installableSource(pack)?.source ?? pack.source) : "..."}</dd>
                <dt>Memory</dt>
                <dd>Set by the pack</dd>
              </>
            ) : (
              <>
                <dt>Minecraft</dt>
                <dd>{version || "Not chosen yet"}</dd>
                <dt>Loader</dt>
                <dd>
                  {loaderLabel}
                  {hasLoader ? ` ${loaderVersion || "(latest)"}` : ""}
                </dd>
                <dt>Memory</dt>
                <dd>{ram} GB</dd>
                <dt>Starter mods</dt>
                <dd>{addStarter && starterCount > 0 ? `${starterCount} added` : "None"}</dd>
              </>
            )}
          </dl>

          {!done && (
            <>
              <Button variant="primary" size="lg" icon={<Plus size={18} aria-hidden="true" />} disabled={creating} onClick={create}>
                {creating ? "Installing..." : "Create Instance"}
              </Button>
              <Button variant="ghost" onClick={onCancel} disabled={creating}>
                Cancel
              </Button>
            </>
          )}

          {creating && progress && (
            <div className="nc-progress" role="status">
              <strong>
                {progress.detail ?? progress.stage} ({progress.percent}%)
              </strong>
              <div className="nc-track">
                <div style={{ width: `${progress.percent}%` }} />
              </div>
              {progress.stage === "starter"
                ? "Adding your starter mods and what they need."
                : "Downloading Minecraft, libraries and assets. The first install of a version takes a few minutes."}
            </div>
          )}

          {createError && (
            <Notice tone="danger" style={{ whiteSpace: "pre-wrap" }}>
              {createError}
            </Notice>
          )}

          {packNotice && (
            <Notice tone="warning">
              <div className="nc-result">
                <p>{packNotice}</p>
                <Button variant="primary" onClick={() => onDone(packDoneName ?? undefined)}>
                  Done
                </Button>
              </div>
            </Notice>
          )}

          {starterResult && (
            <Notice tone="success" data-testid="starter-result">
              <div className="nc-result">
                <p>
                  Made {starterResult.name}. Added {starterResult.summary.added.length} starter
                  {starterResult.summary.added.length === 1 ? " mod" : " mods"}
                  {starterResult.summary.dependencies.length ? `, plus ${starterResult.summary.dependencies.length} they need` : ""}.
                </p>
                {starterResult.summary.unavailable.length > 0 && (
                  <p>
                    No build for Minecraft {starterResult.version} yet, so skipped: {starterResult.summary.unavailable.join(", ")}
                  </p>
                )}
                {starterResult.summary.failed.length > 0 && (
                  <p style={{ color: "var(--color-danger-text)" }}>
                    Couldn't add: {starterResult.summary.failed.map((item) => `${item.name} (${item.reason})`).join("; ")}
                  </p>
                )}
                <Button variant="primary" onClick={() => onDone(starterResult.name)}>
                  Done
                </Button>
              </div>
            </Notice>
          )}
        </aside>
      </div>
    </>
  );
}
