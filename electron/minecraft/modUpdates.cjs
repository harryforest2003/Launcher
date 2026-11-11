const fs = require("fs");
const path = require("path");
const { getSecret } = require("../secrets.cjs");
const { curseforgeJson } = require("../curseforge.cjs");
const instanceMods = require("./instanceMods.cjs");
const modSearch = require("./modSearch.cjs");
const { modInfo, modsIn } = require("./modInfo.cjs");
const { problemsWith } = require("./compat.cjs");
const { addonProblems } = require("./mixinCheck.cjs");
const { findProject, BUILT_IN } = require("./modDependencies.cjs");
const { requiredJava } = require("./javaRuntime.cjs");
const { CF_LOADER_TYPES, usesLoader } = require("./contentTypes.cjs");
const { downloadFile, fetchJson, pool, sha1 } = require("./net.cjs");

/*
 * Finds newer builds of an instance's mods, resource packs and shaders, for its Minecraft
 * version and loader, and installs them. Each file is known by what the launcher recorded
 * when it installed it, or else by its hash on Modrinth, which also finds files added by
 * hand or by other launchers.
 *
 * Every change is checked first: the new files are downloaded aside, and only those whose
 * requirements the instance meets go in (see compat.cjs). The files they replace are kept,
 * so the last change can be undone.
 */

const TYPES = ["mod", "resourcepack", "shader"];
const USER_AGENT = "UnityLauncher/1.0 (+https://github.com/harryforest2003/Launcher)";

async function modrinthPost(pathname, body) {
    const send = (token) =>
        fetch(`https://api.modrinth.com/v2${pathname}`, {
            method: "POST",
            headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60 * 1000),
        });
    const token = getSecret("modrinth");
    let res = await send(token);
    if (res.status === 401 && token) res = await send(null);
    if (!res.ok) throw new Error(`Modrinth HTTP ${res.status}`);
    return res.json();
}

// Hashes by file and version of it, so checking again only reads files that changed.
const hashes = new Map();

async function hashOf(file) {
    const { size, mtimeMs } = fs.statSync(file);
    const key = `${file}:${size}:${mtimeMs}`;
    if (!hashes.has(key)) hashes.set(key, sha1(file).catch((err) => { hashes.delete(key); throw err; }));
    return hashes.get(key);
}

/*
 * Every file that could have a newer build, with its hash and where it came from. One
 * request asks Modrinth about every hash at once, which identifies files added by hand
 * or by other launchers and gives the installed version of each.
 */
async function identify(folder) {
    const content = instanceMods.listContent(folder);
    const items = TYPES.flatMap((type) => (content[type] ?? []).filter((item) => item.kind === "file"));

    await pool(
        items,
        async (item) => {
            item.sha1 = await hashOf(instanceMods.resolveItem(folder, item) + (item.enabled ? "" : ".disabled"));
        },
        { concurrency: 8 }
    );

    const known = await modrinthPost("/version_files", { hashes: items.map((item) => item.sha1).filter(Boolean), algorithm: "sha1" }).catch(() => ({}));
    for (const item of items) {
        const version = known[item.sha1];
        if (!version) continue;
        item.modrinthVersion = { id: version.id, number: version.version_number, published: version.date_published, type: version.version_type };
        if (!(item.source === "modrinth" || item.source === "curseforge") || !item.projectId) {
            Object.assign(item, { source: "modrinth", projectId: version.project_id });
        }
        item.versionNumber ??= version.version_number;
    }

    return items;
}

/* Several Modrinth projects or teams by ID, 80 to a request. */
async function modrinthMany(kind, ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 80) {
        const chunk = ids.slice(i, i + 80);
        out.push(...((await fetchJson(`https://api.modrinth.com/v2/${kind}?ids=${encodeURIComponent(JSON.stringify(chunk))}`).catch(() => [])) ?? []));
    }
    return out;
}

/* Modrinth's names for what can load each kind of file. */
function loadersFor(type, loader) {
    if (type === "resourcepack") return ["minecraft"];
    if (type === "shader") return ["iris", "optifine", "canvas", "vanilla"];
    return [loader];
}

