import type { Tone } from "./ui";

/** A pack version as the project lookup returns it, from Modrinth or CurseForge. */
export type PackVersion = {
  id: string | number;
  name?: string;
  version_number?: string;
  version_type?: string;
  game_versions?: string[];
  loaders?: string[];
  downloads?: number;
  date_published?: string;
};

export type Channel = "release" | "beta" | "alpha";

export const CHANNEL: Record<Channel, { label: string; tone: Tone; hint: string }> = {
  release: { label: "Release", tone: "success", hint: "A full release: finished and tested by the pack's authors" },
  beta: { label: "Beta", tone: "warning", hint: "A beta: mostly done, but may still have bugs" },
  alpha: { label: "Alpha", tone: "danger", hint: "An alpha: early and unfinished, expect problems" },
};

const LOADER_NAMES: Record<string, string> = { fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", quilt: "Quilt", "legacy-fabric": "Legacy Fabric", babric: "Babric", liteloader: "LiteLoader" };

export const channelOf = (version: PackVersion): Channel => {
  const type = version.version_type?.toLowerCase();
  return type === "beta" ? "beta" : type === "alpha" ? "alpha" : "release";
};

export const versionLabel = (version: PackVersion) => version.name || version.version_number || String(version.id);

export const loaderNames = (version: PackVersion) =>
  (version.loaders ?? []).map((l) => LOADER_NAMES[l.toLowerCase()] ?? l).join(", ");

/** "1.20.1", or "1.21.1 and 3 more" for a version that works on several. */
export const gameVersions = (version: PackVersion) => {
  const list = version.game_versions ?? [];
  return list.length > 2 ? `${list[list.length - 1]} and ${list.length - 1} more` : list.join(", ");
};

/** Newest first: both sites mostly list them so, but not always. */
export function newestFirst<T extends PackVersion>(versions: T[]) {
  const time = (v: PackVersion) => Date.parse(v.date_published ?? "") || 0;
  return [...versions].sort((a, b) => time(b) - time(a));
}

/** The version to offer first: the newest full release, else the newest of any kind. */
export function defaultVersion<T extends PackVersion>(versions: T[]): T | null {
  const sorted = newestFirst(versions);
  return sorted.find((v) => channelOf(v) === "release") ?? sorted[0] ?? null;
}
