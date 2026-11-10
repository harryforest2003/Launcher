const fs = require("fs");
const os = require("os");
const path = require("path");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const unzipper = require("unzipper");
const yazl = require("yazl");

/*
 * Cloud backup and restore.
 *
 * Deliberately folder-based rather than OAuth-based. OneDrive, Dropbox,
 * iCloud Drive and Google Drive all present themselves as ordinary
 * folders that sync in the background, so exporting an instance into one
 * of those folders gets it onto every machine the user owns — with no
 * app registration, no client secret, and no token to expire. It also
 * works for a NAS or a USB stick.
 */

const home = os.homedir();

/* ---------------- provider detection ---------------- */

const CANDIDATES = [
    { id: "onedrive", label: "OneDrive", paths: [
        path.join(home, "OneDrive"),
        path.join(home, "OneDrive - Personal"),
        process.env.OneDrive,
        process.env.OneDriveConsumer,
    ]},
    { id: "icloud", label: "iCloud Drive", paths: [
        path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs"),
    ]},
    { id: "dropbox", label: "Dropbox", paths: [
        path.join(home, "Dropbox"),
    ]},
    { id: "gdrive", label: "Google Drive", paths: [
        path.join(home, "Google Drive"),
        path.join(home, "Library", "CloudStorage"),
        "G:\\My Drive",
    ]},
];

/*
 * macOS puts modern Google Drive / OneDrive mounts under
 * ~/Library/CloudStorage/<Provider>-<account>.
 */
function cloudStorageMounts() {
    const root = path.join(home, "Library", "CloudStorage");

    if (!fs.existsSync(root)) return [];

    try {
        return fs.readdirSync(root, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => ({
                id: `cloudstorage:${e.name}`,
                label: e.name.replace(/-/, " — "),
                path: path.join(root, e.name),
            }))
            // macOS can leave read-only remains of old accounts in here.
            .filter(mount => isWritable(mount.path));
    } catch {
        return [];
    }
}

