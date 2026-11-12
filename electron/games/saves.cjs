const fs = require("fs");
const os = require("os");
const path = require("path");
const { dataDir, readSettings, writeSettings } = require("./storage.cjs");

/*
 * Backing up a game's saves before a risky play: the first after the game updates, the
 * first after its mods change, and the first from the launcher. A broken mod can usually
 * be fixed, but a save the game loaded with it may stay broken, so the copy from before
 * is kept. The last few are kept; Restore backs up what's there now first.
 */

const KEEP = 8;

/* Home folders to look in: this computer's, and for a game in a Windows bottle, the bottle's user's. */
function homes(loc) {
    const found = [os.homedir()];
    const at = loc.gameDir?.indexOf(`${path.sep}drive_c${path.sep}`) ?? -1;
    if (at >= 0) {
        const users = path.join(loc.gameDir.slice(0, at), "drive_c", "users");
        try {
            for (const name of fs.readdirSync(users)) if (name !== "Public") found.push(path.join(users, name));
        } catch {
            // No users in the bottle.
        }
    }
    return found;
}

/* Where each game keeps its saves, under a home folder. */
const CANDIDATES = {
    skyrimse: (home) => ["Skyrim Special Edition", "Skyrim Special Edition GOG"].flatMap((name) => [path.join(home, "Documents", "My Games", name, "Saves"), path.join(home, "OneDrive", "Documents", "My Games", name, "Saves")]),
    fallout4: (home) => [path.join(home, "Documents", "My Games", "Fallout4", "Saves"), path.join(home, "OneDrive", "Documents", "My Games", "Fallout4", "Saves")],
    gtav: (home) => ["GTA V", "GTAV Enhanced"].flatMap((name) => [path.join(home, "Documents", "Rockstar Games", name, "Profiles"), path.join(home, "OneDrive", "Documents", "Rockstar Games", name, "Profiles")]),
    cyberpunk2077: (home) => [path.join(home, "Saved Games", "CD Projekt Red", "Cyberpunk 2077"), path.join(home, "Library", "Application Support", "CD Projekt Red", "Cyberpunk 2077")],
    stardew: (home) => [path.join(home, "AppData", "Roaming", "StardewValley", "Saves"), path.join(home, ".config", "StardewValley", "Saves")],
};

/* The game's saves folder: chosen in Settings, or found. Null if there's none yet. */
function savesDir(game, loc) {
    const chosen = readSettings().savesDirs?.[game.id];
    if (chosen && fs.existsSync(chosen)) return chosen;
    if (game.id === "sims4") {
        const dir = loc.docsDir ? path.join(loc.docsDir, "Saves") : null;
        return dir && fs.existsSync(dir) ? dir : null;
    }
    for (const home of homes(loc)) {
        for (const dir of CANDIDATES[game.id]?.(home) ?? []) if (fs.existsSync(dir)) return dir;
    }
    return null;
}

function chooseSavesDir(gameId, dir) {
    const settings = readSettings();
    settings.savesDirs ??= {};
    if (dir) settings.savesDirs[gameId] = dir;
    else delete settings.savesDirs[gameId];
    writeSettings(settings);
}

const backupsDir = (gameId) => path.join(dataDir(), gameId, "save-backups");

function folderSize(dir) {
    let total = 0;
    let files = 0;
    const walk = (at) => {
        let entries = [];
        try {
            entries = fs.readdirSync(at, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(at, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) {
                total += fs.statSync(full).size;
                files += 1;
            }
        }
    };
    walk(dir);
    return { size: total, files };
}

/* The backups kept, newest first: [{ id, at, reason, size, files }]. */
function list(gameId) {
    const root = backupsDir(gameId);
    let names = [];
    try {
        names = fs.readdirSync(root).filter((name) => name.endsWith(".json"));
    } catch {
        return [];
    }
    return names
        .map((name) => {
            try {
                return JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
            } catch {
                return null;
            }
        })
        .filter((entry) => entry && fs.existsSync(path.join(root, entry.id)))
        .sort((a, b) => b.at.localeCompare(a.at));
}

/* Copies the saves folder. -> the backup, or null when there are no saves to copy. */
async function backup(game, loc, reason, { protect = null } = {}) {
    const from = savesDir(game, loc);
    if (!from) return null;
    const { size, files } = folderSize(from);
    if (!files) return null;
    const at = new Date();
    const id = at.toISOString().replace(/[:.]/g, "-");
    const root = backupsDir(game.id);
    fs.mkdirSync(root, { recursive: true });
    await fs.promises.cp(from, path.join(root, id), { recursive: true });
    const entry = { id, at: at.toISOString(), reason, size, files, from };
    fs.writeFileSync(path.join(root, `${id}.json`), JSON.stringify(entry, null, 2));
    for (const old of list(game.id).filter((b) => b.id !== protect).slice(KEEP)) remove(game.id, old.id);
    return entry;
}

function remove(gameId, id) {
    const root = backupsDir(gameId);
    if (!/^[\w-]+$/.test(id)) throw new Error("That isn't a backup.");
    fs.rmSync(path.join(root, id), { recursive: true, force: true });
    fs.rmSync(path.join(root, `${id}.json`), { force: true });
}

/* Puts a backup's saves back (the game must be closed), backing up what's there first. */
async function restore(game, loc, id) {
    const entry = list(game.id).find((b) => b.id === id);
    if (!entry) throw new Error("That backup isn't there any more.");
    const to = savesDir(game, loc) ?? entry.from;
    if (!to) throw new Error("The game's saves folder wasn't found.");
    await backup(game, loc, "Before restoring an earlier backup", { protect: id });
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(to)) fs.rmSync(path.join(to, name), { recursive: true, force: true });
    await fs.promises.cp(path.join(backupsDir(game.id), id), to, { recursive: true });
    return entry;
}

module.exports = { savesDir, chooseSavesDir, list, backup, restore, remove };
