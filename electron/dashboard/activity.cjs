const fs = require("fs");
const path = require("path");

const store = require("./store.cjs");

/*
 * What happened recently, newest first, from records that already exist:
 *   played            sessions (logs and the launcher's own records, see playtime.cjs)
 *   instance-created  instance.json "created"
 *   mods-installed    unity-mods.json "installedAt", and the times of mod files it doesn't list
 *   mods-updated      update-backups/<time>/batch.json (one per round of updates)
 *   loader-updated    the loader change inside such a batch
 *   crash             crash-reports/crash-*.txt
 *   error             an instance.json "error" (setup that didn't finish), or a recorded
 *                     exit with an error code and no crash report
 *   launcher-updated  the launcher's version differing from the one it last saw
 * Only reads instances; writes nothing but its own launcher.json.
 */

const LAUNCHER_FILE = "launcher.json";
const GROUP_GAP_MS = 5 * 60_000;
const CRASHES_PER_INSTANCE = 20;
const MAX_JSON_BYTES = 16 * 1024 * 1024;

const TYPE_WORDS = {
    mod: ["mod", "mods"],
    resourcepack: ["resource pack", "resource packs"],
    shader: ["shader pack", "shader packs"],
    datapack: ["data pack", "data packs"],
};

const iso = (time) => new Date(time).toISOString();

function duration(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${Math.max(1, minutes)} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/* "3 mods and 1 resource pack" from { mod: 3, resourcepack: 1 }. */
function countWords(counts) {
    const parts = Object.entries(counts).map(([type, n]) => {
        const [one, many] = TYPE_WORDS[type] ?? ["item", "items"];
        return `${n} ${n === 1 ? one : many}`;
    });
    return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "";
}

/* "Sodium, Lithium, Iris and 4 more". */
function nameList(names) {
    const unique = [...new Set(names.filter(Boolean))];
    if (unique.length <= 3) return unique.join(", ");
    return `${unique.slice(0, 3).join(", ")} and ${unique.length - 3} more`;
}

async function readJsonFile(file) {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size > MAX_JSON_BYTES) return null;
    return JSON.parse(await fs.promises.readFile(file, "utf8"));
}

/* ---------------- launcher version ---------------- */

/*
 * Remembers the launcher's version; when it differs from last time, that's an update.
 * The very first run only remembers it: nothing was updated.
 */
function noteLauncherVersion(version, now = Date.now()) {
    if (typeof version !== "string" || !version) return;
    const saved = store.readJson(LAUNCHER_FILE, {});
    const history = Array.isArray(saved.history) ? saved.history.slice(-50) : [];
    if (saved.lastSeen === version) return;
    if (typeof saved.lastSeen === "string") history.push({ at: now, from: saved.lastSeen, to: version });
    try {
        store.writeJson(LAUNCHER_FILE, { lastSeen: version, history });
    } catch (err) {
        console.warn("Couldn't save the launcher version:", err.message);
    }
}

function launcherItems() {
    const saved = store.readJson(LAUNCHER_FILE, {});
    const history = Array.isArray(saved.history) ? saved.history : [];
    return history
        .filter((h) => Number.isFinite(h?.at) && typeof h.to === "string")
        .map((h) => ({ at: iso(h.at), kind: "launcher-updated", title: "Launcher updated", detail: `Version ${h.from} to ${h.to}` }));
}

/* ---------------- one instance ---------------- */

async function batches(folder) {
    const root = path.join(folder, "update-backups");
    let names;
    try {
        names = await fs.promises.readdir(root);
    } catch {
        return [];
    }
    const found = [];
    for (const name of names) {
        try {
            const batch = await readJsonFile(path.join(root, name, "batch.json"));
            const time = Date.parse(batch?.time);
            if (Number.isFinite(time) && Array.isArray(batch.changes)) found.push({ time, changes: batch.changes.filter((c) => c && typeof c === "object") });
        } catch {
            // Not a batch.
        }
    }
    return found;
}

/* Things added to the instance: [{ time, type, name }], from its manifest and its mods folder. */
async function additions(instance, updatedFiles) {
    const added = [];
    const manifest = await readJsonFile(path.join(instance.folder, "unity-mods.json")).catch(() => null) ?? {};

    const listed = new Set();
    for (const [key, entry] of Object.entries(manifest)) {
        if (!entry || typeof entry !== "object") continue;
        // Mods are listed by file name, everything else as type/world/file.
        const parts = key.split("/");
        const type = parts.length >= 3 ? parts[0] : "mod";
        const fileName = parts[parts.length - 1];
        if (type === "mod") listed.add(fileName);
        // A file an update put in place was an update, not something new.
        if (updatedFiles.has(`${type}|${fileName}`)) continue;
        const time = Date.parse(entry.installedAt);
        if (Number.isFinite(time)) added.push({ time, type, name: String(entry.name || fileName) });
    }

    // Mod files the manifest doesn't know (put there by hand, by an import, by another app).
    const mods = path.join(instance.gameDir, "mods");
    const files = await fs.promises.readdir(mods).catch(() => []);
    for (const file of files) {
        if (!/\.jar(\.disabled)?$/i.test(file)) continue;
        const plain = file.replace(/\.disabled$/i, "");
        if (listed.has(plain) || updatedFiles.has(`mod|${plain}`)) continue;
        try {
            const stat = await fs.promises.stat(path.join(mods, file));
            const time = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;
            added.push({ time, type: "mod", name: plain.replace(/\.jar$/i, "") });
        } catch {
            // Gone already.
        }
    }
    return added;
}

