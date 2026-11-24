const fs = require("fs");
const path = require("path");

const instanceManager = require("../instanceManager.cjs");
const modpack = require("./modpack.cjs");
const { modInfo } = require("./modInfo.cjs");
const { downloadFile, pool, sha1 } = require("./net.cjs");
const { withZip } = require("./zipFile.cjs");

/*
 * Moving an instance made from a modpack to another version of the pack, newer or older.
 * Only the pack's own files change: mods the player added themselves stay, a pack mod
 * they turned off stays off, and their settings and server list are kept. Everything
 * the update replaces or removes is kept aside first, so Undo puts the instance back.
 */

const BACKUPS = "pack-backups";
const STAGING = "pack-staging";
const KEEP_BACKUPS = 3;
// The player's own settings and server list stay theirs, even where the pack ships its own.
const PLAYER_FILES = new Set(["options.txt", "optionsof.txt", "optionsshaders.txt", "servers.dat", "servers.dat_old"]);
// An old version's override files in these folders go when the new one leaves them out.
// Old configs stay: one the pack no longer uses does no harm, and the player may have edited it.
const CONTENT_FOLDERS = ["mods/", "resourcepacks/", "shaderpacks/"];
const SOURCES = new Set(["modrinth", "curseforge"]);

const norm = (rel) => String(rel ?? "").replace(/\\/g, "/").replace(/^\/+/, "");

/* A path inside the game folder, or null for one that would leave it. */
function inside(gameDir, rel) {
    const root = path.resolve(gameDir);
    const full = path.resolve(root, rel);
    return full.startsWith(root + path.sep) ? full : null;
}

/* Where a file is now: as named, or turned off (.disabled). */
function onDisk(gameDir, rel) {
    for (const candidate of [rel, `${rel}.disabled`]) {
        const full = inside(gameDir, candidate);
        if (full && fs.existsSync(full)) return candidate;
    }
    return null;
}

const gameDirOf = (instance, folder) => path.resolve(instance.gameDirectory ?? path.join(folder, ".minecraft"));

/* ---------------- which pack an instance came from ---------------- */

function packOf(instance) {
    const pack = instance?.modpack;
    return pack && SOURCES.has(pack.source) && pack.projectId ? pack : null;
}

/*
 * Notes the pack (and version of it) an instance was made from, so it can be updated.
 * -> the record kept in instance.json
 */
function rememberModpack(name, pack) {
    instanceManager.getInstance(name);
    if (!SOURCES.has(pack?.source) || !pack?.projectId) throw new Error("Only modpacks from Modrinth or CurseForge can be updated.");
    const record = {
        source: pack.source,
        projectId: String(pack.projectId),
        versionId: String(pack.versionId ?? ""),
        versionName: String(pack.versionName ?? ""),
        name: String(pack.name ?? ""),
    };
    instanceManager.writeInstanceFields(name, { modpack: record });
    return record;
}

/* ---------------- what a version of the pack holds ---------------- */

/* The override files in a pack: path in the game folder -> path in the zip (client-overrides win). */
async function overrideList(zipPath, overridesDir) {
    return withZip(zipPath, async (directory) => {
        const found = new Map();
        for (const prefix of [`${overridesDir}/`, "client-overrides/"]) {
            for (const entry of directory.files) {
                if (entry.type !== "File" || !entry.path.startsWith(prefix)) continue;
                const rel = norm(entry.path.slice(prefix.length));
                if (rel && !rel.endsWith("/")) found.set(rel, entry.path);
            }
        }
        return found;
    });
}

/* -> { info, files: Map(path -> download), blocked, overrides: Map(path -> zip entry) } */
async function packContents(zipPath, onResolve) {
    const info = await modpack.inspectModpack(zipPath);
    const { downloads, blocked } =
        info.format === "modrinth" ? modpack.resolveModrinthFiles(info.index) : await modpack.resolveCurseForgeFiles(info.manifest.files ?? [], onResolve);
    const files = new Map(downloads.map((download) => [norm(download.path), download]));
    const overrides = await overrideList(zipPath, info.overridesDir ?? "overrides");
    return { info, files, blocked, overrides };
}

