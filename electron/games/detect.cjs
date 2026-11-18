const fs = require("fs");
const os = require("os");
const path = require("path");
const { GAMES, getGame } = require("./registry.cjs");
const { readSettings, writeSettings } = require("./storage.cjs");
const { steamLibraries } = require("../mods/gameDetector.cjs");

/*
 * Where each game is: a folder the person chose, else one found in a Steam library, a
 * usual install folder, or (on a Mac) a CrossOver or Whisky bottle, where Windows games
 * run. A folder only counts if the game's own files are there.
 */

const platform = process.platform;
const home = os.homedir();

/* Windows folders inside the Mac's CrossOver and Whisky bottles: each bottle's C: drive. */
function bottleDrives() {
    if (platform !== "darwin") return [];
    const roots = [
        path.join(home, "Library", "Application Support", "CrossOver", "Bottles"),
        path.join(home, "Library", "Containers", "com.isaacmarovitz.Whisky", "Bottles"),
    ];
    const drives = [];
    for (const root of roots) {
        let bottles = [];
        try {
            bottles = fs.readdirSync(root);
        } catch {
            continue;
        }
        for (const bottle of bottles) {
            const drive = path.join(root, bottle, "drive_c");
            if (fs.existsSync(drive)) drives.push(drive);
        }
    }
    return drives;
}

/* Has the game's own files: one of its markers, or for a Mac app, the app itself. */
function looksLikeGame(game, dir) {
    if (!dir || !fs.existsSync(dir)) return false;
    if (dir.endsWith(".app")) return true;
    const markers = [...(game.marker?.win32 ?? []), ...(game.marker?.darwin ?? [])];
    if (!markers.length) return true;
    return markers.some((marker) => fs.existsSync(path.join(dir, marker)));
}

/*
 * For a game whose mods go next to its Mac app (Cyberpunk 2077), the folder with the app
 * in it when the app itself is chosen, or for the App Store version, the app's Contents/Data.
 */
function gameFolderOf(game, dir) {
    const app = game.launch?.darwinAppName;
    if (!app || !dir || path.basename(dir) !== app) return dir;
    const data = path.join(dir, "Contents", "Data");
    if (fs.existsSync(data)) return data;
    return path.dirname(dir);
}

/* Candidate folders, best first: [{ dir, source }]. */
function candidates(game) {
    const found = [];
    const sub = game.steamSubfolder?.[platform];

    for (const lib of steamLibraries()) {
        for (const folder of game.steamFolders ?? []) {
            const dir = path.join(lib, "common", folder);
            found.push({ dir: sub ? path.join(dir, sub) : dir, source: "Steam" });
        }
    }
    for (const dir of game.installs?.[platform] ?? []) found.push({ dir, source: dir.endsWith(".app") ? "Applications" : "Installed" });

    for (const drive of bottleDrives()) {
        for (const steam of ["Program Files (x86)/Steam/steamapps/common", "Program Files/Steam/steamapps/common"]) {
            for (const folder of game.steamFolders ?? []) found.push({ dir: path.join(drive, steam, folder), source: "Steam in CrossOver" });
        }
        for (const dir of game.installs?.win32 ?? []) {
            found.push({ dir: path.join(drive, dir.replace(/^C:\\/i, "").replace(/\\/g, "/")), source: "CrossOver" });
        }
    }
    return found;
}

/* The game's folder in Documents (The Sims 4): one chosen, else the first that exists, else where it would be. */
function docsDir(game) {
    const chosen = readSettings().docsDirs?.[game.id];
    if (chosen) return chosen;
    const options = game.docs?.() ?? [];
    return options.find((dir) => fs.existsSync(dir)) ?? options[0] ?? null;
}

/*
 * Where a game is. -> { id, found, gameDir, source, chosen, docsDir }
 * For The Sims 4, its Documents folder counts as found even without the game.
 */
function locate(id) {
    const game = getGame(id);
    if (!game) throw new Error(`Unknown game "${id}".`);
    const chosen = readSettings().gameDirs?.[id];
    const docs = docsDir(game);

    if (chosen && looksLikeGame(game, chosen)) return { id, found: true, gameDir: chosen, source: "Chosen", chosen: true, docsDir: docs };
    for (const { dir, source } of candidates(game)) {
        if (looksLikeGame(game, dir)) return { id, found: true, gameDir: dir, source, chosen: false, docsDir: docs };
    }
    const docsFound = Boolean(docs && fs.existsSync(path.join(docs, "Mods")));
    return { id, found: docsFound, gameDir: null, source: docsFound ? "Documents" : null, chosen: false, docsDir: docs, chosenMissing: Boolean(chosen) };
}

/* Remembers the folder chosen for a game (null forgets it). Refuses one without the game in it. */
function chooseFolder(id, dir) {
    const game = getGame(id);
    if (!game) throw new Error(`Unknown game "${id}".`);
    const settings = readSettings();
    settings.gameDirs ??= {};
    if (dir === null) {
        delete settings.gameDirs[id];
    } else {
        dir = gameFolderOf(game, dir);
        // Picking a game's .app on a Mac, or the folder with its exe.
        if (!looksLikeGame(game, dir)) {
            const markers = [...new Set([...(game.marker?.win32 ?? []), ...(game.marker?.darwin ?? [])])];
            throw new Error(`That folder doesn't have ${game.name} in it${markers.length ? ` (looked for ${markers.join(" or ")})` : ""}.`);
        }
        settings.gameDirs[id] = dir;
    }
    writeSettings(settings);
    return locate(id);
}

/* Remembers a different Documents folder for a game (The Sims 4's), or forgets it with null. */
function chooseDocsFolder(id, dir) {
    const settings = readSettings();
    settings.docsDirs ??= {};
    if (dir === null) delete settings.docsDirs[id];
    else settings.docsDirs[id] = dir;
    writeSettings(settings);
    return locate(id);
}

const locateAll = () => GAMES.map((game) => locate(game.id));

module.exports = { locate, locateAll, chooseFolder, chooseDocsFolder, looksLikeGame };