// Every file the latest check saw, so its versions can be listed and changed.
const lastItems = new Map();

// The latest check for each instance, which updates are then installed from, so the
// page never hands over a download address.
const lastCheck = new Map();

const keyOf = (item) => `${item.type}/${item.fileName}`;
const looksNameless = (item) => item.name === item.fileName.replace(/\.(jar|zip)$/i, "");

/*
 * Checks every mod, resource pack and shader for a newer build for this instance, the
 * way the Modrinth app does: the files Modrinth knows are asked about together, in one
 * request per kind, and the rest (CurseForge files) one at a time. A stable release is
 * only offered stable updates; a beta can update to anything newer.
 *
 * Returns { checked, identified, updates, status }, where status says for each file
 * ("mod/sodium.jar") whether an update is waiting ("update"), it's the newest
 * ("current"), or it can't be checked ("unknown"), with the name and icon Modrinth
 * gives for files the launcher didn't install.
 */
async function checkUpdates(name, instance, folder) {
    const loader = String(instance.loader || "vanilla").toLowerCase();
    const items = await identify(folder);
    const status = {};
    const pending = [];
    // A stable release whose newest build is a beta: looked at again for a newer stable one.
    const stableOnly = [];

    const LOADERS = { mod: loadersFor("mod", loader), resourcepack: loadersFor("resourcepack"), shader: loadersFor("shader") };
    const addUpdate = (item, latest) => {
        status[keyOf(item)] = { state: "update", current: item.versionNumber ?? null, latest: latest.versionNumber };
        pending.push({
            key: keyOf(item),
            type: item.type,
            fileName: item.fileName,
            enabled: item.enabled,
            name: item.name,
            iconUrl: item.iconUrl,
            source: item.source,
            projectId: item.projectId,
            current: item.versionNumber ?? item.fileName,
            latest: latest.versionNumber,
            file: { url: latest.url, fileName: latest.fileName, sha1: latest.sha1 },
        });
    };

    // Files Modrinth knows: the newest build of each for this version, all at once.
    const onModrinth = items.filter((item) => item.modrinthVersion);
    for (const type of TYPES) {
        const group = onModrinth.filter((item) => item.type === type);
        if (!group.length || (type === "mod" && loader === "vanilla")) continue;

        const newest = await modrinthPost("/version_files/update", {
            hashes: group.map((item) => item.sha1),
            algorithm: "sha1",
            loaders: LOADERS[type],
            game_versions: [instance.version],
        }).catch(() => null);

        for (const item of group) {
            if (!newest) {
                status[keyOf(item)] = { state: "unknown" };
                continue;
            }
            const version = newest[item.sha1];
            const isThisFile = version?.files?.some((file) => file.hashes?.sha1 === item.sha1);
            // Nothing for this version, this very file, or only an older build: nothing to do.
            if (!version || isThisFile || Date.parse(version.date_published) <= Date.parse(item.modrinthVersion.published)) {
                status[keyOf(item)] = { state: "current", current: item.versionNumber ?? null };
                continue;
            }
            if (version.version_type !== "release" && item.modrinthVersion.type === "release") {
                stableOnly.push(item);
                continue;
            }
            const file = version.files.find((f) => f.primary) ?? version.files[0];
            addUpdate(item, { versionNumber: version.version_number, url: file.url, fileName: file.filename, sha1: file.hashes?.sha1 ?? null });
        }
    }

    // The rest that say where they came from (CurseForge files), and stable releases
    // that should stay stable, one at a time (this picks the newest stable build).
    const others = [
        ...items.filter((item) => !item.modrinthVersion && item.projectId && (item.source === "modrinth" || item.source === "curseforge")),
        ...stableOnly,
    ];
    await pool(
        others,
        async (item) => {
            try {
                const latest = await modSearch.resolveModFile(item.source, item.projectId, instance.version, loader, item.type);
                const same = latest.sha1 ? latest.sha1 === item.sha1 : latest.fileName === item.fileName;
                // Modrinth's newest stable build can be older than the one installed.
                const older = item.modrinthVersion && latest.published && Date.parse(latest.published) <= Date.parse(item.modrinthVersion.published);
                if (same || older) status[keyOf(item)] = { state: "current", current: item.versionNumber ?? null };
                else addUpdate(item, latest);
            } catch (err) {
                status[keyOf(item)] = { state: err.code === "NO_BUILD" ? "current" : "unknown", current: item.versionNumber ?? null };
            }
        },
        { concurrency: 6 }
    );

    for (const item of items) status[keyOf(item)] ??= { state: "unknown" };

    // From each file's Modrinth page: who publishes it, and a name and icon for files the
    // launcher didn't install.
    const fromModrinth = onModrinth.filter((item) => item.source === "modrinth");
    const projects = await modrinthMany("projects", [...new Set(fromModrinth.map((item) => item.projectId))]);
    const teams = await modrinthMany("teams", [...new Set(projects.map((project) => project.team).filter(Boolean))]);
    // Modrinth lists the original author or owner first.
    const ownerOf = new Map();
    for (const members of teams) {
        const owner = (members ?? []).find((member) => member.role === "Owner") ?? members?.[0];
        if (owner?.team_id && owner.user?.username) ownerOf.set(owner.team_id, owner.user.username);
    }
    for (const item of fromModrinth) {
        const project = projects.find((p) => p.id === item.projectId);
        if (!project) continue;
        const entry = status[keyOf(item)];
        if (looksNameless(item)) entry.name = project.title;
        if (!item.iconUrl && project.icon_url) entry.iconUrl = project.icon_url;
        const author = ownerOf.get(project.team);
        if (author) entry.author = author;
        const update = pending.find((u) => u.key === keyOf(item));
        if (update) Object.assign(update, { name: entry.name ?? update.name, iconUrl: update.iconUrl ?? entry.iconUrl ?? null });
    }

    pending.sort((a, b) => a.name.localeCompare(b.name));
    lastCheck.set(name, new Map(pending.map((update) => [update.key, update])));
    lastItems.set(name, new Map(items.map((item) => [keyOf(item), { ...item, displayName: status[keyOf(item)]?.name ?? item.name, iconUrl: item.iconUrl ?? status[keyOf(item)]?.iconUrl ?? null }])));

    return {
        checked: items.length,
        identified: items.filter((item) => item.projectId).length,
        updates: pending.map(({ file, ...update }) => ({ ...update, newFileName: file.fileName })),
        status,
    };
}

