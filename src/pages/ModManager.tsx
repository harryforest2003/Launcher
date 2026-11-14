import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, ExternalLink, FolderOpen, RefreshCw, Trash2, Upload } from "lucide-react";
import { Badge, Button, Notice, Panel } from "../components/ui";
import { usePageNav } from "../components/ui/shellContext";
import { initials } from "./playedAgo";
import "./homeScreens.css";

type Props = {
  game: DetectedGame;
  onBack: () => void;
};

type Tab = "installed" | "browse";

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );

  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function ModManager({ game, onBack }: Props) {
  const [tab, setTab] = useState<Tab>("installed");
  usePageNav({ area: "modGame", game: game.name, page: tab, go: setTab });

  /* ---------------- installed ---------------- */
  const [mods, setMods] = useState<InstalledMod[]>([]);
  const [loadingMods, setLoadingMods] = useState(true);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reads the mod folder; state is only set once the answer is in.
  const readMods = useCallback(
    () =>
      window.modAPI
        .list(game.id)
        .then(setMods)
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
          setMods([]);
        })
        .finally(() => setLoadingMods(false)),
    [game.id]
  );

  useEffect(() => {
    readMods();
  }, [readMods]);

  async function loadMods() {
    setLoadingMods(true);
    setError(null);
    await readMods();
  }

  async function toggle(mod: InstalledMod) {
    setBusy(mod.relativePath);
    setError(null);

    try {
      await window.modAPI.setEnabled(game.id, mod.relativePath, !mod.enabled);
      await loadMods();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    setBusy(null);
  }

  // Delete asks in place: the first press turns the button into "Delete for good?", which
  // goes back after 4 seconds.
  const [confirming, setConfirming] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);

  async function remove(mod: InstalledMod) {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    if (confirming !== mod.relativePath) {
      setConfirming(mod.relativePath);
      confirmTimer.current = setTimeout(() => setConfirming(null), 4000);
      return;
    }
    setConfirming(null);

    setBusy(mod.relativePath);
    setError(null);

    try {
      await window.modAPI.remove(game.id, mod.relativePath);
      await loadMods();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    setBusy(null);
  }

  async function installFromFile() {
    setError(null);

    try {
      const result = await window.modAPI.installFromFile(game.id);

      if (result.canceled) return;

      if (result.errors?.length) setError(result.errors.join("\n"));

      await loadMods();
      setTab("installed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /* ---------------- browse ---------------- */
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<RemoteMod[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  // The search the results on show answer; while it differs from the box, a search is running.
  const [resultsFor, setResultsFor] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (tab !== "browse") return;
    if (game.availableProviders.length === 0) return;

    let active = true;

    window.modAPI
      .search(game.id, debounced)
      .then((r) => {
        if (!active) return;
        setResults(r.results);
        setWarnings(r.warnings);
        setResultsFor(debounced);
      })
      .catch((err) => {
        if (!active) return;
        setResults([]);
        setWarnings([err instanceof Error ? err.message : String(err)]);
        setResultsFor(debounced);
      });

    return () => {
      active = false;
    };
  }, [tab, debounced, game.id, game.availableProviders.length]);

  useEffect(() => {
    return window.modAPI.onProgress(({ projectId, percent }) => {
      setProgress((p) => ({ ...p, [projectId]: percent }));
    });
  }, []);

  async function install(mod: RemoteMod) {
    setInstalling(mod.id);
    setError(null);

    try {
      await window.modAPI.install({
        gameId: game.id,
        provider: mod.provider,
        projectId: mod.id,
        name: mod.name,
      });

      await loadMods();
      setTab("installed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    setInstalling(null);
    setProgress((p) => ({ ...p, [mod.id]: 0 }));
  }

  /* ---------------- render ---------------- */

  const visible = mods.filter((m) =>
    m.name.toLowerCase().includes(filter.toLowerCase())
  );

  const enabledCount = mods.filter((m) => m.enabled).length;
  const searching = resultsFor !== debounced;

  return (
    <div className="app-page">
      <Button variant="ghost" className="mg-back" icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={onBack}>
        All games
      </Button>

      <header className="page-header" style={{ marginBottom: "var(--space-5)" }}>
        <h1 className="page-title">{game.name}</h1>
        <p className="page-lead">
          {mods.length} mod{mods.length === 1 ? "" : "s"} installed, {enabledCount} on. Found via {game.source}.
        </p>
        <p className="mg-path" style={{ marginTop: "var(--space-1)" }}>
          {game.modDir ?? "No mod folder configured"}
        </p>
      </header>

      {(game.notes || (game.windowsOnlyModding && navigator.platform.includes("Mac")) || error) && (
        <div className="mg-stack">
          {game.notes && <Notice tone="info">{game.notes}</Notice>}
          {game.windowsOnlyModding && navigator.platform.includes("Mac") && (
            <Notice tone="warning">
              Modding this game relies on Windows-only tools. You can manage files here, but the mods will not run on macOS.
            </Notice>
          )}
          {error && (
            <Notice tone="danger" style={{ whiteSpace: "pre-wrap" }}>
              {error}
            </Notice>
          )}
        </div>
      )}

      {/* Tabs, and what can be done to the mod folder */}
      <div className="mg-toolbar" style={{ marginBottom: 0, maxWidth: "var(--content-max)" }}>
        <div className="mg-tabs" role="tablist" aria-label="Mods" style={{ marginBottom: 0, flex: 1 }}>
          <button type="button" role="tab" className="mg-tab" aria-selected={tab === "installed"} onClick={() => setTab("installed")}>
            Installed<span className="mg-count">{mods.length}</span>
          </button>
          <button type="button" role="tab" className="mg-tab" aria-selected={tab === "browse"} onClick={() => setTab("browse")}>
            Browse online
          </button>
        </div>
        <div className="mg-toolbar__end">
          <Button size="sm" icon={<Upload size={14} aria-hidden="true" />} onClick={installFromFile}>
            Install from file
          </Button>
          <Button size="sm" variant="ghost" icon={<FolderOpen size={14} aria-hidden="true" />} onClick={() => window.modAPI.openFolder(game.id).catch(() => {})}>
            Open mods folder
          </Button>
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden="true" />} onClick={loadMods}>
            Refresh
          </Button>
        </div>
      </div>

      <div style={{ height: "var(--space-4)" }} />

      {/* ---------------- INSTALLED ---------------- */}
      {tab === "installed" && (
        <div role="tabpanel" aria-label="Installed">
          <input
            className="ui-input mg-search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter installed mods..."
            aria-label="Filter installed mods"
          />

          {loadingMods ? (
            <p className="mg-muted" role="status">Scanning mod folder...</p>
          ) : visible.length === 0 ? (
            <p className="mg-muted">
              {mods.length === 0
                ? "No mods installed yet. Use Install from file, or browse online."
                : "No mods match that filter."}
            </p>
          ) : (
            <ul className="mg-list">
              {visible.map((mod) => {
                const working = busy === mod.relativePath;
                const asking = confirming === mod.relativePath;
                return (
                  <li key={mod.relativePath} className={`mg-row${mod.enabled ? "" : " mg-row--off"}`}>
                    <div className="mg-row__main">
                      <div className="mg-row__name">
                        {mod.name}
                        <Badge tone={mod.enabled ? "success" : "neutral"}>{mod.enabled ? "On" : "Off"}</Badge>
                      </div>
                      <div className="mg-path">{mod.relativePath}</div>
                      <div className="mg-row__meta">
                        {mod.kind === "folder" ? "Folder" : "File"}, {formatBytes(mod.size)}
                        {mod.source ? `, from ${mod.source}` : ""}
                      </div>
                    </div>

                    <div className="mg-row__actions">
                      <Button size="sm" variant="secondary" disabled={working} onClick={() => toggle(mod)}>
                        {working ? "Working..." : mod.enabled ? "Turn off" : "Turn on"}
                      </Button>
                      <Button
                        size="sm"
                        variant={asking ? "danger" : "ghost"}
                        disabled={working}
                        icon={<Trash2 size={14} aria-hidden="true" />}
                        aria-label={asking ? `Delete ${mod.name} for good` : `Delete ${mod.name}`}
                        onClick={() => remove(mod)}
                      >
                        {asking ? "Delete for good?" : "Delete"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* ---------------- BROWSE ---------------- */}
      {tab === "browse" && (
        <div role="tabpanel" aria-label="Browse online">
          {game.availableProviders.length === 0 ? (
            <Panel tone="sunken" className="mg-empty">
              <p style={{ margin: 0 }} className="mg-muted">
                No mod site with a public API carries {game.name}, so there is nothing to search here. Download mods from
                the community site you use, then press <strong>Install from file</strong>: everything else on this page still works.
              </p>
            </Panel>
          ) : (
            <>
              <input
                className="ui-input mg-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${game.availableProviders.map((p) => p.label).join(" and ")}...`}
                aria-label={`Search ${game.availableProviders.map((p) => p.label).join(" and ")}`}
              />

              {warnings.length > 0 && (
                <div className="mg-stack" style={{ marginBottom: "var(--space-3)" }}>
                  {warnings.map((w, i) => (
                    <Notice key={i} tone="warning">
                      {w}
                    </Notice>
                  ))}
                </div>
              )}

              {searching ? (
                <p className="mg-muted" role="status">Searching...</p>
              ) : results.length === 0 ? (
                <p className="mg-muted">No results.</p>
              ) : (
                <ul className="mg-list">
                  {results.map((mod) => (
                    <li key={`${mod.provider}-${mod.id}`} className="mg-row">
                      {mod.icon ? (
                        <img className="mg-thumb" src={mod.icon} alt="" loading="lazy" />
                      ) : (
                        <span className="mg-thumb mh-monogram" style={{ width: 56, height: 56 }} aria-hidden="true">
                          {initials(mod.name)}
                        </span>
                      )}

                      <div className="mg-row__main">
                        <div className="mg-row__name">{mod.name}</div>
                        {mod.summary && <div className="mg-row__summary">{mod.summary}</div>}
                        <div className="mg-row__meta">
                          <strong style={{ color: "var(--color-accent-text)" }}>{mod.providerLabel}</strong>
                          {mod.author ? `, by ${mod.author}` : ""}, {compact.format(mod.downloads)} downloads
                        </div>

                        {installing === mod.id && progress[mod.id] > 0 && (
                          <div className="mg-progress" role="progressbar" aria-valuenow={Math.round(progress[mod.id])} aria-valuemin={0} aria-valuemax={100} aria-label={`Installing ${mod.name}`}>
                            <span style={{ width: `${progress[mod.id]}%` }} />
                          </div>
                        )}
                      </div>

                      <div className="mg-row__actions">
                        {mod.installable ? (
                          <Button size="sm" icon={<Download size={14} aria-hidden="true" />} disabled={installing === mod.id} onClick={() => install(mod)}>
                            {installing === mod.id ? "Installing..." : "Install"}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<ExternalLink size={14} aria-hidden="true" />}
                            data-tip="This author doesn't allow downloads from other apps: get it on the site"
                            onClick={() => mod.url && window.modAPI.openUrl(mod.url).catch(() => {})}
                          >
                            Open site
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