/* The files the version installed holds, from the record, else from that version itself (or null). */
async function installedFiles(pack) {
    if (Array.isArray(pack.files)) return { files: new Set(pack.files.map(norm)), overrides: new Set((pack.overrides ?? []).map(norm)) };
    if (!pack.versionId) return null;
    let download;
    try {
        download = await modpack.downloadPackFile(pack.source, pack.projectId, pack.versionId);
        const old = await packContents(download.zipPath);
        return { files: new Set(old.files.keys()), overrides: new Set(old.overrides.keys()) };
    } catch {
        // That version is gone from the site: its files can't be told apart from the player's.
        return null;
    } finally {
        if (download) fs.rmSync(download.tempDir, { recursive: true, force: true });
    }
}

/* ---------------- keeping what changes ---------------- */

/* Keeps each file the update touches, once: a copy of it, or a note that it wasn't there. */
function journal(gameDir, dir) {
    const changes = [];
    const seen = new Set();
    return {
        changes,
        keep(rel) {
            if (seen.has(rel)) return;
            seen.add(rel);
            const full = inside(gameDir, rel);
            if (full && fs.existsSync(full)) {
                const copy = path.join(dir, "files", rel);
                fs.mkdirSync(path.dirname(copy), { recursive: true });
                fs.copyFileSync(full, copy);
                changes.push({ path: rel, had: true });
            } else {
                changes.push({ path: rel, had: false });
            }
        },
    };
}

function backupDirs(folder) {
    const root = path.join(folder, BACKUPS);
    try {
        return fs
            .readdirSync(root)
            .filter((name) => /^\d+$/.test(name))
            .sort((a, b) => Number(b) - Number(a))
            .map((name) => path.join(root, name));
    } catch {
        return [];
    }
}

/* Moves a file, copying where it's on another drive. */
function move(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
        fs.renameSync(from, to);
    } catch (err) {
        if (err.code !== "EXDEV") throw err;
        fs.copyFileSync(from, to);
        fs.rmSync(from, { force: true });
    }
}

/* ---------------- updating ---------------- */

/*
 * Moves an instance to another version of its modpack.
 * -> { from, to, added, updated, removed, kept, blocked, failed, loader, notes }
 */
