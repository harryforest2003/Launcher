/*
 * Every mod site the launcher finds mods on, for the list in Settings: which games each
 * has mods for, and how the launcher reaches it. Most need nothing; some take a key from
 * the player's own account; CurseForge goes through the launcher's host, which holds a key
 * of its own. Searched by name and by game.
 */

export type ModSiteConnection =
  /** Works with nothing added. */
  | "none"
  /** Through the launcher's host, which holds the site's key. */
  | "host"
  /** A key from the player's own account: needed, or optional, as `about` says. */
  | "key";

export type ModSite = {
  id: string;
  name: string;
  /** The games it's best known for, as shown. */
  games: string[];
  /** The rest, in words: "and 370 more". */
  more?: string;
  connection: ModSiteConnection;
  key?: ApiKeyName;
  environmentVariable?: string;
  /** What it adds and, for a key, where to get one. */
  about: string;
  /** Its home page, opened from the list. */
  url: string;
};

export const MOD_SITES: ModSite[] = [
  {
    id: "nexus",
    name: "Nexus Mods",
    games: ["Skyrim", "Fallout 4", "Cyberpunk 2077", "Stardew Valley", "Baldur's Gate 3", "GTA V", "Valheim", "RimWorld"],
    more: "thousands more",
    connection: "key",
    key: "nexus",
    environmentVariable: "NEXUS_API_KEY",
    about: "Needed to browse Nexus Mods. Find yours on nexusmods.com, in your account's API Keys settings.",
    url: "https://www.nexusmods.com/",
  },
  {
    id: "modio",
    name: "mod.io",
    games: ["Baldur's Gate 3", "SnowRunner", "Deep Rock Galactic", "BONELAB", "Mordhau"],
    more: "more",
    connection: "key",
    key: "modio",
    environmentVariable: "MODIO_API_KEY",
    about: "Needed to browse and install from mod.io. Get a read-only API key at mod.io, in your account's API access settings.",
    url: "https://mod.io/",
  },
  {
    id: "workshop",
    name: "Steam Workshop",
    games: ["RimWorld", "Cities: Skylines", "Garry's Mod", "Teardown"],
    more: "other Steam games with a Workshop",
    connection: "key",
    key: "steam",
    environmentVariable: "STEAM_WEB_API_KEY",
    about:
      "The launcher's host can search the Workshop for you. Your own Steam Web API key is used first, and works if the host can't. Installing still happens in Steam: you press Subscribe there. Get a key at steamcommunity.com/dev/apikey.",
    url: "https://steamcommunity.com/workshop/",
  },
  {
    id: "factorio",
    name: "Factorio Mod Portal",
    games: ["Factorio"],
    connection: "key",
    key: "factorio",
    environmentVariable: "FACTORIO_TOKEN",
    about:
      "Browsing works without it; search and downloads need it. Paste it as username:token, with the token from your profile on factorio.com.",
    url: "https://mods.factorio.com/",
  },
  {
    id: "modrinth",
    name: "Modrinth",
    games: ["Minecraft"],
    connection: "key",
    key: "modrinth",
    environmentVariable: "MODRINTH_TOKEN",
    about:
      "Browsing and installing don't need a key. One lets the launcher see your own unlisted and draft projects. Create one at modrinth.com/settings/pats.",
    url: "https://modrinth.com/",
  },
  {
    id: "github",
    name: "GitHub",
    games: [],
    more: "mods published as GitHub releases",
    connection: "key",
    key: "github",
    environmentVariable: "GITHUB_TOKEN",
    about:
      "Installs from GitHub allow 60 lookups an hour without a token, and 5,000 with one. Create one at github.com/settings/tokens; it needs no permissions.",
    url: "https://github.com/",
  },
  {
    id: "curseforge",
    name: "CurseForge",
    games: ["Minecraft", "The Sims 4", "Skyrim", "Fallout 4", "Cyberpunk 2077", "Stardew Valley", "Kerbal Space Program"],
    more: "more",
    connection: "host",
    about: "Reached through the launcher's host, which holds the key CurseForge gives apps. Nothing to add.",
    url: "https://www.curseforge.com/",
  },
  {
    id: "thunderstore",
    name: "Thunderstore",
    games: ["Lethal Company", "Valheim", "Risk of Rain 2", "Cities: Skylines II"],
    more: "370 more",
    connection: "none",
    about: "Installs straight into the game, with the mods each one needs.",
    url: "https://thunderstore.io/",
  },
  {
    id: "modworkshop",
    name: "ModWorkshop",
    games: ["PAYDAY 2", "PAYDAY 3", "RAID: World War II", "Noita", "Teardown", "Enter the Gungeon"],
    more: "about 60 more",
    connection: "none",
    about: "PAYDAY 2's main mod site. Mods whose authors ask for it open on the site instead.",
    url: "https://modworkshop.net/",
  },
  {
    id: "gamebanana",
    name: "GameBanana",
    games: ["Celeste", "Friday Night Funkin'", "Sonic", "Persona", "Counter-Strike"],
    more: "thousands more",
    connection: "none",
    about: "Joins a game's \"Any site\" results only when nothing else has mods for it. Files its virus scan flagged aren't installed.",
    url: "https://gamebanana.com/",
  },
  {
    id: "ficsit",
    name: "ficsit.app",
    games: ["Satisfactory"],
    connection: "none",
    about: "The site Satisfactory Mod Manager uses. Installs each mod with what it needs, Satisfactory Mod Loader included.",
    url: "https://ficsit.app/",
  },
  {
    id: "vintagestory",
    name: "Vintage Story Mod DB",
    games: ["Vintage Story"],
    connection: "none",
    about: "The game's official mod site.",
    url: "https://mods.vintagestory.at/",
  },
  {
    id: "contentdb",
    name: "ContentDB",
    games: ["Luanti", "Minetest"],
    connection: "none",
    about: "Luanti's official mod site, the one its own Browse online content uses. Installs each mod with what it needs.",
    url: "https://content.luanti.org/",
  },
  {
    id: "idgames",
    name: "idgames",
    games: ["Doom", "Doom II", "Final Doom"],
    connection: "none",
    about: "Doomworld's archive of maps and add-ons since 1994. An empty search shows its megawads.",
    url: "https://www.doomworld.com/idgames/",
  },
  {
    id: "spacedock",
    name: "SpaceDock",
    games: ["Kerbal Space Program"],
    connection: "none",
    about: "Kerbal Space Program's community mod site.",
    url: "https://spacedock.info/",
  },
  {
    id: "beatmods",
    name: "BeatMods",
    games: ["Beat Saber"],
    connection: "none",
    about: "Beat Saber's checked mods, for the newest game version they're ready for, with what each one needs.",
    url: "https://beatmods.com/",
  },
];

/** The keys a player can add, in the list's order. */
export const MOD_SITE_KEYS = MOD_SITES.flatMap((site) => (site.key ? [site.key] : []));

/** "Minecraft, The Sims 4 and more", or what `more` says alone. */
export function gamesOf(site: ModSite): string {
  if (!site.games.length) return site.more ? site.more[0].toUpperCase() + site.more.slice(1) : "";
  if (site.more) return `${site.games.join(", ")} and ${site.more}`;
  if (site.games.length === 1) return site.games[0];
  return `${site.games.slice(0, -1).join(", ")} and ${site.games[site.games.length - 1]}`;
}

const fold = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The sites whose name or games hold every word typed. */
export function matchSites(sites: ModSite[], query: string): ModSite[] {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return sites;
  return sites.filter((site) => {
    const text = fold([site.name, site.id, ...site.games, site.more ?? ""].join(" "));
    return words.every((word) => text.includes(word));
  });
}
