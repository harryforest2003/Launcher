const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { Transform } = require("stream");
const yazl = require("yazl");
const { shell } = require("electron");
const { withZip } = require("./zipFile.cjs");
const { gameDirectory } = require("./instanceFiles.cjs");

/*
 * World backups: a .zip of a world in <instance>/backups/worlds/<world folder>/, made by
 * hand from the Worlds tab or, when the instance asks for it, before its mods or loader
 * are updated. Each zip holds the world in a folder of its own name, so Import .zip takes
 * it too. Restoring sends the world as it is now to the Bin first.
 */

// Backups made before updates: the newest few of each world are kept. Ones made by hand stay.
const AUTO_KEEP = 3;
const MAX_WORLD_BYTES = 8 * 1024 ** 3;
const NAME = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})(?:-(\d+))?(-auto)?\.zip$/;

const savesOf = (instance) => path.join(gameDirectory(instance), "saves");
const backupsOf = (instance) => path.join(instance.folder, "backups", "worlds");
const posix = (p) => String(p).replace(/\\/g, "/").replace(/^\/+/, "");

/* A world's folder in saves, or an error if the name could reach anywhere else. */
function worldPath(instance, folder) {
    const base = path.resolve(savesOf(instance));
    const target = path.resolve(base, String(folder ?? ""));
    if (path.dirname(target) !== base) throw new Error("That isn't one of this instance's worlds.");
    return target;
}

function backupPath(instance, folder, file) {
    const base = path.resolve(backupsOf(instance), path.basename(worldPath(instance, folder)));
    const target = path.resolve(base, String(file ?? ""));
    if (path.dirname(target) !== base || !NAME.test(path.basename(target))) throw new Error("That isn't one of this world's backups.");
    if (!fs.existsSync(target)) throw new Error("That backup isn't there any more.");
    return target;
}

function stamp(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function filesIn(dir, base = dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...filesIn(full, base));
        // The lock file is held open while the game plays, and the game makes a new one.
        else if (entry.isFile() && entry.name !== "session.lock") out.push(full);
    }
    return out;
}

/* Every backup, newest first: the worlds still here and ones since deleted. */
function listBackups(instance) {
    const root = backupsOf(instance);
    if (!fs.existsSync(root)) return [];
    const list = [];
    for (const world of fs.readdirSync(root, { withFileTypes: true })) {
        if (!world.isDirectory()) continue;
        for (const file of fs.readdirSync(path.join(root, world.name))) {
            const match = NAME.exec(file);
            if (!match) continue;
            const stat = fs.statSync(path.join(root, world.name, file));
            list.push({ world: world.name, file, createdAt: stat.mtime.toISOString(), size: stat.size, auto: Boolean(match[3]) });
        }
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.file.localeCompare(a.file));
}

/* Zips one world. auto: made before an update, and only the newest few of those are kept. */
async function backupWorld(instance, folder, { auto = false } = {}) {
    const world = worldPath(instance, folder);
    if (!fs.existsSync(path.join(world, "level.dat"))) throw new Error("That world isn't there any more.");
    const name = path.basename(world);
    const dir = path.join(backupsOf(instance), name);
    fs.mkdirSync(dir, { recursive: true });

    const base = stamp(new Date());
    let file = `${base}${auto ? "-auto" : ""}.zip`;
    for (let n = 2; fs.existsSync(path.join(dir, file)); n++) file = `${base}-${n}${auto ? "-auto" : ""}.zip`;
    const target = path.join(dir, file);
    const partial = `${target}.partial`;

    const zip = new yazl.ZipFile();
    for (const full of filesIn(world)) zip.addFile(full, `${name}/${posix(path.relative(world, full))}`);
    try {
        await new Promise((resolve, reject) => {
            const out = fs.createWriteStream(partial);
            out.on("error", reject).on("close", resolve);
            zip.outputStream.on("error", reject).pipe(out);
            zip.end();
        });
        fs.renameSync(partial, target);
    } catch (err) {
        fs.rmSync(partial, { force: true });
        throw new Error(`The backup of "${name}" couldn't be made: ${err.message}`);
    }

    if (auto) {
        const autos = listBackups(instance).filter((backup) => backup.world === name && backup.auto);
        for (const old of autos.slice(AUTO_KEEP)) fs.rmSync(path.join(dir, old.file), { force: true });
    }
    return { world: name, file, createdAt: new Date().toISOString(), size: fs.statSync(target).size, auto };
}

