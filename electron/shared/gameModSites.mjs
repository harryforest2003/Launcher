/*
 * Websites with mods for each game, linked from Discover's Sites tab so they're one click
 * away even when the launcher can't search them (no API, or terms that forbid apps reading
 * them). Hand-picked: each was checked to carry mods for its game. Adult-only sites, cheat
 * sites and sites that re-upload paid mods are left out.
 *
 * The sites Discover searches for a game also join its list from the launcher, so a game
 * added from a search still gets its Nexus Mods, Thunderstore or Workshop page.
 *
 * Shared by the page (to list them) and the main process (to open only these links).
 */

const nexus = (domain, about = "Mods from many authors, with a big community") => ({
    name: "Nexus Mods",
    url: `https://www.nexusmods.com/games/${domain}/mods`,
    about,
});
const curseforge = (slug, about) => ({ name: "CurseForge", url: `https://www.curseforge.com/${slug}`, about });
const thunderstore = (community, about = "Mods for r2modman and Thunderstore's own app") => ({
    name: "Thunderstore",
    url: `https://thunderstore.io/c/${community}/`,
    about,
});
const workshop = (appId, about, name = "Steam Workshop") => ({ name, url: `https://steamcommunity.com/app/${appId}/workshop/`, about });
const moddb = (slug, about) => ({ name: "ModDB", url: `https://www.moddb.com/games/${slug}`, about });
const creations = (game, about = "Bethesda's official mods, also on console") => ({
    name: "Bethesda Creations",
    url: `https://creations.bethesda.net/en/${game}/all`,
    about,
});

