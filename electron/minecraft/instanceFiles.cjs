const fs = require("fs");
const path = require("path");
const { nativeImage, shell } = require("electron");
const nbt = require("./nbt.cjs");

/*
 * An instance's worlds and screenshots, for its Worlds and Screenshots tabs. Removing one
 * moves it to the Bin, so it can be got back.
 */

const GAME_MODES = ["Survival", "Creative", "Adventure", "Spectator"];
const IMAGE = /\.(png|jpe?g)$/i;
const MAX_SCREENSHOTS = 300;

const gameDirectory = (instance) => instance.gameDirectory ?? path.join(instance.folder, ".minecraft");
const folderFor = (instance, kind) => path.join(gameDirectory(instance), kind === "world" ? "saves" : "screenshots");

function folderSize(dir) {
    let total = 0;
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) total += folderSize(full);
            else if (entry.isFile()) total += fs.statSync(full).size;
        }
    } catch {
        // Unreadable: counted as what was read.
    }
    return total;
}

/* Worlds, most recently played first, with what level.dat says about each. */
function listWorlds(instance) {
    const saves = folderFor(instance, "world");
    if (!fs.existsSync(saves)) return [];

    const worlds = [];
    for (const entry of fs.readdirSync(saves, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(saves, entry.name);
        const levelDat = path.join(dir, "level.dat");
        if (!fs.existsSync(levelDat)) continue;

        let data = {};
        try {
            data = nbt.parse(fs.readFileSync(levelDat)).Data ?? {};
        } catch {
            // A damaged level.dat: the folder still shows, by its name.
        }

        const icon = path.join(dir, "icon.png");
        const lastPlayed = data.LastPlayed > 0 ? data.LastPlayed : fs.statSync(levelDat).mtimeMs;

        worlds.push({
            folder: entry.name,
            name: typeof data.LevelName === "string" && data.LevelName ? data.LevelName : entry.name,
            lastPlayed: new Date(lastPlayed).toISOString(),
            gameMode: GAME_MODES[data.GameType] ?? null,
            hardcore: data.hardcore === 1,
            cheats: data.allowCommands === 1,
            version: data.Version?.Name ?? null,
            size: folderSize(dir),
            icon: fs.existsSync(icon) ? nativeImage.createFromPath(icon).toDataURL() : null,
        });
    }

    return worlds.sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed));
}

/* Screenshots, newest first, with small previews. */
function listScreenshots(instance) {
    const dir = folderFor(instance, "screenshot");
    if (!fs.existsSync(dir)) return [];

    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && IMAGE.test(entry.name))
        .map((entry) => {
            const full = path.join(dir, entry.name);
            const stat = fs.statSync(full);
            return { fileName: entry.name, taken: stat.mtime.toISOString(), size: stat.size, full };
        })
        .sort((a, b) => b.taken.localeCompare(a.taken))
        .slice(0, MAX_SCREENSHOTS)
        .map(({ full, ...shot }) => {
            const image = nativeImage.createFromPath(full);
            const { width, height } = image.getSize();
            return {
                ...shot,
                width,
                height,
                thumbnail: image.isEmpty() ? null : image.resize({ width: Math.min(width, 360), quality: "good" }).toDataURL(),
            };
        });
}

/* A world folder or screenshot in this instance, by name, refusing anything outside it. */
function itemPath(instance, kind, name) {
    const base = path.resolve(folderFor(instance, kind));
    const target = path.resolve(base, String(name ?? ""));
    if (path.dirname(target) !== base) throw new Error("That isn't part of this instance.");
    if (!fs.existsSync(target)) throw new Error(`${kind === "world" ? "That world" : "That screenshot"} isn't there any more.`);
    return target;
}

/*
 * open: the screenshot in its viewer, or the world's folder. show: it in Finder or the
 * file manager. trash: to the Bin. folder: all the instance's worlds or screenshots.
 */
async function fileAction(instance, { kind, name, action }) {
    if (kind !== "world" && kind !== "screenshot") throw new Error("Unknown kind of file.");

    if (action === "folder") {
        const dir = folderFor(instance, kind);
        fs.mkdirSync(dir, { recursive: true });
        const failed = await shell.openPath(dir);
        if (failed) throw new Error(failed);
        return;
    }

    const target = itemPath(instance, kind, name);

    if (action === "open") {
        const failed = await shell.openPath(target);
        if (failed) throw new Error(failed);
    } else if (action === "show") {
        shell.showItemInFolder(target);
    } else if (action === "trash") {
        await shell.trashItem(target);
    } else {
        throw new Error("Unknown action.");
    }
}

module.exports = { listWorlds, listScreenshots, fileAction, gameDirectory };
