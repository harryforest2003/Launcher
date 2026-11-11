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

/* Every file that could have a newer build, with its hash and where it came from. */
async function identify(folder) {
    const content = instanceMods.listContent(folder);
    const items = TYPES.flatMap((type) => (content[type] ?? []).filter((item) => item.kind === "file"));

    await pool(
        items,
        async (item) => {
            const file = instanceMods.resolveItem(folder, item) + (item.enabled ? "" : ".disabled");
            item.sha1 = await sha1(file);
        },
        { concurrency: 8 }
    );

    // Anything the launcher didn't record is looked up by its hash.
    const unknown = items.filter((item) => !(item.source === "modrinth" || item.source === "curseforge") || !item.projectId);
    if (unknown.length) {
        const found = await modrinthPost("/version_files", { hashes: unknown.map((item) => item.sha1).filter(Boolean), algorithm: "sha1" }).catch(() => ({}));
        for (const item of unknown) {
            const version = found[item.sha1];
            if (version) Object.assign(item, { source: "modrinth", projectId: version.project_id, versionNumber: item.versionNumber ?? version.version_number });
        }
    }

    return items;
}

// The latest check for each instance, which updates are then installed from, so the
// page never hands over a download address.
const lastCheck = new Map();

const keyOf = (item) => `${item.type}/${item.fileName}`;

async function checkUpdates(name, instance, folder) {
    const loader = String(instance.loader || "vanilla").toLowerCase();
    const items = await identify(folder);
    const known = items.filter((item) => item.projectId && (item.source === "modrinth" || item.source === "curseforge"));

    const updates = [];
    await pool(
        known,
        async (item) => {
            let latest;
            try {
                latest = await modSearch.resolveModFile(item.source, item.projectId, instance.version, loader, item.type);
            } catch {
                return; // No build for this version, or the site didn't answer.
            }
            const same = latest.sha1 ? latest.sha1 === item.sha1 : latest.fileName === item.fileName;
            if (same) return;
            updates.push({
                key: keyOf(item),
                type: item.type,
                fileName: item.fileName,
                enabled: item.enabled,
                name: item.name,
                iconUrl: item.iconUrl,
                source: item.source,
                projectId: item.projectId,
                current: item.versionNumber ?? item.fileName,
                latest: latest.versionNumber ?? latest.fileName,
                file: { url: latest.url, fileName: latest.fileName, sha1: latest.sha1 },
            });
        },
        { concurrency: 6 }
    );

    // Names and icons for files only known by their hash.
    const nameless = updates.filter((update) => update.source === "modrinth" && (update.name === update.fileName.replace(/\.(jar|zip)$/i, "") || !update.iconUrl));
    if (nameless.length) {
        const ids = [...new Set(nameless.map((update) => update.projectId))];
        const projects = await fetchJson(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`).catch(() => []);
        for (const update of nameless) {
            const project = projects.find((p) => p.id === update.projectId);
            if (project) Object.assign(update, { name: project.title, iconUrl: update.iconUrl ?? project.icon_url ?? null });
        }
    }

    updates.sort((a, b) => a.name.localeCompare(b.name));
    lastCheck.set(name, new Map(updates.map((update) => [update.key, update])));

    return {
        checked: items.length,
        identified: known.length,
        updates: updates.map(({ file, ...update }) => ({ ...update, newFileName: file.fileName })),
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
            updated.push({ name: update.name, from: update.current, to: update.latest });
        } catch (err) {
            failed.push({ name: update.name, reason: err.message });
        }
    }

    onProgress?.({ stage: "done", percent: 100, detail: "Updates installed" });
    return { updated, failed };
}

module.exports = { identify, checkUpdates, applyUpdates };