export const GAME_MOD_SITES = {
    sims4: [
        curseforge("sims4", "EA's partner site for mods and custom content"),
        { name: "The Sims Resource", url: "https://www.thesimsresource.com/downloads/browse/category/sims4/", about: "One of the biggest custom content libraries" },
        { name: "Mod The Sims", url: "https://modthesims.info/downloads/ts4/", about: "Long-running site for mods and custom content" },
        nexus("thesims4", "Script mods and gameplay changes"),
        { name: "Mod Collective", url: "https://www.modcollective.gg/sims4", about: "Mods and custom content from many creators" },
        { name: "SimsFinds", url: "https://www.simsfinds.com/", about: "Custom content from many creators, by category" },
        { name: "Around the Sims 4", url: "https://aroundthesims4.com/", about: "Free objects, build items and clothes" },
        { name: "The Sims Catalog", url: "https://www.thesimscatalog.com/sims4/", about: "Custom content found around the web, listed in one place" },
    ],
    gtav: [
        { name: "GTA5-Mods.com", url: "https://www.gta5-mods.com/", about: "The main GTA V site: vehicles, scripts, maps and more" },
        nexus("gta5", "Mods for the Legacy edition"),
        { ...nexus("gta5enhanced"), name: "Nexus Mods (Enhanced)", about: "Mods for the Enhanced edition" },
        { name: "LCPDFR.com", url: "https://www.lcpdfr.com/downloads/gta5mods/", about: "LSPDFR police mods, callouts and vehicles" },
        { name: "GTAinside", url: "https://www.gtainside.com/gta5/", about: "Vehicles, skins and scripts" },
        { name: "LibertyCity.net", url: "https://libertycity.net/files/gta-5/", about: "Vehicles, skins and scripts in many languages" },
    ],
    stardew: [
        nexus("stardewvalley", "Where nearly every Stardew Valley mod is"),
        curseforge("stardewvalley", "Mods, some also on Nexus Mods"),
        { name: "ModDrop", url: "https://www.moddrop.com/stardew-valley/", about: "Mods from authors who also post here" },
        { name: "SMAPI mod list", url: "https://smapi.io/mods", about: "Every known mod, where to get it and whether it works" },
    ],
    palworld: [
        nexus("palworld", "Most Palworld mods"),
        curseforge("palworld", "Mods, including for servers"),
        thunderstore("palworld"),
    ],
    terraria: [
        workshop(1281930, "tModLoader mods: where most Terraria mods are", "Steam Workshop (tModLoader)"),
        workshop(105600, "Texture packs and worlds for the game itself"),
        curseforge("terraria", "Maps and some mods"),
        nexus("terraria", "Texture packs and older tools"),
    ],
    skyrimse: [
        nexus("skyrimspecialedition", "Where almost every Skyrim mod is"),
        creations("skyrim"),
        { name: "AFK Mods", url: "https://www.afkmods.com/", about: "The Unofficial Patches and their forums" },
        { name: "STEP", url: "https://stepmodifications.org/", about: "Tested guides for a stable modded game" },
    ],
    fallout4: [
        nexus("fallout4", "Where almost every Fallout 4 mod is"),
        creations("fallout4"),
        moddb("fallout-4", "Big mods and total conversions"),
        { name: "AFK Mods", url: "https://www.afkmods.com/", about: "The Unofficial Patch and its forums" },
    ],
    cyberpunk2077: [
        nexus("cyberpunk2077", "Where almost every Cyberpunk 2077 mod is"),
        { name: "REDmodding wiki", url: "https://wiki.redmodding.org/", about: "Guides, and the frameworks most mods need" },
    ],
    bg3: [
        nexus("baldursgate3", "Most Baldur's Gate 3 mods"),
        { name: "mod.io", url: "https://mod.io/g/baldursgate3", about: "Larian's official mods, also in the game's own menu" },
    ],
    valheim: [thunderstore("valheim", "Where most Valheim mods are"), nexus("valheim")],
    rimworld: [workshop(294100, "Where nearly every RimWorld mod is"), nexus("rimworld", "Mods for copies outside Steam")],
    hytale: [curseforge("hytale", "Hytale's official mod site partner"), nexus("hytale")],
    rdr2: [
        nexus("reddeadredemption2", "Most Red Dead Redemption 2 mods"),
        { name: "RDR2Mods.com", url: "https://www.rdr2mods.com/downloads/", about: "Scripts, outfits, tools and their forums" },
    ],
    rdr1: [nexus("reddeadredemption", "Most Red Dead Redemption mods")],
    eldenring: [nexus("eldenring", "Where almost every Elden Ring mod is")],
    witcher3: [nexus("witcher3", "Where almost every Witcher 3 mod is"), moddb("the-witcher-3-wild-hunt", "Some bigger mods")],
    falloutnv: [
        nexus("newvegas", "Where almost every New Vegas mod is"),
        moddb("fallout-new-vegas", "Big mods and total conversions"),
        { name: "Viva New Vegas", url: "https://vivanewvegas.moddinglinked.com/", about: "The usual guide: the fixes and mods to start with" },
    ],
    starfield: [nexus("starfield", "Most Starfield mods"), creations("starfield")],
    oblivionremastered: [nexus("oblivionremastered", "Most Oblivion Remastered mods")],
    hogwartslegacy: [
        curseforge("hogwarts-legacy", "Official mods made with the Creator Kit"),
        nexus("hogwartslegacy", "Most other Hogwarts Legacy mods"),
    ],
    kcd2: [nexus("kingdomcomedeliverance2", "Most Kingdom Come: Deliverance II mods")],
    bannerlord: [
        nexus("mountandblade2bannerlord", "Most Bannerlord mods"),
        workshop(261550, "Mods that Steam installs and updates"),
        moddb("mount-blade-ii-bannerlord", "Big overhauls and total conversions"),
    ],
    satisfactory: [
        { name: "ficsit.app", url: "https://ficsit.app/", about: "The Satisfactory Mod Repository, used by its mod manager" },
        nexus("satisfactory"),
    ],
    payday2: [
        { name: "ModWorkshop", url: "https://modworkshop.net/g/payday-2", about: "Where most PAYDAY 2 mods are" },
        nexus("payday2"),
    ],
    noita: [workshop(881100, "Where most Noita mods are"), nexus("noita")],
    vintagestory: [
        { name: "Vintage Story Mod DB", url: "https://mods.vintagestory.at/", about: "The official mod site" },
        nexus("vintagestory"),
    ],
    luanti: [
        { name: "ContentDB", url: "https://content.luanti.org/", about: "The official site for mods, games and texture packs" },
        { name: "Luanti forums", url: "https://forum.luanti.org/viewforum.php?f=11", about: "Mod releases posted on the forums" },
    ],
    ets2: [
        workshop(227300, "Mods that Steam installs and updates"),
        { name: "ETS2.lt", url: "https://ets2.lt/en/", about: "Maps, trucks and trailers" },
        { name: "TruckyMods", url: "https://truckymods.io/", about: "Truck sim mods from many sites in one list" },
        nexus("eurotrucksimulator2"),
    ],
    factorio: [
        { name: "Factorio Mod Portal", url: "https://mods.factorio.com/", about: "The official mod site, also in the game's menu" },
        nexus("factorio"),
    ],
    sims3: [
        { name: "Mod The Sims", url: "https://modthesims.info/downloads/ts3/", about: "Long-running site for mods and custom content" },
        { name: "The Sims Resource", url: "https://www.thesimsresource.com/downloads/browse/category/sims3/", about: "One of the biggest custom content libraries" },
        { name: "NRaas", url: "https://www.nraas.net/", about: "Big script mods like Story Progression and MasterController" },
        { name: "Around the Sims 3", url: "https://aroundthesims3.com/", about: "Free objects, build items and clothes" },
        nexus("thesims3"),
    ],
    silksong: [thunderstore("hollow-knight-silksong"), nexus("hollowknightsilksong")],
    wukong: [nexus("blackmythwukong", "Most Black Myth: Wukong mods")],
    lethalcompany: [thunderstore("lethal-company", "Where nearly every Lethal Company mod is"), nexus("lethalcompany")],
    subnautica: [
        nexus("subnautica", "Most Subnautica mods"),
        { name: "Submodica", url: "https://submodica.xyz/", about: "Mods gathered from many authors" },
    ],
    schedule1: [thunderstore("schedule-i"), nexus("schedule1")],
    kenshi: [workshop(233860, "Where most Kenshi mods are"), nexus("kenshi")],
    mhwilds: [nexus("monsterhunterwilds", "Most Monster Hunter Wilds mods")],
};

/* A link's site, as it's compared: "www." dropped. */
export function siteHost(url) {
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
        return "";
    }
}

/* Every site above, by host: the main process opens https links to these. */
export const MOD_SITE_HOSTS = new Set(
    Object.values(GAME_MOD_SITES)
        .flat()
        .map((site) => siteHost(site.url)),
);
