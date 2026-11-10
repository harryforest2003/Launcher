import { useEffect, useState } from "react";

const card: React.CSSProperties = {
  background: "#151515",
  border: "1px solid #6d28d9",
  borderRadius: 12,
  padding: 20,
  maxWidth: 760,
};

const fieldStyle: React.CSSProperties = {
  flex: "1 1 240px",
  minWidth: 0,
  padding: 10,
  borderRadius: 10,
  background: "#1b1b1b",
  color: "white",
  border: "1px solid #6d28d9",
};

const TYPE_LABELS: Record<StarterMod["type"], string | null> = {
  mod: null,
  resourcepack: "resource pack",
  shader: "shader",
  datapack: "data pack",
};

const SEARCH_TYPES: { value: StarterMod["type"]; label: string }[] = [
  { value: "mod", label: "Mods" },
  { value: "resourcepack", label: "Resource packs" },
  { value: "shader", label: "Shaders" },
  { value: "datapack", label: "Data packs" },
];

// The listing to add from: Modrinth's when a project is on both sites and it allows installs.
function preferredSource(item: CatalogItem) {
  const usable = item.sources.filter((source) => source.installable);
  return usable.find((source) => source.source === "modrinth") ?? usable[0] ?? null;
}

const formatDownloads = (count: number) =>
  count >= 1e6 ? `${(count / 1e6).toFixed(1)}M` : count >= 1e3 ? `${Math.round(count / 1e3)}K` : String(count);

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/*
 * The projects added to every new instance. Each change is saved straight away. A
 * project can be turned off without losing it, or removed, and the list can go back
 * to how it started.
 */