const STAGING = "update-staging";
const BACKUPS = "update-backups";
const KEEP_BATCHES = 5;

/*
 * Puts in new builds, safely: each is downloaded aside first, then the mods they would
 * leave together are checked, and only builds that fit go in. The files they replace are
 * kept as one batch, which undoLastUpdate puts back.
 *
 * mode: "skip" leaves out builds that wouldn't fit (Update All); "ask" changes nothing
 * if any wouldn't, and says why (a version picked by hand); "force" puts them in anyway.
 * requireAll: a build that can't be downloaded stops everything, before anything changes.
 * beforeSwap: runs once the builds are downloaded and checked, before any file changes
 *   (a loader update installs the loader here); what it returns goes first in the batch.
 * batchId: adds these changes to that batch, so one Undo puts back both.
 *
 * -> { updated, skipped: [{ name, from, to, reasons }], failed, batch } or, for "ask",
 *    { needsConfirm: true, problems: [text] }
 */
async function runUpdates(instance, folder, updates, { mode = "skip", requireAll = false, beforeSwap, batchId: intoBatch, onProgress } = {}) {
    const loader = String(instance.loader || "vanilla").toLowerCase();
    const staging = path.join(folder, STAGING, String(Date.now()));
    const updated = [];
    const skipped = [];
    const failed = [];
    fs.mkdirSync(staging, { recursive: true });

    try {
        // 1. Download each build aside.
        let candidates = [];
        for (const [index, update] of updates.entries()) {
            onProgress?.({ stage: "updates", percent: Math.round((index / updates.length) * 60), detail: `Downloading ${update.name} (${index + 1} of ${updates.length})` });
            const newName = path.basename(update.file.fileName);
            const file = path.join(staging, newName);
            try {
                await downloadFile(update.file.url, file, { sha1: update.file.sha1 });
                candidates.push({ update, newName, file, info: update.type === "mod" ? await modInfo(file) : null });
            } catch (err) {
                failed.push({ name: update.name, reason: err.message });
            }
        }
        if (requireAll && failed.length) {
            throw new Error(`Couldn't download ${failed.map((f) => `${f.name} (${f.reason})`).join(", ")}, so nothing was changed.`);
        }

        // 2. Check the mods they'd leave together; leave out builds that wouldn't fit.
        if (mode !== "force" && candidates.some((c) => c.info)) {
            onProgress?.({ stage: "updates", percent: 65, detail: "Checking the mods work together" });
            const current = await modsIn(instanceMods.modsDir(folder));
            const javaMajor = requiredJava(folder, instance).majorVersion;
            for (let round = 0; round < 6; round++) {
                const replaced = new Set(candidates.map((c) => c.update.fileName));
                const mods = [
                    ...current.filter((mod) => !replaced.has(mod.fileName.replace(/\.disabled$/, ""))),
                    ...candidates.filter((c) => c.info).map((c) => ({ ...c.info, fileName: c.newName, name: c.update.name, enabled: c.update.enabled })),
                ];
                const problems = problemsWith({
                    mods,
                    changed: new Set(candidates.filter((c) => c.info).map((c) => c.newName)),
                    mcVersion: instance.version,
                    loader,
                    loaderVersion: instance.loaderVersion,
                    javaMajor,
                });

                problems.push(...(await missingDependencies(
                    candidates.filter((c) => c.info).map((c) => ({ ...c.info, fileName: c.newName, name: c.update.name, enabled: c.update.enabled })),
                    mods,
                    instance
                )));
                // Add-ons that change the code of a mod being updated (or are updated themselves).
                problems.push(...(await addonCheck(folder, current, candidates.filter((c) => c.info).map((c) => ({
                    fileName: c.newName,
                    file: c.file,
                    name: c.update.name,
                    version: c.update.latest,
                    enabled: c.update.enabled,
                    replacesFileName: c.update.fileName,
                })))));
                if (!problems.length) break;
                if (mode === "ask") return { needsConfirm: true, problems: problems.map((p) => `${p.name} ${p.text}.`) };

                const bad = new Set(problems.map((p) => p.fileName));
                const leaving = candidates.filter((c) => bad.has(c.newName));
                if (!leaving.length) break;
                for (const c of leaving) {
                    skipped.push({ name: c.update.name, from: c.update.current, to: c.update.latest, reasons: problems.filter((p) => p.fileName === c.newName).map((p) => p.text) });
                }
                candidates = candidates.filter((c) => !bad.has(c.newName));
            }
        }

        // 3. Swap them in, keeping each old file.
        const batchId = intoBatch ?? String(Date.now());
        const batchDir = path.join(folder, BACKUPS, batchId);
        const changes = [];
        if (beforeSwap) {
            const change = await beforeSwap();
            if (change) changes.push(change);
        }
        for (const [index, { update, newName, file }] of candidates.entries()) {
            onProgress?.({ stage: "updates", percent: 70 + Math.round((index / Math.max(candidates.length, 1)) * 30), detail: `Installing ${update.name}` });
            try {
                const item = { type: update.type, fileName: update.fileName };
                const oldPath = instanceMods.resolveItem(folder, item) + (update.enabled ? "" : ".disabled");
                fs.mkdirSync(batchDir, { recursive: true });
                fs.copyFileSync(oldPath, path.join(batchDir, path.basename(oldPath)));
                const oldEntry = instanceMods.manifestEntry(folder, item);

                const installed = await instanceMods.installContent(folder, {
                    type: update.type,
                    localFile: file,
                    fileName: newName,
                    name: update.name,
                    source: update.source,
                    projectId: update.projectId,
                    versionNumber: update.latest,
                    iconUrl: update.iconUrl,
                });
                if (installed.fileName !== update.fileName) instanceMods.deleteItem(folder, item);
                if (!update.enabled) instanceMods.setEnabled(folder, { type: update.type, fileName: installed.fileName }, false);

                changes.push({ type: update.type, name: update.name, from: update.current, to: update.latest, oldFile: update.fileName, oldOnDisk: path.basename(oldPath), newFile: installed.fileName, enabled: update.enabled, oldEntry });
                updated.push({ name: update.name, from: update.current, to: update.latest, type: update.type, fileName: installed.fileName });
            } catch (err) {
                failed.push({ name: update.name, reason: err.message });
            }
        }

        const batchFile = path.join(batchDir, "batch.json");
        let batch = null;
        if (changes.length) {
            const earlier = intoBatch && fs.existsSync(batchFile) ? JSON.parse(fs.readFileSync(batchFile, "utf8")).changes : [];
            fs.mkdirSync(batchDir, { recursive: true });
            fs.writeFileSync(batchFile, JSON.stringify({ id: batchId, time: new Date().toISOString(), changes: [...earlier, ...changes] }, null, 2));
            pruneBatches(folder);
            batch = { id: batchId, count: earlier.length + changes.length };
        } else if (intoBatch && fs.existsSync(batchFile)) {
            batch = { id: batchId, count: JSON.parse(fs.readFileSync(batchFile, "utf8")).changes.length };
        }
        onProgress?.({ stage: "done", percent: 100, detail: "Updates installed" });
        return { updated, skipped, failed, batch };
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
        try {
            fs.rmdirSync(path.dirname(staging)); // Only goes if nothing else is downloading.
        } catch {
            // Not empty.
        }
    }
}