function isWritable(folder) {
    try {
        fs.accessSync(folder, fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

function detectCloudFolders() {
    const found = [];
    const seen = new Set();

    for (const candidate of CANDIDATES) {
        for (const p of candidate.paths) {
            if (!p || seen.has(p)) continue;

            // CloudStorage is a container, not a provider folder itself.
            if (p.endsWith("CloudStorage")) continue;

            if (fs.existsSync(p)) {
                seen.add(p);
                found.push({ id: candidate.id, label: candidate.label, path: p });
                break;
            }
        }
    }

    for (const mount of cloudStorageMounts()) {
        if (seen.has(mount.path)) continue;
        seen.add(mount.path);
        found.push(mount);
    }

    // OneDrive comes first, since it's where backups go by default.
    return found.sort((a, b) => Number(isOneDrive(b)) - Number(isOneDrive(a)));
}

function isOneDrive(folder) {
    return /onedrive/i.test(folder.id);
}

/* The folder to use when none has been chosen. Only OneDrive is assumed. */
function defaultCloudFolder() {
    return detectCloudFolders().find(isOneDrive)?.path ?? "";
}

/* ---------------- what goes in a backup ---------------- */

const BACKUP_SUFFIX = ".unityinstance.zip";

// Things the game recreates, which only make a backup bigger and slower to sync.
const NOT_WORTH_KEEPING = new Set(["logs", "crash-reports", ".cache"]);

// Compressing these again takes time and saves almost nothing.
const ALREADY_COMPRESSED = /\.(jar|zip|mca|mcc|png|jpe?g|webp|ogg|mp3|gz|7z|rar)$/i;

function walk(dir, archiveDir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        const archivePath = `${archiveDir}/${entry.name}`;

        if (entry.isDirectory()) {
            walk(absolute, archivePath, out);
        } else if (entry.isFile()) {
            out.push({ absolute, archivePath, size: fs.statSync(absolute).size });
        }
    }

    return out;
}

/*
 * Only the things that can't be downloaded again: the instance definition, its record
 * of where each mod came from, and the game directory (mods, configs, saves). The
 * game itself, its libraries and its assets are fetched again when restoring.
 */
function filesToBackUp(instanceFolder) {
    const configFile = path.join(instanceFolder, "instance.json");

    if (!fs.existsSync(configFile)) {
        throw new Error(`That instance has no instance.json, so it can't be backed up.`);
    }

    const files = [{
        absolute: configFile,
        archivePath: "instance.json",
        size: fs.statSync(configFile).size,
    }];

    const modsRecord = path.join(instanceFolder, "unity-mods.json");

    if (fs.existsSync(modsRecord)) {
        files.push({
            absolute: modsRecord,
            archivePath: "unity-mods.json",
            size: fs.statSync(modsRecord).size,
        });
    }

    const gameDir = path.join(instanceFolder, ".minecraft");

    if (fs.existsSync(gameDir)) {
        for (const entry of fs.readdirSync(gameDir, { withFileTypes: true })) {
            if (NOT_WORTH_KEEPING.has(entry.name)) continue;

            const absolute = path.join(gameDir, entry.name);

            if (entry.isDirectory()) {
                walk(absolute, `minecraft/${entry.name}`, files);
            } else if (entry.isFile()) {
                files.push({
                    absolute,
                    archivePath: `minecraft/${entry.name}`,
                    size: fs.statSync(absolute).size,
                });
            }
        }
    }

    return files;
}

/* ---------------- backing up ---------------- */

/* Streams to disk, so a backup can be far larger than the computer's memory. */
async function writeZip(files, zipPath, onProgress) {
    const zip = new yazl.ZipFile();

    const failed = new Promise((_, reject) => zip.on("error", reject));

    for (const file of files) {
        zip.addFile(file.absolute, file.archivePath, {
            compress: !ALREADY_COMPRESSED.test(file.archivePath),
        });
    }

    zip.end();

    const total = files.reduce((sum, file) => sum + file.size, 0) || 1;
    let written = 0;
    let reportedAt = 0;

    const counter = new Transform({
        transform(chunk, _encoding, done) {
            written += chunk.length;

            const now = Date.now();

            if (now - reportedAt > 400) {
                reportedAt = now;
                onProgress?.(Math.min(95, Math.round((written / total) * 95)));
            }

            done(null, chunk);
        },
    });

    await Promise.race([
        pipeline(zip.outputStream, counter, fs.createWriteStream(zipPath)),
        failed,
    ]);

    return written;
}

/* Catches a backup that didn't fully reach the disk, before it replaces a good one. */
async function checkZip(zipPath, files) {
    const { files: entries } = await unzipper.Open.file(zipPath);
    const sizes = new Map(entries.map(entry => [entry.path, entry.uncompressedSize]));

    for (const file of files) {
        if (sizes.get(file.archivePath) !== file.size) {
            throw new Error(
                `The backup didn't save correctly (${file.archivePath} is wrong). Your last backup is unchanged.`
            );
        }
    }
}

function backupRoot(cloudFolder) {
    return path.join(cloudFolder, "UnityLauncher", "instances");
}

function previousRoot(cloudFolder) {
    return path.join(backupRoot(cloudFolder), "previous");
}

/*
 * Replaces the last backup only once the new one is known to be complete, and keeps
 * that last one too, in case what got backed up was already a broken world. The
 * temporary name is one that OneDrive and Dropbox don't sync.
 */
async function exportInstance(instanceFolder, instanceName, cloudFolder, onProgress) {
    if (!cloudFolder) throw new Error("No cloud folder configured.");

    if (!fs.existsSync(cloudFolder)) {
        throw new Error(
            `The cloud folder isn't there any more: ${cloudFolder}\n` +
            "Choose it again in Settings."
        );
    }

    const fileName = `${instanceName}${BACKUP_SUFFIX}`;
    const target = path.join(backupRoot(cloudFolder), fileName);
    const temporary = `${target}.tmp`;

    fs.mkdirSync(backupRoot(cloudFolder), { recursive: true });

    try {
        const files = filesToBackUp(instanceFolder);

        await writeZip(files, temporary, percent => onProgress?.(percent, "Saving backup"));

        onProgress?.(97, "Checking backup");
        await checkZip(temporary, files);

        if (fs.existsSync(target)) {
            fs.mkdirSync(previousRoot(cloudFolder), { recursive: true });
            fs.renameSync(target, path.join(previousRoot(cloudFolder), fileName));
        }

        fs.renameSync(temporary, target);

        return { path: target, files: files.length, bytes: fs.statSync(target).size };

    } catch (err) {
        fs.rmSync(temporary, { force: true });
        throw err;
    }
}

function describeBackup(file) {
    try {
        const stat = fs.statSync(file);
        return { file, size: stat.size, modified: stat.mtime.toISOString() };
    } catch {
        return null;
    }
}

function listCloudInstances(cloudFolder) {
    const root = backupRoot(cloudFolder);

    if (!cloudFolder || !fs.existsSync(root)) return [];

    const found = [];

    for (const fileName of fs.readdirSync(root)) {
        if (fileName.endsWith(BACKUP_SUFFIX)) {
            const name = fileName.slice(0, -BACKUP_SUFFIX.length);
            const backup = describeBackup(path.join(root, fileName));

            if (backup) {
                found.push({
                    name,
                    ...backup,
                    previous: describeBackup(path.join(previousRoot(cloudFolder), fileName)),
                    notDownloaded: false,
                });
            }

            continue;
        }

        // iCloud can leave a small stand-in until a file is actually on this device.
        const standIn = fileName.match(/^\.(.+)\.unityinstance\.zip\.icloud$/);

        if (standIn) {
            found.push({
                name: standIn[1],
                file: path.join(root, fileName),
                size: 0,
                modified: null,
                previous: null,
                notDownloaded: true,
            });
        }
    }

    return found.sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------------- restoring ---------------- */

async function openBackup(zipPath) {
    try {
        return await unzipper.Open.file(zipPath);
    } catch {
        throw new Error(
            "That backup isn't complete. If it's still syncing to this device, try again once it has finished."
        );
    }
}

async function readCloudInstance(zipPath) {
    const directory = await openBackup(zipPath);

    // Exactly at the top level: mods can have their own files with this name.
    const configEntry = directory.files.find(entry => entry.path === "instance.json");

    if (!configEntry) {
        throw new Error("That archive is not a Unity instance export.");
    }

    const config = JSON.parse((await configEntry.buffer()).toString("utf8"));

    return { config, directory };
}

async function extractCloudInstance(zipPath, targetGameDir, instanceFolder, onProgress) {
    const directory = await openBackup(zipPath);

    const root = path.resolve(targetGameDir) + path.sep;

    const wanted = directory.files.filter(entry =>
        entry.type === "File" && entry.path.startsWith("minecraft/")
    );

    const total = wanted.reduce((sum, entry) => sum + entry.uncompressedSize, 0) || 1;
    let done = 0;
    let written = 0;

    for (const entry of wanted) {
        const target = path.resolve(targetGameDir, entry.path.slice("minecraft/".length));

        // A tampered archive can name a path outside the instance.
        if (!target.startsWith(root)) continue;

        fs.mkdirSync(path.dirname(target), { recursive: true });
        await pipeline(entry.stream(), fs.createWriteStream(target));

        done += entry.uncompressedSize;
        written += 1;
        onProgress?.(Math.round((done / total) * 100));
    }

    const modsRecord = directory.files.find(entry => entry.path === "unity-mods.json");

    if (modsRecord && instanceFolder) {
        await pipeline(
            modsRecord.stream(),
            fs.createWriteStream(path.join(instanceFolder, "unity-mods.json"))
        );
    }

    return written;
}

module.exports = {
    detectCloudFolders,
    defaultCloudFolder,
    exportInstance,
    listCloudInstances,
    readCloudInstance,
    extractCloudInstance,
    backupRoot,
};