export default function StarterModsSettings() {
  const [list, setList] = useState<StarterMod[] | null>(null);
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<StarterMod["type"]>("mod");
  const [results, setResults] = useState<CatalogItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    window.instanceAPI
      .starterModsList()
      .then(setList)
      .catch((err) => setError(message(err)));
  }, []);

  async function run(action: () => Promise<StarterMod[]>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      setList(await action());
      if (done) setNotice(done);
    } catch (err) {
      setError(message(err));
    }

    setBusy(false);
  }

  // Searches the launcher's catalog a moment after typing stops.
  useEffect(() => {
    const text = query.trim();
    if (!text) return;

    let current = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const page = await window.launcherAPI.browseCatalog({ query: text, type: searchType, sort: "relevance", page: 1 });
        if (current) setResults(page.items.slice(0, 8));
      } catch (err) {
        if (current) setError(message(err));
      }
      if (current) setSearching(false);
    }, 350);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, searchType]);

  // Results for an emptied search box aren't shown.
  const shown = query.trim() ? results : null;

  const inList = (item: CatalogItem) =>
    !!list?.some(
      (entry) =>
        item.sources.some((source) => source.source === entry.source && source.id === entry.projectId) ||
        entry.name.toLowerCase() === item.name.toLowerCase()
    );

  const save = (next: StarterMod[], done?: string) => run(() => window.instanceAPI.starterModsSave(next), done);
  const on = list?.filter((entry) => entry.enabled).length ?? 0;

  return (
    <div style={card} data-testid="starter-mods">
      <h2 style={{ color: "#d8b4fe", marginBottom: 6 }}>Starter mods</h2>

      <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 12 }}>
        Added to every new instance, in the build for its Minecraft version and loader, with
        whatever each one needs. One with no build for that version is skipped, and Create
        Instance says which. Mods are only added to instances with a mod loader.
      </p>

      {list && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <span data-testid="starter-count" style={{ color: "#d4d4d8", fontSize: 13, marginRight: "auto" }}>
              {on} of {list.length} on
            </span>
            <button
              className="sidebar-button"
              style={{ padding: "4px 10px", fontSize: 12 }}
              disabled={busy}
              onClick={() => save(list.map((entry) => ({ ...entry, enabled: true })))}
            >
              All on
            </button>
            <button
              className="sidebar-button"
              style={{ padding: "4px 10px", fontSize: 12 }}
              disabled={busy}
              onClick={() => save(list.map((entry) => ({ ...entry, enabled: false })))}
            >
              All off
            </button>
            <button
              className="sidebar-button"
              style={{ padding: "4px 10px", fontSize: 12 }}
              disabled={busy}
              onClick={() => {
                if (window.confirm("Put the starter mods back to the original list? Ones you added will go.")) {
                  run(() => window.instanceAPI.starterModsReset(), "Back to the original list.");
                }
              }}
            >
              Reset
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
              gap: "4px 14px",
              marginBottom: 14,
            }}
          >
            {list.map((entry) => (
              <div
                key={`${entry.source}:${entry.projectId}`}
                data-testid="starter-mod"
                style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flex: 1,
                    minWidth: 0,
                    color: entry.enabled ? "#e4e4e7" : "#6b7280",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    disabled={busy}
                    onChange={() =>
                      save(list.map((other) => (other === entry ? { ...other, enabled: !other.enabled } : other)))
                    }
                  />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={entry.name}>
                    {entry.name}
                    {TYPE_LABELS[entry.type] && (
                      <span style={{ color: "#a78bfa", fontSize: 11 }}> ({TYPE_LABELS[entry.type]})</span>
                    )}
                  </span>
                </label>
                <button
                  aria-label={`Remove ${entry.name}`}
                  title={`Remove ${entry.name}`}
                  disabled={busy}
                  onClick={() => save(list.filter((other) => other !== entry), `Removed ${entry.name}.`)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#6b7280",
                    cursor: "pointer",
                    fontSize: 16,
                    lineHeight: 1,
                    padding: "0 4px",
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div data-testid="starter-search">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search for a mod to add..."
                aria-label="Search for a starter mod"
                style={fieldStyle}
              />
              <select
                aria-label="What to search for"
                value={searchType}
                onChange={(event) => setSearchType(event.target.value as StarterMod["type"])}
                style={{ ...fieldStyle, flex: "0 0 auto" }}
              >
                {SEARCH_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {searching && <p style={{ color: "#9ca3af", fontSize: 12, margin: "8px 0 0" }}>Searching...</p>}

            {shown && !searching && shown.length === 0 && (
              <p style={{ color: "#9ca3af", fontSize: 12, margin: "8px 0 0" }}>Nothing found.</p>
            )}

            {shown && shown.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                {shown.map((item) => {
                  const added = inList(item);
                  const source = preferredSource(item);

                  return (
                    <div
                      key={`${item.source}:${item.id}`}
                      data-testid="starter-result-row"
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: 6, borderRadius: 8, background: "#1b1b1b" }}
                    >
                      {item.icon ? (
                        <img src={item.icon} alt="" width={32} height={32} style={{ borderRadius: 6, flex: "0 0 auto" }} />
                      ) : (
                        <div style={{ width: 32, height: 32, borderRadius: 6, background: "#2b1d47", flex: "0 0 auto" }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                        <div style={{ color: "#ede9fe", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.name}
                        </div>
                        <div style={{ color: "#6b7280", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.sources.map((entry) => (entry.source === "modrinth" ? "Modrinth" : "CurseForge")).join(" + ")} ·{" "}
                          {formatDownloads(item.downloads)} downloads · {item.summary}
                        </div>
                      </div>
                      <button
                        className="sidebar-button"
                        style={{ padding: "4px 12px", fontSize: 12, background: added || !source ? undefined : "#7c3aed" }}
                        disabled={busy || added || !source}
                        title={!source ? "Its author doesn't allow launchers to download it." : undefined}
                        onClick={() =>
                          source &&
                          run(
                            () =>
                              window.instanceAPI.starterModsAdd({
                                source: source.source,
                                projectId: source.id,
                                name: item.name,
                                type: searchType,
                              }),
                            `Added ${item.name}.`
                          )
                        }
                      >
                        {added ? "Added" : source ? "Add" : "Can't add"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {error && (
        <p role="alert" style={{ color: "#fca5a5", fontSize: 13, margin: "8px 0 0" }}>
          {error}
        </p>
      )}
      {notice && <p style={{ color: "#86efac", fontSize: 13, margin: "8px 0 0" }}>{notice}</p>}
    </div>
  );
}
