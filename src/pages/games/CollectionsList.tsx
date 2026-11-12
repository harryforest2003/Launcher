import { useEffect, useRef, useState } from "react";
import Pagination from "../../components/Pagination";
import { countText, errorText, note, shortDate, sizeText } from "./shared";

type Props = {
  detail: GameDetail;
  openCollection: (slug: string) => void;
};

const PAGE_SIZE = 20;
const SORTS = [
  { id: "popular", label: "Most endorsed" },
  { id: "downloads", label: "Most downloaded" },
  { id: "updated", label: "Recently updated" },
  { id: "new", label: "Newest" },
];

/* A game's Nexus Mods collections: whole lists of mods put together to go with each other. */
export default function CollectionsList({ detail, openCollection }: Props) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState("popular");
  const [loaded, setLoaded] = useState<{ key: string; result: { total: number; collections: GameCollectionSummary[] } | null; error: string | null } | null>(null);
  const filterKey = JSON.stringify([debounced, sort]);
  const [chosenPage, setChosenPage] = useState({ filterKey, page: 1 });
  const page = chosenPage.filterKey === filterKey ? chosenPage.page : 1;
  const listTop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const searchKey = JSON.stringify([detail.id, debounced, sort, page]);
  useEffect(() => {
    let active = true;
    window.gamesAPI
      .collections(detail.id, { query: debounced, sort, page: page - 1 })
      .then((result) => active && setLoaded({ key: searchKey, result, error: null }))
      .catch((err) => active && setLoaded({ key: searchKey, result: null, error: errorText(err) }));
    return () => {
      active = false;
    };
  }, [searchKey, detail.id, debounced, sort, page]);

  useEffect(() => {
    listTop.current?.scrollIntoView({ block: "start" });
  }, [page]);

  const loading = loaded?.key !== searchKey;
  const result = loaded?.result ?? null;
  const pageCount = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const dropdownStyle = { padding: "10px 12px", borderRadius: 10, background: "#1b1b1b", color: "white", border: "1px solid #6d28d9", fontSize: 13 };

  return (
    <div>
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={`Search ${detail.name} collections...`}
        style={{ width: "100%", padding: 14, borderRadius: 10, background: "#1b1b1b", color: "white", border: "1px solid #6d28d9", boxSizing: "border-box" }}
      />
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <select style={dropdownStyle} value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort collections by">
          {SORTS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {!loading && loaded?.error && <div style={{ ...note("warn"), marginTop: 16 }}>{loaded.error}</div>}
      <div ref={listTop} style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        {result && (
          <div style={{ fontSize: 12, color: "#9ca3af" }}>
            {result.total.toLocaleString()} collections • Page {page} of {pageCount}
          </div>
        )}
        {result && <Pagination page={page} pageCount={pageCount} disabled={loading} onChange={(next) => setChosenPage({ filterKey, page: next })} />}
      </div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {loading ? (
          <div>Loading...</div>
        ) : !result?.collections.length ? (
          <div style={{ color: "#9ca3af", padding: 20 }}>No collections found{search.trim() ? ` for "${search.trim()}"` : ""}.</div>
        ) : (
          result.collections.map((collection) => (
            <div
              key={collection.slug}
              className="game-card"
              data-testid="collection-card"
              role="button"
              tabIndex={0}
              aria-label={`Open ${collection.name}`}
              onClick={() => openCollection(collection.slug)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openCollection(collection.slug);
                }
              }}
              style={{ display: "flex", alignItems: "center", gap: 14, minHeight: 100, padding: 12, cursor: "pointer" }}
            >
              <div style={{ width: 124, height: 70, borderRadius: 10, overflow: "hidden", border: "1px solid #6d28d9", flexShrink: 0, background: "#1b1b1b" }}>
                {collection.picture ? <img src={collection.picture} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <div style={{ fontWeight: 600, color: "#c084fc" }}>{collection.name}</div>
                <div style={{ fontSize: 12, color: "#aaa" }}>{collection.summary.slice(0, 180)}</div>
                <div style={{ fontSize: 11, marginTop: 4, color: "#d4d4d8", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ padding: "1px 6px", borderRadius: 5, background: "#d97706", color: "white", fontWeight: 700, fontSize: 10 }}>COLLECTION</span>
                  <span>by {collection.author}</span>
                  <span>{collection.mods} mods</span>
                  <span>{sizeText(collection.size)}</span>
                  <span>♥ {countText(collection.endorsements)}</span>
                  <span>↓ {countText(collection.downloads)}</span>
                  {collection.updated && <span>updated {shortDate(collection.updated)}</span>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      {result && !loading && result.collections.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Pagination page={page} pageCount={pageCount} onChange={(next) => setChosenPage({ filterKey, page: next })} />
        </div>
      )}
    </div>
  );
}