/* Additions close together in time as one entry each. */
function groupAdditions(name, added) {
    const items = [];
    added.sort((a, b) => a.time - b.time);
    let group = [];
    const flush = () => {
        if (!group.length) return;
        const counts = {};
        for (const a of group) counts[a.type] = (counts[a.type] ?? 0) + 1;
        items.push({
            at: iso(group[group.length - 1].time),
            kind: "mods-installed",
            instance: name,
            title: `Added ${countWords(counts)}`,
            detail: nameList(group.map((a) => a.name)),
        });
        group = [];
    };
    for (const a of added) {
        if (group.length && a.time - group[group.length - 1].time > GROUP_GAP_MS) flush();
        group.push(a);
    }
    flush();
    return items;
}

const CRASH_NAME = /^crash-(\d{4})-(\d{2})-(\d{2})_(\d{2})\.(\d{2})\.(\d{2})/;

async function crashes(instance) {
    const dir = path.join(instance.gameDir, "crash-reports");
    let names;
    try {
        names = (await fs.promises.readdir(dir)).filter((n) => /^crash-.*\.txt$/i.test(n));
    } catch {
        return [];
    }

    const found = [];
    for (const name of names) {
        const m = CRASH_NAME.exec(name);
        let time = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : NaN;
        if (!Number.isFinite(time)) {
            try {
                time = (await fs.promises.stat(path.join(dir, name))).mtimeMs;
            } catch {
                continue;
            }
        }
        found.push({ time, name });
    }
    found.sort((a, b) => b.time - a.time);

    const recent = found.slice(0, CRASHES_PER_INSTANCE);
    for (const crash of recent) crash.description = await crashDescription(path.join(dir, crash.name));
    return recent;
}

/* The report's own one-line "Description:", if it has one near the top. */
async function crashDescription(file) {
    let handle;
    try {
        handle = await fs.promises.open(file, "r");
        const buffer = Buffer.alloc(8192);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const m = /^Description:\s*(.+)$/m.exec(buffer.subarray(0, bytesRead).toString("utf8"));
        return m ? m[1].trim().slice(0, 200) : null;
    } catch {
        return null;
    } finally {
        await handle?.close();
    }
}

async function instanceItems({ instance, merged, recorded }) {
    const name = instance.name;
    const items = [];

    for (const s of merged) {
        items.push({ at: iso(s.end), kind: "played", instance: name, title: `Played ${name}`, detail: duration((s.end - s.start) / 1000) });
    }

    const created = Date.parse(instance.json.created);
    if (Number.isFinite(created)) {
        const loader = String(instance.json.loader || "vanilla").toLowerCase();
        const version = instance.json.version ? `Minecraft ${instance.json.version}` : "Minecraft";
        items.push({
            at: iso(created),
            kind: "instance-created",
            instance: name,
            title: `Created ${name}`,
            detail: loader === "vanilla" ? version : `${version} with ${loader.charAt(0).toUpperCase()}${loader.slice(1)}`,
        });
    }

    if (typeof instance.json.error === "string" && instance.json.error.trim()) {
        items.push({
            at: iso(instance.jsonModifiedMs),
            kind: "error",
            instance: name,
            title: `${name} didn't finish setting up`,
            detail: instance.json.error.trim().slice(0, 200),
        });
    }

    const found = await batches(instance.folder);
    const updatedFiles = new Set();
    for (const batch of found) {
        const loaders = batch.changes.filter((c) => c.type === "loader");
        const others = batch.changes.filter((c) => c.type !== "loader");
        for (const c of others) if (c.newFile) updatedFiles.add(`${c.type}|${c.newFile}`);
        for (const c of loaders) {
            items.push({
                at: iso(batch.time),
                kind: "loader-updated",
                instance: name,
                title: `${c.name || "Loader"} updated`,
                ...(c.from && c.to ? { detail: `${c.from} to ${c.to}` } : {}),
            });
        }
        if (others.length) {
            const counts = {};
            for (const c of others) counts[c.type] = (counts[c.type] ?? 0) + 1;
            items.push({
                at: iso(batch.time),
                kind: "mods-updated",
                instance: name,
                title: `Updated ${countWords(counts)}`,
                detail: nameList(others.map((c) => c.name)),
            });
        }
    }

    items.push(...groupAdditions(name, await additions(instance, updatedFiles)));

    const crashList = await crashes(instance);
    for (const crash of crashList) {
        items.push({ at: iso(crash.time), kind: "crash", instance: name, title: `${name} crashed`, detail: crash.description ?? crash.name });
    }

    // A recorded exit with an error code that left no crash report.
    for (const s of recorded) {
        if (s.end === null || s.code === null || s.code === 0) continue;
        const reported = crashList.some((c) => c.time >= s.start - 60_000 && c.time <= s.end + 120_000);
        if (reported) continue;
        items.push({ at: iso(s.end), kind: "error", instance: name, title: `${name} closed with an error`, detail: `Exit code ${s.code}` });
    }

    return items;
}

/* details: from stats.collect(). -> up to `limit` items, newest first. */
async function buildActivity(details, limit = 20) {
    const items = [...launcherItems()];
    for (const detail of details) {
        try {
            items.push(...(await instanceItems(detail)));
        } catch (err) {
            console.warn(`Couldn't read the activity of ${detail.instance.name}:`, err.message);
        }
    }
    return items
        .filter((item) => Number.isFinite(Date.parse(item.at)))
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, limit);
}

module.exports = { buildActivity, noteLauncherVersion, _internal: { duration, countWords, nameList } };
