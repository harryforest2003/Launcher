import { useEffect, useState } from "react";
import { ALL_TYPES, NO_FILTERS, activeFilterCount, type FilterCounts, type Filters, type SortBy } from "./contentFilters";

type Props = {
  filters: Filters;
  counts: FilterCounts;
  /** How many items the filters show, for the Done button. */
  matching: number;
  onChange: (filters: Filters) => void;
  onClose: () => void;
};

const SORTS: { value: SortBy; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "recent", label: "Recently added" },
  { value: "size", label: "Size" },
  { value: "updates", label: "Updates first" },
];

const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

/* A card over the page for choosing what the content list shows. */
export default function ContentFilter({ filters, counts, matching, onChange, onClose }: Props) {
  const [authorSearch, setAuthorSearch] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const authors = counts.authors.filter(([name]) => name.toLowerCase().includes(authorSearch.trim().toLowerCase()));

  return (
    <div
      data-testid="filter-overlay"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "var(--color-scrim)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        role="dialog"
        aria-label="Filter content"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 100%)",
          maxHeight: "min(720px, 90vh)",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          boxShadow: "0 20px 60px var(--color-shadow)",
          textAlign: "left",
          color: "var(--color-text-secondary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--color-border)" }}>
          <span style={{ fontSize: 17, fontWeight: 600, color: "var(--color-accent-text)" }}>Filter content</span>
          <button aria-label="Close" onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--color-text-muted)", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>
            ×
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "8px 20px 16px" }}>
          <Section title="Type" hint="Untick a type to hide it">
            <Grid>
              {ALL_TYPES.map(({ type, label }) => (
                <Check key={type} label={label} count={counts.types[type] ?? 0} checked={filters.types.includes(type)} onChange={() => set({ types: toggle(filters.types, type) })} />
              ))}
            </Grid>
          </Section>

          <Section title="Turned on or off">
            <Grid>
              <Check label="On" count={counts.state.on ?? 0} checked={filters.state.includes("on")} onChange={() => set({ state: toggle(filters.state, "on") })} />
              <Check label="Off" count={counts.state.off ?? 0} checked={filters.state.includes("off")} onChange={() => set({ state: toggle(filters.state, "off") })} />
            </Grid>
          </Section>

          <Section title="Updates">
            <Grid>
              <Check label="Has an update" count={counts.updates.update ?? 0} checked={filters.updates.includes("update")} onChange={() => set({ updates: toggle(filters.updates, "update") })} />
              <Check label="Up to date" count={counts.updates.current ?? 0} checked={filters.updates.includes("current")} onChange={() => set({ updates: toggle(filters.updates, "current") })} />
              <Check label="Can't be checked" count={counts.updates.unknown ?? 0} checked={filters.updates.includes("unknown")} onChange={() => set({ updates: toggle(filters.updates, "unknown") })} />
            </Grid>
          </Section>

          {counts.sources.length > 1 && (
            <Section title="Source">
              <Grid>
                {counts.sources.map(([source, count]) => (
                  <Check key={source} label={source} count={count} checked={filters.sources.includes(source)} onChange={() => set({ sources: toggle(filters.sources, source) })} />
                ))}
              </Grid>
            </Section>
          )}

          <Section
            title={`Author${filters.authors.length ? ` (${filters.authors.length} ticked)` : ""}`}
            hint="Tick authors to see only their content"
            extra={
              counts.authors.length > 8 && (
                <input
                  value={authorSearch}
                  onChange={(e) => setAuthorSearch(e.target.value)}
                  placeholder="Find an author..."
                  aria-label="Find an author"
                  style={{ padding: "5px 9px", borderRadius: 8, background: "var(--color-surface-sunken)", color: "var(--color-text)", border: "1px solid var(--color-border)", fontSize: 12, width: 150 }}
                />
              )
            }
          >
            {counts.authors.length ? (
              <div style={{ maxHeight: 210, overflowY: "auto", background: "var(--color-surface-sunken)", borderRadius: 10, padding: "6px 10px" }}>
                <Grid>
                  {authors.map(([author, count]) => (
                    <Check key={author} label={author} count={count} checked={filters.authors.includes(author)} onChange={() => set({ authors: toggle(filters.authors, author) })} />
                  ))}
                </Grid>
                {!authors.length && <div style={{ color: "var(--color-text-muted)", fontSize: 12, padding: 6 }}>No author matches.</div>}
              </div>
            ) : (
              <div style={{ color: "var(--color-text-muted)", fontSize: 12 }}>Finding authors...</div>
            )}
          </Section>

          <Section title="Sort by">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SORTS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => set({ sort: value })}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    fontSize: 13,
                    cursor: "pointer",
                    color: "var(--color-text)",
                    border: `1px solid ${filters.sort === value ? "var(--color-accent-line)" : "var(--color-border)"}`,
                    background: filters.sort === value ? "var(--color-accent-subtle)" : "var(--color-surface-sunken)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </Section>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderTop: "1px solid var(--color-border)" }}>
          <button
            onClick={() => onChange({ ...NO_FILTERS, sort: filters.sort })}
            disabled={!activeFilterCount(filters)}
            style={{ background: "none", border: "none", color: activeFilterCount(filters) ? "var(--color-accent-text)" : "var(--color-text-muted)", cursor: "pointer", fontSize: 13 }}
          >
            Clear filters
          </button>
          <button className="sidebar-button" data-testid="filter-done" onClick={onClose} style={{ marginLeft: "auto", padding: "8px 16px", fontSize: 13, background: "var(--color-accent)", color: "var(--color-on-accent)" }}>
            Show {matching} item{matching === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, hint, extra, children }: { title: string; hint?: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ padding: "12px 0", borderBottom: "1px solid var(--color-border)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.8, color: "var(--color-accent-text)", textTransform: "uppercase" }}>{title}</span>
        {hint && <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{hint}</span>}
        {extra && <span style={{ marginLeft: "auto" }}>{extra}</span>}
      </div>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "4px 16px" }}>{children}</div>;
}

function Check({ label, count, checked, onChange }: { label: string; count: number; checked: boolean; onChange: () => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13, cursor: "pointer", minWidth: 0 }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ accentColor: "var(--color-accent)", width: 15, height: 15, flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>({count})</span>
    </label>
  );
}
