const os = require("os");
const path = require("path");

/*
 * The games with a section of their own: how to find each, where its mods go (the
 * "layout" names the install rules in layouts.cjs), where Nexus Mods and CurseForge list
 * it, and how to launch it.
 *
 * Paths for a mod's files are relative to one of two folders: "game", where the game is
 * installed, and "docs", the game's own folder in Documents (The Sims 4 keeps its Mods and
 * Tray there).
 */

const home = os.homedir();
const documents = () => [path.join(home, "Documents"), path.join(home, "OneDrive", "Documents")];

const GAMES = [
    {
        id: "sims4",
        name: "The Sims 4",
        tagline: "Custom content, script mods and Gallery downloads",
        colour: "#22c55e",
        layout: "sims4",
        nexus: "thesims4",
        curseforge: 78062,
        steamAppIds: ["1222670"],
        steamFolders: ["The Sims 4"],
        marker: { win32: ["Game/Bin/TS4_x64.exe"], darwin: [] },
        installs: {
            darwin: ["/Applications/The Sims 4.app", path.join(home, "Applications", "The Sims 4.app")],
            win32: ["C:\\Program Files\\EA Games\\The Sims 4", "C:\\Program Files (x86)\\EA Games\\The Sims 4", "C:\\Program Files (x86)\\Origin Games\\The Sims 4"],
        },
        // Mods and Tray live in Documents, whether or not the game is found.
        docs: () => documents().map((d) => path.join(d, "Electronic Arts", "The Sims 4")),
        launch: { darwinApp: true, win32Exe: ["Game/Bin/TS4_x64.exe"] },
    },
    {
        id: "gtav",
        name: "Grand Theft Auto V",
        tagline: "Script mods, trainers and add-on vehicles",
        colour: "#16a34a",
        layout: "gtav",
        nexus: "gta5",
        steamAppIds: ["271590", "3240220"],
        steamFolders: ["Grand Theft Auto V", "Grand Theft Auto V Enhanced"],
        marker: { win32: ["GTA5.exe", "GTA5_Enhanced.exe", "PlayGTAV.exe"], darwin: ["GTA5.exe", "GTA5_Enhanced.exe", "PlayGTAV.exe"] },
        installs: {
            win32: [
                "C:\\Program Files\\Rockstar Games\\Grand Theft Auto V",
                "C:\\Program Files (x86)\\Rockstar Games\\Grand Theft Auto V",
                "C:\\Program Files\\Epic Games\\GTAV",
            ],
        },
        launch: { win32Exe: ["PlayGTAV.exe", "GTA5.exe"] },
        windowsOnly: true,
    },
    {
        id: "skyrimse",
        name: "Skyrim Special Edition",
        tagline: "Plugins, textures and SKSE mods",
        colour: "#94a3b8",
        layout: "bethesda",
        nexus: "skyrimspecialedition",
        steamAppIds: ["489830"],
        steamFolders: ["Skyrim Special Edition"],
        marker: { win32: ["SkyrimSE.exe"], darwin: ["SkyrimSE.exe"] },
        installs: { win32: ["C:\\Program Files (x86)\\GOG Galaxy\\Games\\Skyrim Anniversary Edition"] },
        bethesda: {
            appData: ["Skyrim Special Edition", "Skyrim Special Edition GOG"],
            extender: { name: "SKSE", loader: "skse64_loader.exe", prefix: "skse64_", url: "https://skse.silverlock.org" },
            official: ["skyrim.esm", "update.esm", "dawnguard.esm", "hearthfires.esm", "dragonborn.esm", "_resourcepack.esl"],
        },
        launch: { win32Exe: ["skse64_loader.exe", "SkyrimSELauncher.exe", "SkyrimSE.exe"] },
        windowsOnly: true,
    },
    {
        id: "fallout4",
        name: "Fallout 4",
        tagline: "Plugins, settlements and F4SE mods",
        colour: "#eab308",
        layout: "bethesda",
        nexus: "fallout4",
        steamAppIds: ["377160"],
        steamFolders: ["Fallout 4"],
        marker: { win32: ["Fallout4.exe"], darwin: ["Fallout4.exe"] },
        installs: { win32: ["C:\\Program Files (x86)\\GOG Galaxy\\Games\\Fallout 4 GOTY"] },
        bethesda: {
            appData: ["Fallout4"],
            extender: { name: "F4SE", loader: "f4se_loader.exe", prefix: "f4se_", url: "https://f4se.silverlock.org" },
            official: [
                "fallout4.esm",
                "dlcrobot.esm",
                "dlcworkshop01.esm",
                "dlccoast.esm",
                "dlcworkshop02.esm",
                "dlcworkshop03.esm",
                "dlcnukaworld.esm",
                "dlcultrahighresolution.esm",
            ],
        },
        launch: { win32Exe: ["f4se_loader.exe", "Fallout4Launcher.exe", "Fallout4.exe"] },
        windowsOnly: true,
    },
    {
        id: "cyberpunk2077",
        name: "Cyberpunk 2077",
        tagline: "Archive mods, Cyber Engine Tweaks, redscript and RED4ext",
        colour: "#facc15",
        layout: "cyberpunk",
        nexus: "cyberpunk2077",
        steamAppIds: ["1091500"],
        steamFolders: ["Cyberpunk 2077"],
        marker: { win32: ["bin/x64/Cyberpunk2077.exe"], darwin: ["bin/x64/Cyberpunk2077.exe"] },
        installs: {
            win32: ["C:\\Program Files (x86)\\GOG Galaxy\\Games\\Cyberpunk 2077", "C:\\Program Files\\Epic Games\\Cyberpunk2077"],
        },
        launch: { win32Exe: ["bin/x64/Cyberpunk2077.exe"] },
        windowsOnly: true,
    },
    {
        id: "stardew",
        name: "Stardew Valley",
        tagline: "SMAPI mods",
        colour: "#4ade80",
        layout: "smapi",
        nexus: "stardewvalley",
        curseforge: 669,
        steamAppIds: ["413150"],
        steamFolders: ["Stardew Valley"],
        // On a Mac the game (and SMAPI's Mods folder) sit inside the app bundle Steam makes.
        steamSubfolder: { darwin: "Contents/MacOS" },
        marker: { win32: ["Stardew Valley.exe", "Stardew Valley.dll"], darwin: ["Stardew Valley", "Stardew Valley.dll", "StardewValley"] },
        installs: {
            win32: ["C:\\Program Files (x86)\\GOG Galaxy\\Games\\Stardew Valley"],
        },
        launch: { win32Exe: ["StardewModdingAPI.exe", "Stardew Valley.exe"] },
    },
];

const getGame = (id) => GAMES.find((game) => game.id === id) ?? null;

module.exports = { GAMES, getGame };