async function updateModpack(name, versionId, { onProgress } = {}) {
    const report = (percent, detail) => onProgress?.({ stage: "pack", percent, detail });
    const instance = instanceManager.getInstance(name);
    const pack = packOf(instance);
    if (!pack) throw new Error(`"${name}" wasn't made from a modpack the launcher can update.`);
    if (instanceManager.isRunning(name)) throw new Error("Close Minecraft before updating its modpack.");
    if (!versionId) throw new Error("Pick the version of the pack to move to.");
    if (String(versionId) === String(pack.versionId)) throw new Error("That's the version installed already.");

    const folder = instanceManager.instanceFolder(name);
    const gameDir = gameDirOf(instance, folder);
    const stamp = String(Date.now());
    const staging = path.join(folder, STAGING, stamp);
    let download;

    try {
        report(0, "Downloading the new version of the pack");
        download = await modpack.downloadPackFile(pack.source, pack.projectId, String(versionId));
        const next = await packContents(download.zipPath, (done, total) => report(5 + Math.round((done / total) * 10), `Looking up files ${done}/${total}`));
        const { info } = next;

        if (info.mcVersion && info.mcVersion !== instance.version) {
            throw new Error(
                `That version of the pack is for Minecraft ${info.mcVersion}, and this instance is on ${instance.version}. ` +
                    "Make a new instance from it instead, so your worlds aren't opened in another Minecraft version."
            );
        }
        const loader = String(info.loader || "vanilla").toLowerCase();
        if (loader !== String(instance.loader || "vanilla").toLowerCase()) {
            throw new Error(`That version of the pack uses ${info.loader}, and this instance uses ${instance.loader}. Make a new instance from it instead.`);
        }

        report(16, "Comparing it with the version installed");
        const before = await installedFiles(pack);

        // 1. Every new or changed file is downloaded aside first, so nothing changes if one fails.
        const toPlace = [];
        let unchanged = 0;
        for (const [rel, item] of next.files) {
            if (!inside(gameDir, rel)) continue;
            const current = onDisk(gameDir, rel);
            if (current && item.sha1 && (await sha1(inside(gameDir, current)).catch(() => null)) === String(item.sha1).toLowerCase()) {
                unchanged += 1;
                continue;
            }
            toPlace.push({ rel, item, current, staged: path.join(staging, String(toPlace.length)) });
        }
        const { errors } = await pool(
            toPlace,
            (plan) =>
                downloadFile(plan.item.url, plan.staged, {
                    sha1: plan.item.sha1 ?? undefined,
                    sha512: plan.item.sha512 ?? undefined,
                    size: plan.item.size ?? undefined,
                    hosts: plan.item.hosts,
                    requireHash: Boolean(plan.item.hosts),
                }),
            { concurrency: 8, onProgress: (done, total) => report(20 + Math.round((done / Math.max(total, 1)) * 50), `Downloading ${done}/${total} changed files`) }
        );
        if (errors.length) {
            throw new Error(`${errors.length} of the pack's files couldn't be downloaded, so nothing was changed. ${errors[0]?.message ?? ""}`.trim());
        }

        // 2. What goes: the old version's files the new one leaves out, and a copy of a pack
        // mod the player updated by hand that the new version brings itself.
        report(72, "Working out what the new version leaves out");
        const leaving = new Set();
        if (before) {
            for (const rel of before.files) if (!next.files.has(rel)) leaving.add(rel);
            for (const rel of before.overrides) {
                if (CONTENT_FOLDERS.some((dir) => rel.startsWith(dir)) && !next.overrides.has(rel) && !next.files.has(rel)) leaving.add(rel);
            }
        }
        const packJars = [...next.files.keys(), ...next.overrides.keys()].filter((rel) => rel.startsWith("mods/") && rel.endsWith(".jar"));
        const known = new Set([...packJars, ...(before ? [...before.files, ...before.overrides] : [])]);
        const modsDir = path.join(gameDir, "mods");
        const loose = (fs.existsSync(modsDir) ? fs.readdirSync(modsDir) : [])
            .filter((file) => /\.jar(\.disabled)?$/i.test(file))
            .map((file) => `mods/${file}`)
            .filter((rel) => !known.has(rel.replace(/\.disabled$/i, "")));
        if (loose.length) {
            const packIds = new Set();
            const staged = new Map(toPlace.map((plan) => [plan.rel, plan.staged]));
            for (const rel of packJars) {
                const file = staged.get(rel) ?? (onDisk(gameDir, rel) && inside(gameDir, onDisk(gameDir, rel)));
                const jar = file ? await modInfo(file) : null;
                for (const id of jar?.ids ?? []) packIds.add(id);
            }
            for (const rel of loose) {
                const jar = await modInfo(inside(gameDir, rel));
                if (jar?.ids?.length && jar.ids.some((id) => packIds.has(id))) leaving.add(rel.replace(/\.disabled$/i, ""));
            }
        }

        // 3. The loader the new version needs, before any file changes (it can fail on the network).
        let loaderChange = null;
        if (info.loaderVersion && instance.loader && instance.loader !== "vanilla" && info.loaderVersion !== instance.loaderVersion) {
            report(75, `Installing ${instance.loader} ${info.loaderVersion}`);
            loaderChange = await instanceManager.changeLoaderVersion(name, info.loaderVersion, { onProgress });
        }

        // 4. Swap the files, keeping each one replaced or removed.
        report(85, "Putting in the new version");
        const backup = path.join(folder, BACKUPS, stamp);
        fs.mkdirSync(backup, { recursive: true });
        const kept = journal(gameDir, backup);
        let removed = 0;
        for (const rel of leaving) {
            const current = onDisk(gameDir, rel);
            if (!current) continue;
            kept.keep(current);
            fs.rmSync(inside(gameDir, current), { force: true });
            removed += 1;
        }
        let added = 0;
        let updated = 0;
        for (const plan of toPlace) {
            // A pack mod the player turned off stays off.
            const target = plan.current && plan.current.endsWith(".disabled") ? `${plan.rel}.disabled` : plan.rel;
            kept.keep(target);
            move(plan.staged, inside(gameDir, target));
            if (plan.current) updated += 1;
            else added += 1;
        }
        let playerKept = 0;
        await withZip(download.zipPath, async (directory) => {
            const entries = new Map(directory.files.map((entry) => [entry.path, entry]));
            for (const [rel, entryPath] of next.overrides) {
                const full = inside(gameDir, rel);
                if (!full) continue;
                if (PLAYER_FILES.has(rel) && fs.existsSync(full)) {
                    playerKept += 1;
                    continue;
                }
                const buffer = await entries.get(entryPath).buffer();
                if (fs.existsSync(full) && fs.readFileSync(full).equals(buffer)) continue;
                kept.keep(rel);
                fs.mkdirSync(path.dirname(full), { recursive: true });
                fs.writeFileSync(full, buffer);
            }
        });

        const from = { versionId: pack.versionId, versionName: pack.versionName };
        const to = { versionId: String(versionId), versionName: download.versionName ?? info.packVersion ?? "" };
        fs.writeFileSync(
            path.join(backup, "journal.json"),
            JSON.stringify({ time: new Date().toISOString(), pack, loader: loaderChange?.from ?? null, changes: kept.changes }, null, 2)
        );
        for (const dir of backupDirs(folder).slice(KEEP_BACKUPS)) fs.rmSync(dir, { recursive: true, force: true });

        instanceManager.writeInstanceFields(name, {
            modpack: { ...pack, ...to, files: [...next.files.keys()], overrides: [...next.overrides.keys()].filter((rel) => CONTENT_FOLDERS.some((dir) => rel.startsWith(dir))) },
        });
        report(100, "Modpack updated");

        const notes = [];
        if (!before) notes.push("The version installed before isn't on the site any more, so files it had that the new one dropped may still be there.");
        if (playerKept) notes.push("Your own settings and server list were kept.");
        return {
            from,
            to,
            added,
            updated,
            removed,
            unchanged,
            blocked: next.blocked,
            loader: loaderChange ? { from: loaderChange.from.loaderVersion, to: loaderChange.to.loaderVersion } : null,
            notes,
        };
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
        try {
            fs.rmdirSync(path.dirname(staging));
        } catch {
            // Not empty.
        }
        if (download) fs.rmSync(download.tempDir, { recursive: true, force: true });
    }
}

