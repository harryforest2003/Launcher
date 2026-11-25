const instanceMods = require("./instanceMods.cjs");
const instanceManager = require("../instanceManager.cjs");
const { fetchJson, pool } = require("./net.cjs");
const { curseforgeFiles, curseforgePost, contentFiles, chunks } = require("./packExports.cjs");
const shareCodes = require("../shareCodes.cjs");

/*
 * Share codes for Minecraft instances: the version, the loader, and each mod, resource
 * pack and shader by its Modrinth version or CurseForge file. Pasting one makes a new
 * instance and downloads the same files from those sites.
 */

const MODRINTH_ID = /^[A-Za-z0-9]{8}$/;

async function instanceShareCode(name) {
    const instance = instanceManager.getInstance(name);
    const folder = instanceManager.instanceFolder(name);
    const items = await contentFiles(folder);

    const modrinth = {};
    const curseforge = {};
    const missing = [];
    const rest = items.filter((item) => !MODRINTH_ID.test(item.modrinthVersion?.id ?? ""));
    for (const item of items) {
        if (rest.includes(item)) continue;
        (modrinth[item.type] ??= []).push(item.modrinthVersion.id);
    }

    const { found } = rest.length ? await curseforgeFiles(rest, instance.version) : { found: new Map() };
    for (const item of rest) {
        const match = found.get(item.sha1);
        if (match) (curseforge[item.type] ??= []).push(match.fileID);
        else missing.push(item.name || item.fileName);
    }

    const data = { k: "mc", n: instance.name, v: instance.version, l: String(instance.loader || "vanilla").toLowerCase() };
    if (instance.loaderVersion) data.lv = instance.loaderVersion;
    if (Object.keys(modrinth).length) data.r = modrinth;
    if (Object.keys(curseforge).length) data.c = curseforge;
    if (missing.length) data.x = missing;

    const count = (byType) => Object.values(byType).reduce((sum, ids) => sum + ids.length, 0);
    return { code: shareCodes.encode(data), linked: count(modrinth) + count(curseforge), missing };
}

/* The files a decoded code names, ready to download: [{ type, url, fileName, sha1, name, ... }]. */
async function resolveFiles(shared) {
    const files = [];
    const blocked = [];

    const modrinthIds = Object.entries(shared.modrinth).flatMap(([type, ids]) => ids.map((id) => ({ type, id })));
    const versions = new Map();
    for (const chunk of chunks(modrinthIds.map((entry) => entry.id), 80)) {
        const found = await fetchJson(`https://api.modrinth.com/v2/versions?ids=${encodeURIComponent(JSON.stringify(chunk))}`).catch(() => []);
        for (const version of found ?? []) versions.set(version.id, version);
    }
    const projects = new Map();
    const projectIds = [...new Set([...versions.values()].map((version) => version.project_id))];
    for (const chunk of chunks(projectIds, 80)) {
        const found = await fetchJson(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`).catch(() => []);
        for (const project of found ?? []) projects.set(project.id, project);
    }
    const notFound = [];
    for (const { type, id } of modrinthIds) {
        const version = versions.get(id);
        const file = version && (version.files.find((f) => f.primary) ?? version.files[0]);
        if (!file) {
            notFound.push(id);
            continue;
        }
        const project = projects.get(version.project_id);
        files.push({
            type,
            url: file.url,
            fileName: file.filename,
            sha1: file.hashes?.sha1,
            name: project?.title ?? version.name ?? file.filename,
            source: "modrinth",
            projectId: version.project_id,
            versionNumber: version.version_number,
            iconUrl: project?.icon_url ?? null,
        });
    }

    const cfIds = Object.entries(shared.curseforge).flatMap(([type, ids]) => ids.map((id) => ({ type, id })));
    const cfFiles = new Map();
    for (const chunk of chunks(cfIds.map((entry) => entry.id), 50)) {
        const found = await curseforgePost("/mods/files", { fileIds: chunk }).catch(() => []);
        for (const file of found ?? []) cfFiles.set(file.id, file);
    }
    const cfMods = new Map();
    for (const chunk of chunks([...new Set([...cfFiles.values()].map((file) => file.modId))], 50)) {
        const found = await curseforgePost("/mods", { modIds: chunk }).catch(() => []);
        for (const mod of found ?? []) cfMods.set(mod.id, mod);
    }
    for (const { type, id } of cfIds) {
        const file = cfFiles.get(id);
        if (!file) {
            notFound.push(String(id));
            continue;
        }
        const mod = cfMods.get(file.modId);
        const name = mod?.name ?? file.displayName ?? file.fileName;
        if (!file.downloadUrl) {
            blocked.push({ name, url: mod?.links?.websiteUrl ?? null });
            continue;
        }
        files.push({
            type,
            url: file.downloadUrl,
            fileName: file.fileName,
            sha1: file.hashes?.find((hash) => hash.algo === 1)?.value,
            name,
            source: "curseforge",
            projectId: String(file.modId),
            versionNumber: file.displayName ?? null,
            iconUrl: mod?.logo?.thumbnailUrl ?? null,
        });
    }
    return { files, blocked, notFound };
}

/* What a pasted code holds, before anything is made: for the import screen. */
function readInstanceCode(code) {
    const shared = shareCodes.decode(code);
    if (shared.kind !== "minecraft") throw new Error("That code is a mod list for another game. Paste it on that game's Mods page.");
    const count = (byType) => Object.values(byType).reduce((sum, ids) => sum + ids.length, 0);
    return {
        name: shared.name,
        version: shared.version,
        loader: shared.loader,
        loaderVersion: shared.loaderVersion,
        files: count(shared.modrinth) + count(shared.curseforge),
        missing: shared.missing,
    };
}

async function importInstanceCode(code, { name, onProgress = () => {} } = {}) {
    const shared = shareCodes.decode(code);
    if (shared.kind !== "minecraft") throw new Error("That code is a mod list for another game. Paste it on that game's Mods page.");

    const instanceName = instanceManager.uniqueName(name || shared.name);
    onProgress({ name: instanceName, stage: "share", percent: 0, detail: "Looking up the shared files" });
    const { files, blocked, notFound } = await resolveFiles(shared);

    const failed = [];
    let installed = 0;
    await instanceManager.createInstanceFrom(
        { name: instanceName, version: shared.version, loader: shared.loader, loaderVersion: shared.loaderVersion },
        async ({ folder }) => {
            await pool(
                files,
                async (file) => {
                    try {
                        await instanceMods.installContent(folder, file);
                        installed++;
                    } catch (err) {
                        failed.push({ name: file.name, error: err.message });
                    }
                },
                {
                    concurrency: 6,
                    onProgress: (done, total) =>
                        onProgress({ name: instanceName, stage: "share", percent: Math.round((done / total) * 100), detail: `Downloading ${done} of ${total}` }),
                }
            );
        },
        { onProgress: (progress) => onProgress({ name: instanceName, ...progress }) }
    );

    return {
        name: instanceName,
        installed,
        blocked,
        failed,
        missing: shared.missing,
        notFound: notFound.length,
        files: files.map(({ type, fileName, sha1 }) => ({ type, fileName, sha1: sha1 ?? null })),
    };
}

module.exports = { instanceShareCode, readInstanceCode, importInstanceCode, resolveFiles };
