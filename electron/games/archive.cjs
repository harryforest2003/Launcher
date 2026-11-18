const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
// Zips go through one open handle (see minecraft/zipFile.cjs).
const { withZip } = require("../minecraft/zipFile.cjs");

const run = promisify(execFile);

/*
 * Unpacking whatever a mod comes in. Zips are read here; .7z and .rar, which most Nexus
 * mods use, go through the system's own tar (bsdtar, built on libarchive), which macOS
 * and Windows 10 and later both have. A file that isn't an archive is used as it is.
 */

const ARCHIVES = [".zip", ".7z", ".rar"];

const isArchive = (file) => ARCHIVES.includes(path.extname(file).toLowerCase());

function tempDir(prefix = "unity-game-mod-") {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Never written outside the folder it's unpacked into.
function insideOf(root, target) {
    const resolved = path.resolve(target);
    return resolved === path.resolve(root) || resolved.startsWith(path.resolve(root) + path.sep);
}

async function unzip(file, into) {
    await withZip(file, async (directory) => {
    for (const entry of directory.files) {
        const target = path.join(into, entry.path);
        if (!insideOf(into, target)) continue;
        if (entry.type === "Directory") {
            fs.mkdirSync(target, { recursive: true });
            continue;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, await entry.buffer());
    }
    });
}

async function untar(file, into) {
    const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
    try {
        await run(tar, ["-xf", file, "-C", into], { timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
    } catch (err) {
        const kind = path.extname(file).slice(1).toUpperCase();
        throw new Error(`This ${kind} file couldn't be unpacked (${String(err.stderr || err.message).trim().split("\n")[0]}). Unpack it yourself and choose the files inside.`);
    }
    // tar can write through links; anything that ended up outside is removed. Both sides
    // are resolved, as the temporary folder itself is reached through a link on a Mac.
    const real = fs.realpathSync(into);
    for (const name of fs.readdirSync(into)) {
        const full = path.join(into, name);
        if (!insideOf(real, fs.realpathSync(full))) fs.rmSync(full, { recursive: true, force: true });
    }
    // A mod needs no links of its own, and one left inside could point anywhere: all go.
    removeLinks(into);
}

/* Removes every symbolic link under a folder (the links themselves, never what they point to). */
function removeLinks(dir) {
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) fs.rmSync(full, { force: true });
        else if (entry.isDirectory()) removeLinks(full);
    }
}

/*
 * Unpacks a mod into a new temporary folder and returns it, with what to remove after.
 * -> { dir, cleanup, single: true when the file wasn't an archive }
 */
async function unpack(file, { whole = false } = {}) {
    const dir = tempDir();
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    try {
        const ext = path.extname(file).toLowerCase();
        if (whole) {
            // A game whose mods are themselves .zip files (Factorio, Hytale): copied as it is.
            fs.copyFileSync(file, path.join(dir, path.basename(file)));
            return { dir, cleanup, single: true };
        }
        if (ext === ".zip") await unzip(file, dir);
        else if (ext === ".7z" || ext === ".rar") await untar(file, dir);
        else {
            fs.copyFileSync(file, path.join(dir, path.basename(file)));
            return { dir, cleanup, single: true };
        }
        return { dir, cleanup, single: false };
    } catch (err) {
        cleanup();
        throw err;
    }
}

/*
 * The files inside an archive, without unpacking it: a zip's directory, or tar's listing
 * of a .7z or .rar. A file that isn't an archive is just itself.
 */
async function contents(file) {
    const ext = path.extname(file).toLowerCase();
    if (ext === ".zip") return withZip(file, async (directory) => directory.files.filter((entry) => entry.type !== "Directory").map((entry) => entry.path));
    if (ext === ".7z" || ext === ".rar") {
        const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
        const { stdout } = await run(tar, ["-tf", file], { timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
        return stdout.split(/\r?\n/).filter((line) => line && !line.endsWith("/"));
    }
    return [path.basename(file)];
}

/* Every file under a folder, as paths relative to it ("/"-separated), leaving out packaging noise. */
function listFiles(root) {
    const out = [];
    const walk = (dir, rel) => {
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name === "__MACOSX" || entry.name === ".DS_Store" || entry.name === "Thumbs.db") continue;
            const childRel = rel ? `${rel}/${entry.name}` : entry.name;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full, childRel);
            else if (entry.isFile()) out.push(childRel);
        }
    };
    walk(root, "");
    return out;
}

module.exports = { unpack, unzip, contents, listFiles, isArchive, tempDir, ARCHIVES };
