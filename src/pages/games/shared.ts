/* Bits shared by a game section's pages. */

/* An error's message without Electron's "Error invoking remote method" wrapping. */
export function errorText(err: unknown) {
  return String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/* What playing "safely" leaves out, for each game: the mods that hook into its code. */
export const SAFE_PLAY: Record<GameId, { button: string; what: string }> = {
  sims4: { button: "Play with script mods off", what: "script mods (.ts4script)" },
  gtav: { button: "Play without script mods", what: "Script Hook V and ASI mods" },
  skyrimse: { button: "Play without SKSE", what: "SKSE and its plugins" },
  fallout4: { button: "Play without F4SE", what: "F4SE and its plugins" },
  cyberpunk2077: { button: "Play without CET and RED4ext", what: "Cyber Engine Tweaks and RED4ext mods" },
  stardew: { button: "Play without SMAPI", what: "SMAPI and its mods" },
};

/*
 * Other sites with mods for a game. They have no way for apps to list their mods (The Sims
 * Resource's terms forbid collecting them), so these open in the browser; what's downloaded
 * there is installed from Downloads on the Mods page.
 */
export const MORE_SITES: Partial<Record<GameId, { name: string; url: string; about: string }[]>> = {
  sims4: [
    { name: "Mod Collective", url: "https://www.modcollective.gg/sims4", about: "Thousands of mods and CC from many creators" },
    { name: "The Sims Resource", url: "https://www.thesimsresource.com/downloads/browse/category/sims4-mods/", about: "One of the biggest Sims CC sites" },
  ],
  gtav: [{ name: "GTA5-Mods.com", url: "https://www.gta5-mods.com/", about: "Where most GTA V script mods and vehicles are" }],
};

export function shortDate(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function sizeText(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function countText(value: number | null | undefined) {
  if (value == null) return "";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(value);
}

/* Where a finished install put things, in a sentence. */
export function installSummary(result: GameInstallResult) {
  const placed = Object.entries(result.placed ?? {}).map(([area, count]) => `${count} in ${area}`);
  const total = Object.values(result.placed ?? {}).reduce((sum, count) => sum + count, 0);
  return `Installed ${result.mod?.name ?? "the mod"}: ${total} file${total === 1 ? "" : "s"}${placed.length ? ` (${placed.join(", ")})` : ""}.`;
}

export const panel: React.CSSProperties = {
  background: "rgba(21, 21, 21, 0.88)",
  border: "1px solid #6d28d9",
  borderRadius: 12,
  padding: 16,
};

export const note = (tone: "warn" | "bad" | "good" | "info"): React.CSSProperties => ({
  padding: 14,
  borderRadius: 10,
  fontSize: 13,
  lineHeight: 1.5,
  ...{
    warn: { background: "#2a1a05", border: "1px solid #b45309", color: "#fcd34d" },
    bad: { background: "#2a0d0d", border: "1px solid #ef4444", color: "#fca5a5" },
    good: { background: "#0d2a12", border: "1px solid #166534", color: "#86efac" },
    info: { background: "#17141f", border: "1px solid #6d28d9", color: "#d8b4fe" },
  }[tone],
});

export const smallButton: React.CSSProperties = { padding: "8px 14px", fontSize: 13 };
