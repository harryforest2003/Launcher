import { color, font } from "../theme/tokens";

const SITE_NAMES = {
  modrinth: "Modrinth",
  curseforge: "CurseForge",
};

/* Where a project is listed, with its download count on each site. */
export default function SourceDownloads({ sources }: { sources: CatalogSource[] }) {
  return (
    <>
      {sources.map((entry, index) => (
        <span key={entry.source} data-testid="source-downloads">
          {index > 0 ? ", " : ""}
          <span style={{ color: color.text, fontWeight: font.weight.semibold }}>{SITE_NAMES[entry.source] ?? entry.source}</span>{" "}
          {entry.downloads.toLocaleString()} downloads
        </span>
      ))}
    </>
  );
}