function batchDirs(folder) {
    const root = path.join(folder, BACKUPS);
    try {
        return fs.readdirSync(root).filter((name) => /^\d+$/.test(name)).sort((a, b) => Number(b) - Number(a)).map((name) => path.join(root, name));
    } catch {
        return [];
    }
}

function pruneBatches(folder) {
    for (const dir of batchDirs(folder).slice(KEEP_BATCHES)) fs.rmSync(dir, { recursive: true, force: true });
}

/* The latest change that can be undone: { id, time, names }, or null. */
function lastUpdate(folder) {
    for (const dir of batchDirs(folder)) {
        try {
            const batch = JSON.parse(fs.readFileSync(path.join(dir, "batch.json"), "utf8"));
            return { id: batch.id, time: batch.time, names: batch.changes.map((change) => `${change.name} ${change.to}`) };
        } catch {
            // An unfinished batch; look at the one before.
        }
    }
    return null;
}

/*
 * Puts back the files the latest change replaced. A loader the change updated comes back
 * as loader, for the instance to go back to: -> { restored: [{ name, version }], loader }
 */
function undoLastUpdate(folder) {
    const dir = batchDirs(folder).find((candidate) => fs.existsSync(path.join(candidate, "batch.json")));
    if (!dir) throw new Error("There's no update to undo.");
    const batch = JSON.parse(fs.readFileSync(path.join(dir, "batch.json"), "utf8"));

    const restored = [];
    let loader = null;
    for (const change of [...batch.changes].reverse()) {
        if (change.type === "loader") {
            loader = { loaderVersion: change.from, versionId: change.oldVersionId };
            restored.push({ name: change.name, version: change.from });
            continue;
        }
        try {
            instanceMods.deleteItem(folder, { type: change.type, fileName: change.newFile });
        } catch {
            // Already gone.
        }
        const target = instanceMods.resolveItem(folder, { type: change.type, fileName: change.oldFile }) + (change.enabled ? "" : ".disabled");
        fs.copyFileSync(path.join(dir, change.oldOnDisk), target);
        instanceMods.setManifestEntry(folder, { type: change.type, fileName: change.oldFile }, change.oldEntry);
        restored.push({ name: change.name, version: change.from });
    }
    fs.rmSync(dir, { recursive: true, force: true });
    try {
        fs.rmdirSync(path.dirname(dir)); // Only goes once nothing is left to undo.
    } catch {
        // Older changes are still kept.
    }
    return { restored, loader };
}

