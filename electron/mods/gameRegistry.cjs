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
];

function getGame(id) {
    return GAMES.find(g => g.id === id) || null;
}

function bySteamAppId(appId) {
    return GAMES.find(g => g.steamAppId === String(appId)) || null;
}

module.exports = {
    GAMES,
    getGame,
    bySteamAppId,
};
