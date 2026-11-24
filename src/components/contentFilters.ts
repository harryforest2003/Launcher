/* What the content list's Filter card can narrow it by, and its starting state. */

export type SortBy = "name" | "recent" | "size" | "updates";

export type Filters = {
  /** Types to show; all of them to start with. */
  types: ContentType[];
  /** The rest narrow the list when anything in them is ticked. */
  authors: string[];
  state: ("on" | "off")[];
  updates: ("update" | "kept" | "current" | "unknown")[];
  sources: string[];
  sort: SortBy;
};

export const ALL_TYPES: { type: ContentType; label: string }[] = [
  { type: "mod", label: "Mods" },
  { type: "resourcepack", label: "Resource Packs" },
  { type: "shader", label: "Shaders" },
  { type: "datapack", label: "Data Packs" },
];

export const NO_FILTERS: Filters = { types: ALL_TYPES.map((t) => t.type), authors: [], state: [], updates: [], sources: [], sort: "name" };

/* How many filters are narrowing the list, for the Filter button. */
export function activeFilterCount(filters: Filters) {
  return (
    (filters.types.length < ALL_TYPES.length ? 1 : 0) +
    (filters.authors.length ? 1 : 0) +
    (filters.state.length ? 1 : 0) +
    (filters.updates.length ? 1 : 0) +
    (filters.sources.length ? 1 : 0)
  );
}

export type FilterCounts = {
  types: Record<string, number>;
  authors: [string, number][];
  state: Record<string, number>;
  updates: Record<string, number>;
  sources: [string, number][];
};
