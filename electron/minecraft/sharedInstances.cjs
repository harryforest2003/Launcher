const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const instanceManager = require("../instanceManager.cjs");
const instanceMods = require("./instanceMods.cjs");
const shareCodes = require("../shareCodes.cjs");

/*
 * Shared instances: one person keeps an instance, the others follow it. There is no server.
 * The owner publishes a small file (a share code with a revision number) into a folder that
 * syncs (Dropbox, iCloud Drive, OneDrive) or anywhere they like, and sends its path or a
 * link to it. Each member reads that file to see if there's a newer revision; updating
 * downloads what was added from Modrinth and CurseForge and removes what the owner took
 * out. Files a member added themselves are left alone.
 *
 * The file only names Modrinth versions and CurseForge files, so following someone can
 * never download anything from anywhere else.
 */

const FORMAT = "unity-shared-instance";
const EXTENSION = ".unityshare";
const MAX_BYTES = 2 * 1024 * 1024;
const LOADER_NAMES = { fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge", "legacy-fabric": "Legacy Fabric", babric: "Babric", liteloader: "LiteLoader" };

/* Share links from file hosts, turned into links that give the file itself. */
function downloadLink(source) {
    const url = new URL(source);
    if (url.protocol !== "https:") throw new Error("Use an https link, or the file's path on this computer.");
    const host = url.hostname.toLowerCase();
    if (host === "dropbox.com" || host.endsWith(".dropbox.com")) {
        url.searchParams.delete("raw");
        url.searchParams.set("dl", "1");
        return url.toString();
    }
    const drive = host === "drive.google.com" && url.pathname.match(/^\/file\/d\/([\w-]+)/);
    if (drive) return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
    return url.toString();
}

const isLink = (source) => /^[a-z][a-z0-9+.-]*:\/\//i.test(String(source).trim());

function checkFile(data) {
    if (!data || data.format !== FORMAT) throw new Error("That isn't a shared instance file.");
    if (typeof data.id !== "string" || !data.id) throw new Error("That shared instance file has no id.");
    if (!Number.isInteger(data.revision) || data.revision < 1) throw new Error("That shared instance file has no revision number.");
    if (typeof data.code !== "string" || !data.code) throw new Error("That shared instance file has nothing in it.");
    return data;
}

/* The shared file at a path or a link: { format, id, revision, updated, name, version, loader, code }. */
async function readShareFile(source) {
    const where = String(source ?? "").trim();
    if (!where) throw new Error("Paste a link to the shared file or choose it.");
    let text;
    if (isLink(where)) {
        const res = await fetch(downloadLink(where), { redirect: "follow", signal: AbortSignal.timeout(30 * 1000) });
        if (!res.ok) throw new Error(`The shared file couldn't be downloaded (HTTP ${res.status}).`);
        if (Number(res.headers.get("content-length")) > MAX_BYTES) throw new Error("That file is too big to be a shared instance.");
        text = await res.text();
    } else {
        const stat = fs.statSync(where, { throwIfNoEntry: false });
        if (!stat?.isFile()) throw new Error(`There's no file at ${where}. If it's in a synced folder, check it has finished syncing.`);
        if (stat.size > MAX_BYTES) throw new Error("That file is too big to be a shared instance.");
        text = fs.readFileSync(where, "utf8");
    }
    if (text.length > MAX_BYTES) throw new Error("That file is too big to be a shared instance.");
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error("That isn't a shared instance file. If it's a link, check it opens the file itself.");
    }
    return checkFile(data);
}

/* Where a first publish suggests saving: a synced folder when there is one. */
function suggestedPath(name, cloudFolders = require("./cloud.cjs").detectCloudFolders()) {
    const base = cloudFolders[0]?.path;
    if (!base) return "";
    const fileName = `${String(name).replace(/[\\/:*?"<>|]+/g, "-").trim() || "Instance"}${EXTENSION}`;
    return path.join(base, "Unity Launcher", "Shared", fileName);
}

function writeShareFile(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, file);
}

/* The owner writes the instance as it is now, one revision on. */
async function publish(name, { target } = {}) {
    const instance = instanceManager.getInstance(name);
    const current = instance.shared;
    if (current?.role === "member") throw new Error("This instance follows someone else's. Stop following it to share it as your own.");

    let file = String(target || current?.path || "").trim();
    if (!file) throw new Error("Choose where to save the shared file.");
    if (!file.toLowerCase().endsWith(EXTENSION)) file += EXTENSION;
    file = path.resolve(file);

    const { code, linked, missing } = await require("./instanceShare.cjs").instanceShareCode(name);
    const id = current?.id ?? crypto.randomUUID();
    let revision = (current?.revision ?? 0) + 1;
    // Published from another computer since: carry on from its number.
    try {
        const there = checkFile(JSON.parse(fs.readFileSync(file, "utf8")));
        if (there.id === id && there.revision >= revision) revision = there.revision + 1;
    } catch {
        // No file yet, or not ours: it's replaced.
    }

    const updated = new Date().toISOString();
    const loader = String(instance.loader || "vanilla").toLowerCase();
    writeShareFile(file, { format: FORMAT, id, revision, updated, name: instance.name, version: instance.version, loader, code });
    instanceManager.writeInstanceFields(name, { shared: { role: "owner", path: file, id, revision, updated } });
    return { path: file, revision, linked, missing };
}

