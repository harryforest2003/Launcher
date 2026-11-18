import { useEffect } from "react";

/* Bits shared by a game section's pages. */

/* How the Mods page's issue panels tell its issues strip what they found, and say what happened. */
export type IssueTone = "danger" | "warning" | "info";
export type IssueReport = (kind: string, count: number, tone: IssueTone) => void;
export type Say = (message: { tone: "good" | "bad" | "warn"; text: string; notes?: string[] }) => void;

/* Reports a panel's count to the strip, and zero when the panel goes. */
export function useIssueReport(report: IssueReport | undefined, kind: string, count: number, tone: IssueTone) {
  useEffect(() => {
    report?.(kind, count, tone);
  }, [report, kind, count, tone]);
  useEffect(() => () => report?.(kind, 0, "info"), [report, kind]);
}

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
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  padding: 16,
};

export const note = (tone: "warn" | "bad" | "good" | "info"): React.CSSProperties => ({
  padding: 14,
  borderRadius: 10,
  fontSize: 13,
  lineHeight: 1.5,
  ...{
    warn: { background: "var(--color-warning-bg)", border: "1px solid var(--color-warning-border)", color: "var(--color-warning-text)" },
    bad: { background: "var(--color-danger-bg)", border: "1px solid var(--color-danger-border)", color: "var(--color-danger-text)" },
    good: { background: "var(--color-success-bg)", border: "1px solid var(--color-success-border)", color: "var(--color-success-text)" },
    info: { background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-accent-text)" },
  }[tone],
});

export const smallButton: React.CSSProperties = { padding: "8px 14px", fontSize: 13 };

const list = (items: string[]) => (items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/* Whether fixing the load order would change anything. */
export const fixNeeded = (fix: GameLoadOrderFix | undefined) => Boolean(fix && (fix.turnOn.length || fix.turnOff.length || fix.moved.length || fix.get?.length));

/* What fixing the load order does (or did), in a sentence. */
export function fixSentence(fix: GameLoadOrderFix, done = false) {
  const parts: string[] = [];
  if (fix.turnOn.length) parts.push(`${done ? "turned on" : "turns on"} ${list(fix.turnOn.map((t) => `${t.name} (${t.for} needs it)`))}`);
  if (fix.get?.length)
    parts.push(
      `${done ? "is getting" : "gets"} ${list(
        fix.get.map((g) =>
          g.kind === "nexus"
            ? `${g.name} from Nexus Mods (it has ${g.master}, which ${list(g.neededBy)} ${g.neededBy.length === 1 ? "needs" : "need"})`
            : `a search on Nexus Mods for ${g.master ?? g.name}`
        )
      )}`
    );
  if (fix.turnOff.length)
    parts.push(
      `${done ? "turned off" : "turns off"} ${list(
        fix.turnOff.map((t) => `${t.name} (it needs ${t.needs}${t.official ? ", which comes with the game's DLC or Creation Club" : `, which ${t.missing ? "isn't installed" : "can't load"}`})`)
      )}`
    );
  if (fix.moved.length) parts.push(`${done ? "moved" : "moves"} ${list(fix.moved)} after what ${fix.moved.length === 1 ? "it needs" : "they need"}`);
  const sentence = list(parts);
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}
