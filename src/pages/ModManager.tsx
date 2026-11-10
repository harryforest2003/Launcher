import { useCallback, useEffect, useState } from "react";

type Props = {
  game: DetectedGame;
  onBack: () => void;
};

type Tab = "installed" | "browse";

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

  /* ---------------- installed ---------------- */
  const [mods, setMods] = useState<InstalledMod[]>([]);
  const [loadingMods, setLoadingMods] = useState(false);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMods = useCallback(async () => {
    setLoadingMods(true);
    setError(null);

    try {
      setMods(await window.modAPI.list(game.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMods([]);
    }

    setLoadingMods(false);
  }, [game.id]);

  useEffect(() => {
    loadMods();
  }, [loadMods]);

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

  async function remove(mod: InstalledMod) {
    if (!confirm(`Delete "${mod.name}" permanently?`)) return;

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
  const [searching, setSearching] = useState(false);
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
    setSearching(true);

    window.modAPI
      .search(game.id, debounced)
      .then((r) => {
        if (!active) return;
        setResults(r.results);
        setWarnings(r.warnings);
      })
      .catch((err) => {
        if (!active) return;
        setResults([]);
        setWarnings([err instanceof Error ? err.message : String(err)]);
      })
      .finally(() => {
        if (active) setSearching(false);
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

  const card: React.CSSProperties = {
    background: "#151515",
    border: "1px solid #6d28d9",
    borderRadius: 12,
    padding: 16,
  };

  return (
    <div style={{ flex: 1, padding: 30, overflowY: "auto" }}>
      <button
        className="sidebar-button"
        onClick={onBack}
        style={{ marginBottom: 20 }}
      >
        ← All Games
      </button>

      <h1 style={{ color: "#c084fc", marginBottom: 6 }}>{game.name}</h1>

      <p style={{ color: "#9ca3af", marginBottom: 6 }}>
        {mods.length} mod{mods.length === 1 ? "" : "s"} installed •{" "}
        {enabledCount} enabled • detected via {game.source}
      </p>

      <p
        style={{
          color: "#6b7280",
          fontSize: 12,
          marginBottom: 16,
          wordBreak: "break-all",
        }}
      >
        {game.modDir ?? "No mod folder configured"}
      </p>

      {game.notes && (
        <div
          style={{
            ...card,
            borderColor: "#7c3aed",
            background: "#1a1130",
            marginBottom: 16,
            color: "#d8b4fe",
            fontSize: 13,
          }}
        >
          {game.notes}
        </div>
      )}

      {game.windowsOnlyModding && navigator.platform.includes("Mac") && (
        <div
          style={{
            ...card,
            borderColor: "#b45309",
            background: "#2a1a05",
            marginBottom: 16,
            color: "#fcd34d",
            fontSize: 13,
          }}
        >
          Modding this game relies on Windows-only tooling. You can manage
          files here, but the mods will not run on macOS.
        </div>
      )}

      {error && (
        <div
          style={{
            ...card,
            borderColor: "#ef4444",
            background: "#2a0d0d",
            marginBottom: 16,
            color: "#fca5a5",
            fontSize: 13,
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}

      {/* ACTIONS */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <button className="sidebar-button" onClick={() => setTab("installed")}
          style={{ opacity: tab === "installed" ? 1 : 0.6 }}>
          Installed ({mods.length})
        </button>

        <button className="sidebar-button" onClick={() => setTab("browse")}
          style={{ opacity: tab === "browse" ? 1 : 0.6 }}>
          Browse Online
        </button>

        <button className="sidebar-button" onClick={installFromFile}>
          Install from File
        </button>

        <button
          className="sidebar-button"
          onClick={() => window.modAPI.openFolder(game.id).catch(() => {})}
        >
          Open Mods Folder
        </button>

        <button className="sidebar-button" onClick={loadMods}>
          Refresh
        </button>
      </div>

      {/* ---------------- INSTALLED ---------------- */}
      {tab === "installed" && (
        <>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter installed mods..."
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 10,
              background: "#1b1b1b",
              color: "white",
              border: "1px solid #6d28d9",
              boxSizing: "border-box",
              marginBottom: 16,
            }}
          />

          {loadingMods ? (
            <div style={{ color: "#9ca3af" }}>Scanning mod folder...</div>
          ) : visible.length === 0 ? (
            <div style={{ ...card, color: "#9ca3af" }}>
              {mods.length === 0
                ? "No mods installed yet. Use “Install from File”, or browse online."
                : "No mods match that filter."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {visible.map((mod) => (
                <div
                  key={mod.relativePath}
                  style={{
                    ...card,
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    opacity: mod.enabled ? 1 : 0.55,
                    borderColor: mod.enabled ? "#6d28d9" : "#3f3f46",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "#c084fc", fontWeight: 600 }}>
                      {mod.name}
                    </div>

                    <div
                      style={{
                        fontSize: 12,
                        color: "#888",
                        wordBreak: "break-all",
                      }}
                    >
                      {mod.relativePath}
                    </div>

                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                      {mod.kind} • {formatBytes(mod.size)}
                      {mod.source ? ` • from ${mod.source}` : ""}
                      {mod.enabled ? "" : " • disabled"}
                    </div>
                  </div>

                  <button
                    className="sidebar-button"
                    disabled={busy === mod.relativePath}
                    onClick={() => toggle(mod)}
                    style={{
                      minWidth: 100,
                      background: mod.enabled ? "#6d28d9" : "#3f3f46",
                    }}
                  >
                    {busy === mod.relativePath
                      ? "..."
                      : mod.enabled
                      ? "Disable"
                      : "Enable"}
                  </button>

                  <button
                    className="sidebar-button"
                    disabled={busy === mod.relativePath}
                    onClick={() => remove(mod)}
                    style={{ background: "#7f1d1d" }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ---------------- BROWSE ---------------- */}
      {tab === "browse" && (
        <>
          {game.availableProviders.length === 0 ? (
            <div style={{ ...card, color: "#9ca3af" }}>
              No mod site with a public API carries {game.name}, so there is
              nothing to search here. Download mods from the community site you
              use, then press <b>Install from File</b> — everything else on this
              page still works.
            </div>
          ) : (
            <>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${game.availableProviders
                  .map((p) => p.label)
                  .join(" + ")}...`}
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 10,
                  background: "#1b1b1b",
                  color: "white",
                  border: "1px solid #6d28d9",
                  boxSizing: "border-box",
                  marginBottom: 12,
                }}
              />

              {warnings.map((w, i) => (
                <div
                  key={i}
                  style={{
                    ...card,
                    borderColor: "#b45309",
                    background: "#2a1a05",
                    color: "#fcd34d",
                    fontSize: 12,
                    marginBottom: 10,
                  }}
                >
                  {w}
                </div>
              ))}

              {searching ? (
                <div style={{ color: "#9ca3af" }}>Searching...</div>
              ) : results.length === 0 ? (
                <div style={{ ...card, color: "#9ca3af" }}>No results.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {results.map((mod) => (
                    <div
                      key={`${mod.provider}-${mod.id}`}
                      style={{ ...card, display: "flex", gap: 14, alignItems: "center" }}
                    >
                      {mod.icon && (
                        <img
                          src={mod.icon}
                          alt=""
                          style={{
                            width: 60,
                            height: 60,
                            borderRadius: 10,
                            objectFit: "cover",
                            flexShrink: 0,
                          }}
                        />
                      )}

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: "#c084fc", fontWeight: 600 }}>
                          {mod.name}
                        </div>

                        <div style={{ fontSize: 12, color: "#aaa" }}>
                          {mod.summary?.slice(0, 140)}
                        </div>

                        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                          <span style={{ color: "#22c55e", fontWeight: 700 }}>
                            {mod.providerLabel}
                          </span>
                          {mod.author ? ` • ${mod.author}` : ""} •{" "}
                          {mod.downloads.toLocaleString()} downloads
                        </div>

                        {installing === mod.id && progress[mod.id] > 0 && (
                          <div
                            style={{
                              marginTop: 6,
                              height: 4,
                              background: "#333",
                              borderRadius: 2,
                            }}
                          >
                            <div
                              style={{
                                width: `${progress[mod.id]}%`,
                                height: "100%",
                                background: "#7c3aed",
                                borderRadius: 2,
                              }}
                            />
                          </div>
                        )}
                      </div>

                      {mod.installable ? (
                        <button
                          className="sidebar-button"
                          disabled={installing === mod.id}
                          onClick={() => install(mod)}
                          style={{ minWidth: 90, background: "#7c3aed" }}
                        >
                          {installing === mod.id ? "..." : "Install"}
                        </button>
                      ) : (
                        <button
                          className="sidebar-button"
                          title="This author does not allow third-party downloads"
                          onClick={() =>
                            mod.url && window.modAPI.openUrl(mod.url).catch(() => {})
                          }
                          style={{ minWidth: 90 }}
                        >
                          Open Site
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
