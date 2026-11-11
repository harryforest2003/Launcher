const fs = require("fs");
const { getSecret } = require("../secrets.cjs");
const instanceMods = require("./instanceMods.cjs");
const modSearch = require("./modSearch.cjs");
const { fetchJson, pool, sha1 } = require("./net.cjs");

/*
 * Finds newer builds of an instance's mods, resource packs and shaders, for its Minecraft
 * version and loader, and installs them. Each file is known by what the launcher recorded
 * when it installed it, or else by its hash on Modrinth, which also finds files added by
 * hand or by other launchers.
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

    const LOADERS = { mod: [loader], resourcepack: ["minecraft"], shader: ["iris", "optifine", "canvas", "vanilla"] };
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

    // Names and icons for files the launcher didn't install, from their Modrinth page.
    const needInfo = onModrinth.filter((item) => item.source === "modrinth" && (looksNameless(item) || !item.iconUrl));
    const ids = [...new Set(needInfo.map((item) => item.projectId))];
    const projects = [];
    for (let i = 0; i < ids.length; i += 80) {
        const chunk = ids.slice(i, i + 80);
        projects.push(...(await fetchJson(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`).catch(() => []) ?? []));
    }
    for (const item of needInfo) {
        const project = projects.find((p) => p.id === item.projectId);
        if (!project) continue;
        const entry = status[keyOf(item)];
        if (looksNameless(item)) entry.name = project.title;
        if (!item.iconUrl && project.icon_url) entry.iconUrl = project.icon_url;
        const update = pending.find((u) => u.key === keyOf(item));
        if (update) Object.assign(update, { name: entry.name ?? update.name, iconUrl: update.iconUrl ?? entry.iconUrl ?? null });
    }

    pending.sort((a, b) => a.name.localeCompare(b.name));
    lastCheck.set(name, new Map(pending.map((update) => [update.key, update])));

    return {
        checked: items.length,
        identified: items.filter((item) => item.projectId).length,
        updates: pending.map(({ file, ...update }) => ({ ...update, newFileName: file.fileName })),
        status,
    };
}

/* Installs the chosen updates from the latest check: the new file in, the old one out. */
async function applyUpdates(name, folder, keys, { onProgress } = {}) {
    const checked = lastCheck.get(name);
    if (!checked) throw new Error("Check for updates first.");

    const chosen = keys.map((key) => checked.get(key)).filter(Boolean);
    const updated = [];
    const failed = [];

    for (const [index, update] of chosen.entries()) {
        onProgress?.({ stage: "updates", percent: Math.round((index / chosen.length) * 100), detail: `Updating ${update.name} (${index + 1} of ${chosen.length})` });
        try {
            const installed = await instanceMods.installContent(folder, {
                type: update.type,
                url: update.file.url,
                fileName: update.file.fileName,
                sha1: update.file.sha1,
                name: update.name,
                source: update.source,
                projectId: update.projectId,
                versionNumber: update.latest,
                iconUrl: update.iconUrl,
            });

            // The old file goes once the new one is in; a disabled mod stays disabled.
            if (installed.fileName !== update.fileName) {
                instanceMods.deleteItem(folder, { type: update.type, fileName: update.fileName });
            }
            if (!update.enabled) instanceMods.setEnabled(folder, { type: update.type, fileName: installed.fileName }, false);

            checked.delete(update.key);
            updated.push({ name: update.name, from: update.current, to: update.latest, type: update.type, fileName: installed.fileName });
        } catch (err) {
            failed.push({ name: update.name, reason: err.message });
        }
    }

    onProgress?.({ stage: "done", percent: 100, detail: "Updates installed" });
    return { updated, failed };
}

module.exports = { identify, checkUpdates, applyUpdates };
