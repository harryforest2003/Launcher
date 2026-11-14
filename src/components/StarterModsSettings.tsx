import { useEffect, useState } from "react";
import { Check, CircleCheck, CircleX, Package, Search, Undo2, X } from "lucide-react";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import Segmented from "./ui/Segmented";
import "../theme/appearance.css";

type Props = {
  /** The section's id, for a page index to scroll to. */
  id?: string;
};

const TYPE_LABELS: Record<StarterMod["type"], string | null> = {
  mod: null,
  resourcepack: "Resource pack",
  shader: "Shader",
  datapack: "Data pack",
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
 * project can be turned off without losing it, or removed (with Undo), and the list can go
 * back to how it started.
 */
export default function StarterModsSettings({ id = "starter-mods" }: Props) {
  const [list, setList] = useState<StarterMod[] | null>(null);
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<StarterMod["type"]>("mod");
  const [results, setResults] = useState<CatalogItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The list before the last removal, for Undo.
  const [undo, setUndo] = useState<StarterMod[] | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    window.instanceAPI
      .starterModsList()
      .then(setList)
      .catch((err) => setError(message(err)));
  }, []);

  // Reset waits a few seconds for its second press, then stands down.
  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmReset]);

  async function run(action: () => Promise<StarterMod[]>, done?: string, before: StarterMod[] | null = null) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setUndo(null);

    try {
      setList(await action());
      if (done) setNotice(done);
      setUndo(before);
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

  const save = (next: StarterMod[], done?: string, before: StarterMod[] | null = null) =>
    run(() => window.instanceAPI.starterModsSave(next), done, before);
  const on = list?.filter((entry) => entry.enabled).length ?? 0;
  const searchLabel = SEARCH_TYPES.find((option) => option.value === searchType)?.label.toLowerCase() ?? "mods";

  return (
    <section id={id} aria-labelledby={`${id}-title`} className="ui-panel set-panel" data-testid="starter-mods">
      <div className="set-panel-head">
        <div>
          <h2 id={`${id}-title`} className="set-panel-title">
            <Package size={18} aria-hidden="true" />
            Starter mods
          </h2>
          <p className="set-lead">
            Added to every new instance, in the build for its Minecraft version and loader, with whatever each one needs. One with
            no build for that version is skipped, and Create Instance says which. Mods only go into instances with a mod loader.
          </p>
        </div>
      </div>

      {list && (
        <>
          <div className="set-toolbar">
            <span data-testid="starter-count" className="set-count">
              <strong>{on}</strong> of {list.length} on
            </span>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => save(list.map((entry) => ({ ...entry, enabled: true })))}>
              All on
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => save(list.map((entry) => ({ ...entry, enabled: false })))}>
              All off
            </Button>
            <Button
              variant={confirmReset ? "danger" : "ghost"}
              size="sm"
              disabled={busy}
              onClick={() => {
                if (!confirmReset) {
                  setConfirmReset(true);
                  return;
                }
                setConfirmReset(false);
                run(() => window.instanceAPI.starterModsReset(), "Back to the original list.", list);
              }}
            >
              {confirmReset ? "Reset? Ones you added will go" : "Reset"}
            </Button>
          </div>

          {list.length === 0 ? (
            <p className="set-help">Nothing yet. Search below to add a mod every new instance should have.</p>
          ) : (
            <ul className="set-ticks">
              {list.map((entry) => (
                <li key={`${entry.source}:${entry.projectId}`} data-testid="starter-mod" className="set-tick-row">
                  <label className={`set-check${entry.enabled ? "" : " set-check--off"}`} title={entry.name}>
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      disabled={busy}
                      onChange={() => save(list.map((other) => (other === entry ? { ...other, enabled: !other.enabled } : other)))}
                    />
                    <span className="set-check-box" aria-hidden="true">
                      {entry.enabled && <Check size={13} strokeWidth={3} />}
                    </span>
                    <span className="set-check-name">{entry.name}</span>
                    {TYPE_LABELS[entry.type] && <Badge>{TYPE_LABELS[entry.type]}</Badge>}
                  </label>
                  <Button
                    variant="ghost"
                    className="set-icon-button"
                    aria-label={`Remove ${entry.name}`}
                    title={`Remove ${entry.name}`}
                    disabled={busy}
                    onClick={() => save(list.filter((other) => other !== entry), `Removed ${entry.name}.`, list)}
                  >
                    <X size={16} aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p role="alert" className="set-message set-message--danger" style={{ marginTop: "var(--space-3)" }}>
              <CircleX size={14} aria-hidden="true" />
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="set-message set-message--success" style={{ marginTop: "var(--space-3)", alignItems: "center" }}>
              <CircleCheck size={14} aria-hidden="true" style={{ marginTop: 0 }} />
              {notice}
              {undo && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Undo2 size={14} aria-hidden="true" />}
                  disabled={busy}
                  onClick={() => save(undo, "Put back.")}
                >
                  Undo
                </Button>
              )}
            </p>
          )}

          <div data-testid="starter-search">
            <div className="set-search">
              <div className="set-search-field">
                <Search size={16} aria-hidden="true" />
                <input
                  className="ui-input"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search ${searchLabel} to add...`}
                  aria-label="Search for a starter mod"
                />
              </div>
              <Segmented label="What to search for" value={searchType} options={SEARCH_TYPES} onChange={setSearchType} />
            </div>

            {searching && <p className="set-message set-message--muted" style={{ marginTop: "var(--space-2)" }}>Searching...</p>}

            {shown && !searching && shown.length === 0 && (
              <p className="set-message set-message--muted" style={{ marginTop: "var(--space-2)" }}>
                Nothing found.
              </p>
            )}

            {shown && shown.length > 0 && (
              <ul className="set-list set-results" aria-label="Search results">
                {shown.map((item) => {
                  const added = inList(item);
                  const source = preferredSource(item);

                  return (
                    <li key={`${item.source}:${item.id}`} data-testid="starter-result-row" className="set-item">
                      {item.icon ? (
                        <img src={item.icon} alt="" width={32} height={32} className="set-icon" />
                      ) : (
                        <span className="set-monogram" aria-hidden="true">
                          {item.name.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <div className="set-item-text">
                        <div className="set-item-name">
                          <span>{item.name}</span>
                        </div>
                        <div className="set-item-meta">
                          {item.sources.map((entry) => (entry.source === "modrinth" ? "Modrinth" : "CurseForge")).join(" + ")},{" "}
                          {formatDownloads(item.downloads)} downloads. {item.summary}
                        </div>
                      </div>
                      {added ? (
                        <Badge tone="success">
                          <Check size={12} aria-hidden="true" />
                          Added
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busy || !source}
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
                          {source ? "Add" : "Can't add"}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {!list && error && (
        <p role="alert" className="set-message set-message--danger">
          <CircleX size={14} aria-hidden="true" />
          {error}
        </p>
      )}
    </section>
  );
}