/* Installs the chosen updates from the latest check, leaving out any that wouldn't fit. */
async function applyUpdates(name, instance, folder, keys, { onProgress } = {}) {
    const checked = lastCheck.get(name);
    if (!checked) throw new Error("Check for updates first.");
    const chosen = keys.map((key) => checked.get(key)).filter(Boolean);
    const result = await runUpdates(instance, folder, chosen, { mode: "skip", onProgress });
    for (const update of chosen) checked.delete(update.key);
    return result;
}

const CHANNELS = { 1: "release", 2: "beta", 3: "alpha" };

/*
 * Every version of one item that works on this instance, newest first, for choosing one.
 * -> { name, versions: [{ id, number, title, channel, published, fileName, size, installed }] }
 * Changelogs come one at a time, from versionChangelog, when someone opens one.
 */
async function listVersions(name, instance, key) {
    const item = lastItems.get(name)?.get(key);
    if (!item?.projectId) throw new Error("This one isn't from Modrinth or CurseForge, so its other versions aren't known.");
    const loader = String(instance.loader || "vanilla").toLowerCase();

    if (item.source === "modrinth") {
        const url = new URL(`https://api.modrinth.com/v2/project/${item.projectId}/version`);
        url.searchParams.set("game_versions", JSON.stringify([instance.version]));
        url.searchParams.set("loaders", JSON.stringify(loadersFor(item.type, loader)));
        const versions = (await fetchJson(url.toString())) ?? [];
        return {
            name: item.displayName,
            versions: versions
                .map((v) => {
                    const file = v.files.find((f) => f.primary) ?? v.files[0];
                    return {
                        id: v.id,
                        number: v.version_number,
                        title: v.name,
                        channel: v.version_type,
                        published: v.date_published,
                        fileName: file?.filename ?? "",
                        size: file?.size ?? 0,
                        installed: v.files.some((f) => f.hashes?.sha1 === item.sha1),
                    };
                })
                .sort((a, b) => Date.parse(b.published) - Date.parse(a.published)),
        };
    }

    const params = new URLSearchParams({ gameVersion: instance.version, pageSize: "50" });
    if (usesLoader(item.type) && CF_LOADER_TYPES[loader] !== undefined) params.set("modLoaderType", String(CF_LOADER_TYPES[loader]));
    const files = ((await curseforgeJson(`/mods/${item.projectId}/files?${params}`)).data ?? []).filter((f) => !f.isServerPack && f.isAvailable !== false);
    return {
        name: item.displayName,
        versions: files
            .map((f) => ({
                id: String(f.id),
                number: f.displayName,
                title: f.displayName,
                channel: CHANNELS[f.releaseType] ?? "release",
                published: f.fileDate,
                fileName: f.fileName,
                size: f.fileLength ?? 0,
                installed: (f.hashes ?? []).some((h) => h.algo === 1 && h.value === item.sha1) || f.fileName === item.fileName,
            }))
            .sort((a, b) => Date.parse(b.published) - Date.parse(a.published)),
    };
}