/* The world folders in saves, each with a level.dat. */
function worldFolders(instance) {
    const saves = savesOf(instance);
    if (!fs.existsSync(saves)) return [];
    return fs
        .readdirSync(saves, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && fs.existsSync(path.join(saves, entry.name, "level.dat")))
        .map((entry) => entry.name);
}

/*
 * Before an update, when the instance asks for it: a backup of each world that changed
 * since its last backup (so asking twice for one update makes one backup).
 */
async function backupBeforeUpdate(instance, { running = false, onProgress } = {}) {
    if (!instance?.backupWorldsBeforeUpdates || running) return [];
    const existing = listBackups(instance);
    const made = [];
    const folders = worldFolders(instance);
    for (const [i, folder] of folders.entries()) {
        const latest = existing.find((backup) => backup.world === folder);
        const changed = fs.statSync(path.join(savesOf(instance), folder, "level.dat")).mtimeMs;
        if (latest && Date.parse(latest.createdAt) >= changed) continue;
        onProgress?.({ stage: "updates", percent: 0, detail: `Backing up "${folder}" (${i + 1} of ${folders.length})` });
        made.push(await backupWorld(instance, folder, { auto: true }));
    }
    return made;
}

/* Puts a backup back: the world as it is now goes to the Bin, the backup takes its place. */
async function restoreBackup(instance, folder, file) {
    const zipPath = backupPath(instance, folder, file);
    const world = worldPath(instance, folder);
    const saves = path.dirname(world);
    const temp = path.join(saves, `.restoring-${Date.now()}`);
    fs.mkdirSync(temp, { recursive: true });

    try {
        await withZip(zipPath, async (directory) => {
            const files = directory.files.filter((entry) => entry.type === "File");
            const total = files.reduce((sum, entry) => sum + (entry.uncompressedSize || 0), 0);
            if (total > MAX_WORLD_BYTES) throw new Error("That backup unpacks to more than 8 GB, so it wasn't restored.");
            let written = 0;
            const base = path.resolve(temp);
            for (const entry of files) {
                // Every file sits in the world's own folder in the zip.
                const relative = posix(entry.path).split("/").slice(1).join("/");
                const target = path.resolve(base, relative);
                if (!relative || !target.startsWith(base + path.sep)) continue;
                fs.mkdirSync(path.dirname(target), { recursive: true });
                const counter = new Transform({
                    transform(chunk, _enc, done) {
                        written += chunk.length;
                        if (written > MAX_WORLD_BYTES) return done(new Error("That backup unpacks to more than 8 GB, so it wasn't restored."));
                        done(null, chunk);
                    },
                });
                await pipeline(entry.stream(), counter, fs.createWriteStream(target));
            }
        });
        if (!fs.existsSync(path.join(temp, "level.dat"))) throw new Error("That backup has no level.dat, so it isn't a whole world.");
        if (fs.existsSync(world)) await shell.trashItem(world);
        fs.renameSync(temp, world);
    } catch (err) {
        fs.rmSync(temp, { recursive: true, force: true });
        throw err;
    }
}

async function deleteBackup(instance, folder, file) {
    await shell.trashItem(backupPath(instance, folder, file));
}

async function openBackups(instance, folder) {
    const dir = folder ? path.join(backupsOf(instance), path.basename(worldPath(instance, folder))) : backupsOf(instance);
    fs.mkdirSync(dir, { recursive: true });
    const failed = await shell.openPath(dir);
    if (failed) throw new Error(failed);
}

module.exports = { listBackups, backupWorld, backupBeforeUpdate, restoreBackup, deleteBackup, openBackups };