/* The latest pack update that Undo can put back: { time, from, to } or null. */
function lastModpackUpdate(name) {
    const folder = instanceManager.instanceFolder(name);
    const current = instanceManager.getInstance(name).modpack ?? null;
    for (const dir of backupDirs(folder)) {
        try {
            const saved = JSON.parse(fs.readFileSync(path.join(dir, "journal.json"), "utf8"));
            return { time: saved.time, from: saved.pack?.versionName ?? "", to: current?.versionName ?? "" };
        } catch {
            // An unfinished one; look at the one before.
        }
    }
    return null;
}

/* Puts the instance back as it was before the latest pack update. -> { version } */
async function undoModpackUpdate(name, { onProgress } = {}) {
    const instance = instanceManager.getInstance(name);
    if (instanceManager.isRunning(name)) throw new Error("Close Minecraft before undoing the modpack update.");
    const folder = instanceManager.instanceFolder(name);
    const gameDir = gameDirOf(instance, folder);
    const dir = backupDirs(folder).find((candidate) => fs.existsSync(path.join(candidate, "journal.json")));
    if (!dir) throw new Error("There's no modpack update to undo.");
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "journal.json"), "utf8"));

    if (saved.loader?.loaderVersion) await instanceManager.restoreLoader(name, saved.loader, { onProgress });
    for (const change of [...saved.changes].reverse()) {
        const full = inside(gameDir, change.path);
        if (!full) continue;
        if (change.had) {
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.copyFileSync(path.join(dir, "files", change.path), full);
        } else {
            fs.rmSync(full, { force: true });
        }
    }
    instanceManager.writeInstanceFields(name, { modpack: saved.pack });
    fs.rmSync(dir, { recursive: true, force: true });
    return { version: saved.pack?.versionName ?? "" };
}

module.exports = { rememberModpack, updateModpack, lastModpackUpdate, undoModpackUpdate, packOf };