/* One version's changelog as plain text, or "" if it has none. */
async function versionChangelog(name, key, versionId) {
    const item = lastItems.get(name)?.get(key);
    if (!item?.projectId) return "";
    if (item.source === "modrinth") {
        const version = await fetchJson(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`);
        return String(version?.changelog ?? "").slice(0, 20000);
    }
    // CurseForge gives HTML; the page shows text.
    const html = String((await curseforgeJson(`/mods/${item.projectId}/files/${encodeURIComponent(versionId)}/changelog`)).data ?? "");
    return html
        .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, "\n")
        .replace(/<li[^>]*>/gi, "- ")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, 20000);
}

/*
 * Installs one chosen version of an item, newer or older. If it wouldn't work with the
 * rest of the instance, nothing changes unless force is set; the reasons come back instead.
 */
async function installVersion(name, instance, folder, key, versionId, { force = false, onProgress } = {}) {
    const item = lastItems.get(name)?.get(key);
    if (!item?.projectId) throw new Error("Check for updates first.");

    const update = await updateTo(item, versionId);
    if (update.file.sha1 && update.file.sha1 === item.sha1) return { updated: [], skipped: [], failed: [], batch: null };
    return runUpdates(instance, folder, [update], { mode: force ? "force" : "ask", onProgress });
}

/* An update of a checked item to one version of it, in the shape runUpdates takes. */
async function updateTo(item, versionId) {
    let file;
    let number;
    if (item.source === "modrinth") {
        const version = await fetchJson(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`);
        if (version.project_id !== item.projectId) throw new Error("That version belongs to a different project.");
        const primary = version.files.find((f) => f.primary) ?? version.files[0];
        file = { url: primary.url, fileName: primary.filename, sha1: primary.hashes?.sha1 ?? null };
        number = version.version_number;
    } else {
        const found = (await curseforgeJson(`/mods/${item.projectId}/files/${encodeURIComponent(versionId)}`)).data;
        if (!found?.downloadUrl) throw new Error("This author has disabled third-party downloads. Get it from the CurseForge site instead.");
        file = { url: found.downloadUrl, fileName: found.fileName, sha1: (found.hashes ?? []).find((h) => h.algo === 1)?.value ?? null };
        number = found.displayName;
    }
    return {
        key: keyOf(item),
        type: item.type,
        fileName: item.fileName,
        enabled: item.enabled,
        name: item.displayName,
        iconUrl: item.iconUrl,
        source: item.source,
        projectId: item.projectId,
        current: item.versionNumber ?? item.fileName,
        latest: number,
        file,
    };
}

