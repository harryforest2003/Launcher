const os = require("os");
const path = require("path");

/*
 * Catalog of games the mod manager understands.
 *
 * Every entry describes three separate things:
 *
 *   1. how to FIND the game on disk (steamAppId / probes)
 *   2. where its MODS live (modDir per platform)
 *   3. which online PROVIDERS can search for its mods
 *
 * A game with no provider is still fully supported for local mod
 * management: scan, view, enable, disable, install-from-file. Only
 * online search needs a provider.
 */

const home = os.homedir();

// Windows Documents is frequently redirected into OneDrive.
function winDocs() {
    return [
        path.join(home, "Documents"),
        path.join(home, "OneDrive", "Documents"),
    ];
}

const GAMES = [
    {
        id: "minecraft",
        name: "Minecraft",
        // Handled by the launcher's own instance system.
        managedByInstances: true,
        providers: { curseforge: 432, modrinth: true },
        modExtensions: [".jar"],
    },

    {
        id: "sims4",
        name: "The Sims 4",
        steamAppId: null,           // EA app / Origin, not Steam
        providers: { curseforge: 78062, nexus: "thesims4" },

        // Sims 4 reads mods from Documents, not the install dir.
        modDir: {
            darwin: [path.join(home, "Documents", "Electronic Arts", "The Sims 4", "Mods")],
            win32: winDocs().map(d =>
                path.join(d, "Electronic Arts", "The Sims 4", "Mods")
            ),
        },

        // Probes confirm the game itself is installed.
        probes: {
            darwin: [
                "/Applications/The Sims 4.app",
                path.join(home, "Applications", "The Sims 4.app"),
                path.join(home, "Library", "Application Support", "The Sims 4"),
            ],
            win32: [
                "C:\\Program Files (x86)\\Origin Games\\The Sims 4",
                "C:\\Program Files\\EA Games\\The Sims 4",
                "C:\\Program Files (x86)\\EA Games\\The Sims 4",
            ],
        },

        modExtensions: [".package", ".ts4script"],
        // The Sims 4 only scans a few folders deep.
        maxDepth: 5,
        notes: "Script mods (.ts4script) must sit no more than one folder deep, and Script Mods must be enabled in Game Options.",
    },

    {
        id: "gtav",
        name: "Grand Theft Auto V",
        steamAppId: "271590",
        // No API-backed provider exists: CurseForge does not carry GTA V and
        // gta5-mods.com has no public API. Local management still works.
        providers: { nexus: "gta5" },

        modDir: {
            // Mods live inside the game folder; resolved relative to the
            // detected install path.
            relative: ["mods", "scripts"],
        },

        probes: {
            win32: [
                "C:\\Program Files\\Rockstar Games\\Grand Theft Auto V",
                "C:\\Program Files (x86)\\Rockstar Games\\Grand Theft Auto V",
            ],
        },

        modExtensions: [".asi", ".dll", ".oiv", ".rpf", ".lua"],
        windowsOnlyModding: true,
        notes: "GTA V modding relies on ScriptHookV/OpenIV, which are Windows-only. Search is browse-only via Nexus; gta5-mods.com has no public API.",
    },

    {
        id: "stardew",
        name: "Stardew Valley",
        steamAppId: "413150",
        providers: { curseforge: 669, nexus: "stardewvalley" },
        modDir: { relative: ["Mods"] },
        modExtensions: [".dll", ".json"],
        loose: true,   // SMAPI mods are folders, not single files
        notes: "Requires SMAPI. Each mod is a folder containing manifest.json.",
    },

    {
        id: "palworld",
        name: "Palworld",
        steamAppId: "1623730",
        providers: { curseforge: 85196 },
        modDir: { relative: ["Pal", "Binaries", "Win64", "Mods"] },
        modExtensions: [".pak", ".dll"],
    },

    {
        id: "terraria",
        name: "Terraria",
        steamAppId: "105600",
        providers: { curseforge: 431 },
        modDir: {
            darwin: [path.join(home, "Library", "Application Support", "Terraria", "tModLoader", "Mods")],
            win32: winDocs().map(d => path.join(d, "My Games", "Terraria", "tModLoader", "Mods")),
        },
        modExtensions: [".tmod"],
    },

    {
        id: "skyrimse",
        name: "Skyrim Special Edition",
        steamAppId: "489830",
        providers: { nexus: "skyrimspecialedition" },
        modDir: { relative: ["Data"] },
        modExtensions: [".esp", ".esm", ".esl", ".bsa"],
    },

    {
        id: "cyberpunk2077",
        name: "Cyberpunk 2077",
        steamAppId: "1091500",
        providers: { nexus: "cyberpunk2077" },
        modDir: { relative: ["archive", "pc", "mod"] },
        modExtensions: [".archive", ".dll"],
    },

    {
        id: "bg3",
        name: "Baldur's Gate 3",
        steamAppId: "1086940",
        providers: { nexus: "baldursgate3" },
        modDir: {
            darwin: [path.join(home, "Documents", "Larian Studios", "Baldur's Gate 3", "Mods")],
            win32: winDocs().map(d => path.join(d, "Larian Studios", "Baldur's Gate 3", "Mods")),
        },
        modExtensions: [".pak"],
    },

    {
        id: "valheim",
        name: "Valheim",
        steamAppId: "892970",
        providers: {},
        modDir: { relative: ["BepInEx", "plugins"] },
        modExtensions: [".dll"],
    },

    {
        id: "rimworld",
        name: "RimWorld",
        steamAppId: "294100",
        providers: {},
        modDir: { relative: ["Mods"] },
        loose: true,
        modExtensions: [".xml", ".dll"],
    },

    {
        id: "hytale",
        name: "Hytale",
        // Installed with Hypixel's own launcher, not Steam.
        providers: { curseforge: 70216, nexus: "hytale" },
        modDir: {
            darwin: [path.join(home, "Library", "Application Support", "Hytale", "UserData", "Mods")],
            win32: [path.join(appData(), "Hytale", "UserData", "Mods")],
            linux: [path.join(home, ".local", "share", "Hytale", "UserData", "Mods")],
        },
        probes: {
            darwin: [
                "/Applications/Hytale.app",
                "/Applications/Hytale Launcher.app",
                path.join(home, "Applications", "Hytale.app"),
                path.join(home, "Library", "Application Support", "Hytale"),
            ],
            win32: [path.join(appData(), "Hytale")],
            linux: [path.join(home, ".local", "share", "Hytale")],
        },
        modExtensions: [".jar", ".zip"],
        notes: "Plugins are .jar files and content packs are .zip files. The Mods folder appears after the first launch; close the game before adding mods.",
    },

    {
        id: "rdr2",
        name: "Red Dead Redemption 2",
        steamAppId: "1174180",
        providers: { nexus: "reddeadredemption2" },
        // Lenny's Mod Loader keeps each mod in its own folder under lml.
        modDir: { relative: ["lml"] },
        probes: {
            win32: [
                "C:\\Program Files\\Rockstar Games\\Red Dead Redemption 2",
                "C:\\Program Files\\Epic Games\\RedDeadRedemption2",
            ],
        },
        loose: true,
        modExtensions: [".asi", ".dll", ".xml", ".ymt", ".ytd"],
        windowsOnly: true,
        windowsOnlyModding: true,
        notes: "Most mods need Lenny's Mod Loader (each mod is a folder in lml). Script mods (.asi) need ScriptHookRDR2 and go in the game folder itself. Play Story Mode only; mods are not allowed online.",
    },

    {
        id: "rdr1",
        name: "Red Dead Redemption",
        steamAppId: "2668510",
        providers: { nexus: "reddeadredemption" },
        // Mods for the 2024 PC release replace the game's own .rpf files, so
        // there is no separate mods folder to switch them on and off.
        modDir: null,
        windowsOnly: true,
        windowsOnlyModding: true,
        notes: "Modding is still early: most mods replace a .rpf file in the game's \"game\" folder. Back up the original first; the launcher can't switch these on and off.",
    },

    {
        id: "gta6",
        name: "Grand Theft Auto VI",
        // Console-only for now: nothing to find on a computer.
        notOnPC: "Out on PS5 and Xbox Series X|S on 19 November 2026. Rockstar hasn't announced a PC version yet.",
        providers: {},
    },

    {
        id: "eldenring",
        name: "Elden Ring",
        steamAppId: "1245620",
        providers: { nexus: "eldenring" },
        // Mod Engine 2 unpacked into the Game folder reads mods from Game/mod.
        modDir: { relative: ["Game", "mod"] },
        loose: true,
        modExtensions: [".dcx", ".dll", ".bnd"],
        windowsOnly: true,
        notes: "Needs Mod Engine 2 unpacked into the Game folder. Launch through it so Easy Anti-Cheat stays off, and play offline.",
    },

    {
        id: "witcher3",
        name: "The Witcher 3: Wild Hunt",
        steamAppId: "292030",
        providers: { nexus: "witcher3" },
        modDir: { relative: ["Mods"] },
        loose: true,
        modExtensions: [".bundle", ".ws", ".xml", ".cache"],
        windowsOnly: true,
        notes: "Each mod is a folder whose name starts with \"mod\". When two mods change the same script, merge them with Script Merger.",
    },

    {
        id: "falloutnv",
        name: "Fallout: New Vegas",
        steamAppId: "22380",
        providers: { nexus: "newvegas" },
        modDir: { relative: ["Data"] },
        modExtensions: [".esp", ".esm", ".bsa"],
        windowsOnly: true,
        notes: "Most big mods need xNVSE and the 4GB Patcher first.",
    },

    {
        id: "starfield",
        name: "Starfield",
        steamAppId: "1716740",
        providers: { nexus: "starfield" },
        modDir: { relative: ["Data"] },
        modExtensions: [".esp", ".esm", ".esl", ".ba2"],
        windowsOnly: true,
        notes: "Creations added in the game are managed by the game itself.",
    },

    {
        id: "oblivionremastered",
        name: "The Elder Scrolls IV: Oblivion Remastered",
        steamAppId: "2623190",
        providers: { nexus: "oblivionremastered" },
        modDir: { relative: ["OblivionRemastered", "Content", "Paks", "~mods"] },
        modExtensions: [".pak", ".ucas", ".utoc"],
        windowsOnly: true,
        notes: "Shows .pak mods. Plugin mods (.esp) go in OblivionRemastered/Content/Dev/ObvData/Data and must be listed in Plugins.txt.",
    },

    {
        id: "hogwartslegacy",
        name: "Hogwarts Legacy",
        steamAppId: "990080",
        providers: { nexus: "hogwartslegacy" },
        modDir: { relative: ["Phoenix", "Content", "Paks", "~mods"] },
        modExtensions: [".pak", ".ucas", ".utoc"],
        windowsOnly: true,
    },

    {
        id: "kcd2",
        name: "Kingdom Come: Deliverance II",
        steamAppId: "1771300",
        providers: { nexus: "kingdomcomedeliverance2" },
        modDir: { relative: ["Mods"] },
        loose: true,
        modExtensions: [".pak", ".xml", ".manifest"],
        windowsOnly: true,
        notes: "Each mod is a folder with a mod.manifest inside.",
    },

    {
        id: "bannerlord",
        name: "Mount & Blade II: Bannerlord",
        steamAppId: "261550",
        providers: { nexus: "mountandblade2bannerlord" },
        modDir: { relative: ["Modules"] },
        loose: true,
        modExtensions: [".xml", ".dll"],
        windowsOnly: true,
        notes: "The game's own modules (Native, SandBox and others) live here too; leave those on. Pick mods in the game's launcher under Mods.",
    },

    {
        id: "satisfactory",
        name: "Satisfactory",
        steamAppId: "526870",
        providers: { nexus: "satisfactory" },
        modDir: { relative: ["FactoryGame", "Mods"] },
        loose: true,
        modExtensions: [".pak", ".dll", ".uplugin"],
        windowsOnly: true,
        notes: "Most mods are on ficsit.app and are easiest to install with Satisfactory Mod Manager.",
    },

    {
        id: "ets2",
        name: "Euro Truck Simulator 2",
        steamAppId: "227300",
        providers: { nexus: "eurotrucksimulator2" },
        modDir: {
            darwin: [path.join(home, "Library", "Application Support", "Euro Truck Simulator 2", "mod")],
            win32: winDocs().map(d => path.join(d, "Euro Truck Simulator 2", "mod")),
            linux: [path.join(home, ".local", "share", "Euro Truck Simulator 2", "mod")],
        },
        modExtensions: [".scs", ".zip"],
        notes: "Turn mods on in the game's Mod Manager, on the profile screen.",
    },

    {
        id: "factorio",
        name: "Factorio",
        steamAppId: "427520",
        providers: {},
        modDir: {
            darwin: [path.join(home, "Library", "Application Support", "factorio", "mods")],
            win32: [path.join(appData(), "Factorio", "mods")],
            linux: [path.join(home, ".factorio", "mods")],
        },
        modExtensions: [".zip"],
        notes: "The game can also install mods from its own mod portal, in the Mods menu.",
    },

    {
        id: "sims3",
        name: "The Sims 3",
        steamAppId: "47890",
        providers: { nexus: "thesims3" },
        modDir: {
            darwin: [path.join(home, "Documents", "Electronic Arts", "The Sims 3", "Mods", "Packages")],
            win32: winDocs().map(d => path.join(d, "Electronic Arts", "The Sims 3", "Mods", "Packages")),
        },
        modExtensions: [".package"],
        notes: "Mods only load when a Resource.cfg file sits in the Mods folder above Packages.",
    },

    {
        id: "silksong",
        name: "Hollow Knight: Silksong",
        steamAppId: "1030300",
        providers: { nexus: "hollowknightsilksong" },
        modDir: { relative: ["BepInEx", "plugins"] },
        modExtensions: [".dll"],
        notes: "Needs BepInEx installed in the game folder.",
    },

    {
        id: "wukong",
        name: "Black Myth: Wukong",
        steamAppId: "2358720",
        providers: { nexus: "blackmythwukong" },
        modDir: { relative: ["b1", "Content", "Paks", "~mods"] },
        modExtensions: [".pak", ".ucas", ".utoc"],
        windowsOnly: true,
    },

    {
        id: "lethalcompany",
        name: "Lethal Company",
        steamAppId: "1966720",
        providers: { nexus: "lethalcompany" },
        modDir: { relative: ["BepInEx", "plugins"] },
        modExtensions: [".dll"],
        windowsOnly: true,
        notes: "Needs BepInEx. Everyone in a lobby needs the same mods.",
    },

    {
        id: "subnautica",
        name: "Subnautica",
        steamAppId: "264710",
        providers: { nexus: "subnautica" },
        modDir: { relative: ["BepInEx", "plugins"] },
        modExtensions: [".dll"],
        notes: "Needs BepInEx (Tobey's BepInEx pack is the usual one).",
    },

    {
        id: "schedule1",
        name: "Schedule I",
        steamAppId: "3164500",
        providers: { nexus: "schedule1" },
        modDir: { relative: ["Mods"] },
        modExtensions: [".dll"],
        windowsOnly: true,
        notes: "Needs MelonLoader.",
    },

    {
        id: "kenshi",
        name: "Kenshi",
        steamAppId: "233860",
        providers: { nexus: "kenshi" },
        modDir: { relative: ["mods"] },
        loose: true,
        modExtensions: [".mod"],
        windowsOnly: true,
        notes: "Turn mods on and set their order in the game's launcher.",
    },

    {
        id: "mhwilds",
        name: "Monster Hunter Wilds",
        steamAppId: "2246340",
        providers: { nexus: "monsterhunterwilds" },
        modDir: { relative: ["reframework", "autorun"] },
        modExtensions: [".lua"],
        windowsOnly: true,
        notes: "Shows REFramework scripts. Most other mods install with Fluffy Mod Manager.",
    },
];

/* Where Windows keeps per-user app data (Roaming). */
function appData() {
    return process.env.APPDATA || path.join(home, "AppData", "Roaming");
}

/*
 * Every game the launcher knows, found or not, for the More Games list.
 * Minecraft is left out: it has its own section.
 */
function catalog() {
    return GAMES.filter(g => !g.managedByInstances).map(g => ({
        id: g.id,
        name: g.name,
        steamAppId: g.steamAppId ?? null,
        notOnPC: g.notOnPC ?? null,
        windowsOnly: !!g.windowsOnly,
        providers: Object.keys(g.providers ?? {}).filter(k => g.providers[k]),
        modExtensions: g.modExtensions ?? [],
        noModFolder: g.modDir === null,
    }));
}

function getGame(id) {
    return GAMES.find(g => g.id === id) || null;
}

function bySteamAppId(appId) {
    return GAMES.find(g => g.steamAppId === String(appId)) || null;
}

module.exports = {
    GAMES,
    catalog,
    getGame,
    bySteamAppId,
};
