const SOURCE_COLORS = {
  modrinth: "#22c55e",
  curseforge: "#ef4444",
};

/* Where a project is listed, with its download count on each site. */
export default function SourceDownloads({ sources }: { sources: CatalogSource[] }) {
  return (
    <>
      {sources.map((entry, index) => (
        <span key={entry.source} data-testid="source-downloads">
          {index > 0 ? " • " : ""}
          <span style={{ color: SOURCE_COLORS[entry.source], fontWeight: 700, textTransform: "uppercase" }}>
            {entry.source}
          </span>{" "}
          {entry.downloads.toLocaleString()} downloads
        </span>
      ))}
    </>
  );
}