/*
 * Mods the new files need that aren't installed and can't be found, so wouldn't be
 * fetched afterwards and the game wouldn't start. newMods are modInfo with fileName, name
 * and enabled; mods everything there would be. -> [{ fileName, name, text }]
 */
async function missingDependencies(newMods, mods, instance) {
    const provided = new Set(mods.filter((mod) => mod.enabled).flatMap((mod) => [...mod.ids, ...(mod.provides ?? [])]).map((id) => id.toLowerCase()));
    const problems = [];
    for (const mod of newMods.filter((m) => m.enabled)) {
        for (const id of mod.depends ?? []) {
            const key = id.toLowerCase();
            if (BUILT_IN.has(key) || provided.has(key)) continue;
            if (!(await findProject(key, instance))) {
                problems.push({ fileName: mod.fileName, name: mod.name, text: `needs ${id}, which isn't installed and can't be found on Modrinth for this version` });
            }
        }
    }
    return problems;
}

/*
 * Problems add-ons would have once new files are in: current is what's installed (modsIn),
 * incoming the new files ({ fileName, file, name, version, enabled, replacesFileName }).
 * -> [{ fileName, name, text }], each on a new file. See mixinCheck.cjs.
 */
async function addonCheck(folder, current, incoming) {
    const dir = instanceMods.modsDir(folder);
    const replaced = new Set(incoming.map((mod) => mod.replacesFileName));
    return addonProblems([
        ...current
            .filter((mod) => !replaced.has(mod.fileName.replace(/\.disabled$/, "")))
            .map((mod) => ({ fileName: mod.fileName, file: path.join(dir, mod.fileName), name: mod.name, version: mod.version, enabled: mod.enabled })),
        ...incoming.map((mod) => ({
            ...mod,
            changed: true,
            replaces: mod.replacesFileName ? path.join(dir, mod.replacesFileName + (mod.enabled ? "" : ".disabled")) : null,
        })),
    ]).catch(() => []);
}

/* What the latest check saw for an instance: each file ("mod/sodium.jar" -> item), and the updates it found. */
const checkedItems = (name) => lastItems.get(name) ?? null;
const pendingUpdates = (name) => lastCheck.get(name) ?? null;

module.exports = {
    identify,
    checkUpdates,
    applyUpdates,
    listVersions,
    versionChangelog,
    installVersion,
    undoLastUpdate,
    lastUpdate,
    runUpdates,
    updateTo,
    missingDependencies,
    addonCheck,
    checkedItems,
    pendingUpdates,
};
