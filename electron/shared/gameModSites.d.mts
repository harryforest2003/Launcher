export type GameModSite = { name: string; url: string; about: string };

export const GAME_MOD_SITES: Record<string, GameModSite[]>;
export const MOD_SITE_HOSTS: Set<string>;
export function siteHost(url: string): string;