/* A new instance that follows the shared one. */
async function join(source, { name, onProgress } = {}) {
    const remote = await readShareFile(source);
    const done = await require("./instanceShare.cjs").importInstanceCode(remote.code, { name: name || remote.name, onProgress });
    instanceManager.writeInstanceFields(done.name, {
        shared: { role: "member", source: String(source).trim(), id: remote.id, revision: remote.revision, updated: remote.updated, files: done.files },
    });
    return { ...done, revision: remote.revision };
}

/* Whether there's a newer revision than this instance has. */
async function check(name) {
    const instance = instanceManager.getInstance(name);
    const shared = instance.shared;
    if (!shared) return null;
    if (shared.role === "owner") {
        return { role: "owner", revision: shared.revision, updated: shared.updated, path: shared.path, fileFound: fs.existsSync(shared.path) };
    }
    const remote = await readShareFile(shared.source);
    if (remote.id !== shared.id) throw new Error("That file is now a different shared instance. Stop following this one and join the new one.");
    const moved = movedTo(instance, remote);
    return { role: "member", revision: shared.revision, latest: remote.revision, updated: remote.updated, available: remote.revision > shared.revision, moved };
}

/* "Minecraft 1.21.4 with Fabric" when the owner moved the instance to another version or loader. */
function movedTo(instance, remote) {
    const loader = String(instance.loader || "vanilla").toLowerCase();
    if (remote.version === instance.version && String(remote.loader || "vanilla").toLowerCase() === loader) return null;
    const named = String(remote.loader || "vanilla").toLowerCase();
    if (named === "vanilla") return `Minecraft ${remote.version}`;
    return `Minecraft ${remote.version} with ${LOADER_NAMES[named] ?? named[0].toUpperCase() + named.slice(1)}`;
}

const keyOf = (file) => `${file.type}/${file.fileName}`;

/*
 * What updating does: the shared files this instance doesn't have yet are downloaded, and
 * the ones from the last revision that the new one doesn't have are removed. `has(file)`
 * says whether a file is in the instance, on or off.
 */
function planUpdate(previous, next, has) {
    const nextKeys = new Set(next.map(keyOf));
    return {
        get: next.filter((file) => !has(file)),
        remove: (previous ?? []).filter((file) => !nextKeys.has(keyOf(file)) && has(file)),
    };
}

async function update(name, { onProgress = () => {} } = {}) {
    const { resolveFiles } = require("./instanceShare.cjs");
    const { pool } = require("./net.cjs");
    const instance = instanceManager.getInstance(name);
    const shared = instance.shared;
    if (shared?.role !== "member") throw new Error("This instance doesn't follow a shared one.");

    const remote = await readShareFile(shared.source);
    if (remote.id !== shared.id) throw new Error("That file is now a different shared instance. Stop following this one and join the new one.");
    const decoded = shareCodes.decode(remote.code);
    const moved = movedTo(instance, { version: decoded.version, loader: decoded.loader });
    if (moved) throw new Error(`The shared instance moved to ${moved}. Join it again to get it as a new instance.`);

    if (decoded.loaderVersion && instance.loaderVersion && decoded.loaderVersion !== instance.loaderVersion) {
        await instanceManager.changeLoaderVersion(name, decoded.loaderVersion, { onProgress: (progress) => onProgress({ name, ...progress }) });
    }

    onProgress({ name, stage: "share", percent: 0, detail: "Looking up the shared files" });
    const { files, blocked } = await resolveFiles(decoded);
    const folder = instanceManager.instanceFolder(name);
    const has = (file) => {
        try {
            const target = instanceMods.resolveItem(folder, file);
            return fs.existsSync(target) || fs.existsSync(`${target}.disabled`);
        } catch {
            return false;
        }
    };
    const plan = planUpdate(shared.files, files, has);

    const failed = [];
    let installed = 0;
    await pool(
        plan.get,
        async (file) => {
            try {
                await instanceMods.installContent(folder, file);
                installed++;
            } catch (err) {
                failed.push({ name: file.name, error: err.message });
            }
        },
        { concurrency: 6, onProgress: (done, total) => onProgress({ name, stage: "share", percent: Math.round((done / total) * 100), detail: `Downloading ${done} of ${total}` }) }
    );
    let removed = 0;
    for (const file of plan.remove) {
        try {
            instanceMods.deleteItem(folder, file);
            removed++;
        } catch {
            // Already gone.
        }
    }

    const kept = files.map(({ type, fileName, sha1 }) => ({ type, fileName, sha1: sha1 ?? null }));
    instanceManager.writeInstanceFields(name, { shared: { ...shared, revision: remote.revision, updated: remote.updated, files: kept } });
    return { revision: remote.revision, installed, removed, failed, blocked };
}

/* Stops sharing or following; the instance and its files stay as they are. */
function leave(name) {
    instanceManager.getInstance(name);
    instanceManager.writeInstanceFields(name, { shared: undefined });
}

module.exports = { FORMAT, EXTENSION, downloadLink, readShareFile, suggestedPath, publish, join, check, update, leave, planUpdate, movedTo };
