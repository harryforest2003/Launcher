const fs = require("fs");
const path = require("path");
const { getGame } = require("./registry.cjs");
const { locate } = require("./detect.cjs");
const { dataDir } = require("./storage.cjs");
const { unpack, listFiles, isArchive } = require("./archive.cjs");
const layouts = require("./layouts.cjs");
const plugins = require("./plugins.cjs");
const { hooksIntoGame } = require("./protect.cjs");

/*
 * A game's mods: the ones installed here, each with every file it put in place, and the
 * ones added by hand, found where the game loads mods from.
 *
 * Turning a mod off moves its files out of the game into the launcher's own folder, and
 * back when it's turned on; a Bethesda plugin is turned on and off in plugins.txt. When a
 * mod's file replaces one already there (the game's own, or another mod's), that one is
 * kept, and put back when the mod is turned off or removed.
 */

/* ---------------- where things are ---------------- */

const gameData = (gameId) => path.join(dataDir(), gameId);
const stateFile = (gameId) => path.join(dataDir(), `${gameId}.json`);
const parkedDir = (gameId, modId) => path.join(gameData(gameId), "parked", modId);
const backupDir = (gameId, modId) => path.join(gameData(gameId), "backups", modId);

function readState(gameId) {
    try {
        return JSON.parse(fs.readFileSync(stateFile(gameId), "utf8"));
    } catch {
        return { mods: [] };
    }
}

function writeState(gameId, state) {
    fs.writeFileSync(stateFile(gameId), JSON.stringify(state, null, 2));
}

/* The real folder for "game" or "docs". */
function baseDir(loc, base) {
    const dir = base === "docs" ? loc.docsDir : loc.gameDir;
    if (!dir) throw new Error(base === "docs" ? "The game's Documents folder wasn't found." : "The game's folder wasn't found. Choose it in this game's Settings.");
    return dir;
}

/* A path under a folder, refusing anything that would land outside it. */
function within(root, rel) {
    const target = path.resolve(root, rel);
    if (target !== path.resolve(root) && !target.startsWith(path.resolve(root) + path.sep)) throw new Error(`Refusing to touch a path outside ${root}.`);
    return target;
}

function move(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
        fs.renameSync(from, to);
    } catch (err) {
        if (err.code !== "EXDEV") throw err;
        fs.cpSync(from, to, { recursive: true });
        fs.rmSync(from, { recursive: true, force: true });
    }
}

/* Removes folders left empty, up to (not including) stop. */
function pruneEmpty(dir, stop) {
    let current = dir;
    while (current.startsWith(path.resolve(stop) + path.sep)) {
        try {
            if (fs.readdirSync(current).length) return;
            fs.rmdirSync(current);
        } catch {
            return;
        }
        current = path.dirname(current);
    }
}

const fileKey = (file) => `${file.base}:${file.to.toLowerCase()}`;

/* ---------------- installing ---------------- */

/* Unpacks archives inside the mod (Sims creators often zip their zips), one level down. */
async function unpackNested(dir) {
    const broken = [];
    for (const rel of listFiles(dir)) {
        if (!isArchive(rel)) continue;
        let inner;
        try {
            inner = await unpack(path.join(dir, rel));
        } catch {
            // A damaged archive inside doesn't stop the rest going in.
            broken.push(path.posix.basename(rel));
            continue;
        }
        try {
            const target = path.join(dir, rel.replace(/\.[^.]+$/, ""));
            fs.cpSync(inner.dir, target, { recursive: true });
            fs.rmSync(path.join(dir, rel), { force: true });
        } finally {
            inner.cleanup();
        }
    }
    return broken;
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/*
 * Installs a mod from a file: an archive, or a single mod file.
 * meta: { name, source: { provider, modId, fileId, url, version } }
 * -> { mod, placed: { [area]: count }, skipped, notes }, or throws when nothing could go in.
 */
async function install(gameId, filePath, meta = {}) {
    const game = getGame(gameId);
    const loc = locate(gameId);
    if (!fs.existsSync(filePath)) throw new Error(`${path.basename(filePath)} isn't there any more.`);
    const modName = meta.name || layouts.nameFromFile(filePath);

    const unpacked = await unpack(filePath);
    try {
        const broken = await unpackNested(unpacked.dir);
        const files = listFiles(unpacked.dir).filter((rel) => !broken.includes(path.posix.basename(rel)));
        const gameHas = (rel) => Boolean(loc.gameDir) && fs.existsSync(path.join(loc.gameDir, rel));
        const planned = layouts.plan(game, files, { modName, dir: unpacked.dir, gameHas });

        if (!planned.placements.length) {
            const why = planned.skipped.length ? planned.skipped.slice(0, 3).map((s) => `${path.posix.basename(s.file)} (${s.reason})`).join("; ") : "it had no files for this game";
            const error = new Error(`Nothing from ${modName} could be installed: ${why}.`);
            error.notes = planned.notes;
            throw error;
        }

        const state = readState(gameId);
        // A newer copy of the same mod replaces the old one.
        const previous = state.mods.find((mod) => (meta.source?.modId && mod.source?.provider === meta.source.provider && String(mod.source?.modId) === String(meta.source.modId)) || (!meta.source?.modId && mod.name === modName));
        if (previous) removeMod(gameId, previous.id);

        const fresh = readState(gameId);
        const owners = new Map();
        for (const mod of fresh.mods.filter((m) => m.enabled)) for (const file of mod.files) owners.set(fileKey(file), mod);

        const id = newId();
        const mod = {
            id,
            name: modName,
            source: meta.source ?? { provider: "file", fileName: path.basename(filePath) },
            files: [],
            replaced: [],
            plugins: [],
            enabled: true,
            installedAt: new Date().toISOString(),
            notes: planned.notes,
        };

        for (const placement of planned.placements) {
            const root = baseDir(loc, placement.base);
            const target = within(root, placement.to);
            const file = { base: placement.base, to: placement.to };
            if (fs.existsSync(target)) {
                // Kept so turning this mod off or removing it puts it back.
                const backup = within(path.join(backupDir(gameId, id), placement.base), placement.to);
                fs.mkdirSync(path.dirname(backup), { recursive: true });
                fs.copyFileSync(target, backup);
                mod.replaced.push({ ...file, owner: owners.get(fileKey(file))?.name ?? null });
            }
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(path.join(unpacked.dir, placement.from), target);
            mod.files.push(file);
        }

        if (game.layout === "bethesda" && planned.plugins.length) {
            mod.plugins = [...new Set(planned.plugins)];
            try {
                plugins.activate(game, loc, mod.plugins, true);
            } catch (err) {
                mod.notes = [...mod.notes, `Turn on ${mod.plugins.join(", ")} in your load order: ${err.message}`];
            }
        }

        fresh.mods.push(mod);
        writeState(gameId, fresh);

        const placed = {};
        for (const file of mod.files) {
            const area = areaOf(game, file);
            placed[area] = (placed[area] ?? 0) + 1;
        }
        const overwrote = [...new Set(mod.replaced.map((r) => r.owner).filter(Boolean))];
        const notes = [...mod.notes];
        if (broken.length) notes.push(`${broken.join(", ")} inside it couldn't be opened, so ${broken.length === 1 ? "it was" : "they were"} left out.`);
        if (overwrote.length) notes.unshift(`Replaced some files from ${overwrote.join(", ")}; they come back if you turn this off.`);
        if (previous) notes.unshift(`Replaced the copy installed before.`);
        return { mod: describe(game, mod), placed, skipped: planned.skipped.map((s) => ({ file: path.posix.basename(s.file), reason: s.reason })), notes };
    } finally {
        unpacked.cleanup();
    }
}

/* The folder a file shows as being in: "Mods", "scripts", "Data", "archive/pc/mod"... */
function areaOf(game, file) {
    const parts = file.to.split("/");
    if (game.layout === "sims4") return parts[0];
    if (game.layout === "bethesda") return parts[0] === "Data" ? (parts.length > 2 ? `Data/${parts[1]}` : "Data") : "game folder";
    if (game.layout === "gtav") return parts.length === 1 ? "game folder" : parts[0] === "mods" ? "mods (add-ons)" : parts[0];
    if (game.layout === "cyberpunk") {
        if (/^bin\/x64\/plugins\/cyber_engine_tweaks\/mods\//i.test(file.to)) return "Cyber Engine Tweaks mods";
        if (/^archive\/pc\/mod\//i.test(file.to)) return "archive/pc/mod";
        return parts.slice(0, 2).join("/");
    }
    return parts[0];
}

/* ---------------- turning on and off, removing ---------------- */

function setEnabled(gameId, modId, enabled) {
    const game = getGame(gameId);
    const loc = locate(gameId);
    const state = readState(gameId);
    const mod = state.mods.find((m) => m.id === modId);
    if (!mod) throw new Error("That mod isn't installed any more.");
    if (mod.enabled === enabled) return describe(game, mod);

    for (const file of mod.files) {
        const live = within(baseDir(loc, file.base), file.to);
        const parked = within(path.join(parkedDir(gameId, mod.id), file.base), file.to);
        if (enabled) {
            if (fs.existsSync(parked)) move(parked, live);
        } else if (fs.existsSync(live)) {
            move(live, parked);
            pruneEmpty(path.dirname(live), baseDir(loc, file.base));
        }
    }
    // What it replaced comes back while it's off.
    for (const file of mod.replaced) {
        const live = within(baseDir(loc, file.base), file.to);
        const backup = within(path.join(backupDir(gameId, mod.id), file.base), file.to);
        if (!enabled && fs.existsSync(backup)) {
            fs.mkdirSync(path.dirname(live), { recursive: true });
            fs.copyFileSync(backup, live);
        }
    }
    if (mod.plugins?.length) {
        try {
            plugins.activate(game, loc, mod.plugins, enabled);
        } catch {
            // No load order file: the plugin files themselves moved.
        }
    }
    mod.enabled = enabled;
    writeState(gameId, state);
    return describe(game, mod);
}

function removeMod(gameId, modId) {
    const game = getGame(gameId);
    const loc = locate(gameId);
    const state = readState(gameId);
    const mod = state.mods.find((m) => m.id === modId);
    if (!mod) throw new Error("That mod isn't installed any more.");

    if (mod.enabled) {
        for (const file of mod.files) {
            const root = baseDir(loc, file.base);
            const live = within(root, file.to);
            fs.rmSync(live, { force: true });
            pruneEmpty(path.dirname(live), root);
        }
        for (const file of mod.replaced) {
            const backup = within(path.join(backupDir(gameId, mod.id), file.base), file.to);
            if (fs.existsSync(backup)) {
                const live = within(baseDir(loc, file.base), file.to);
                fs.mkdirSync(path.dirname(live), { recursive: true });
                fs.copyFileSync(backup, live);
            }
        }
    }
    if (mod.plugins?.length) {
        try {
            plugins.remove(game, loc, mod.plugins);
        } catch {
            // No load order file.
        }
    }
    fs.rmSync(parkedDir(gameId, mod.id), { recursive: true, force: true });
    fs.rmSync(backupDir(gameId, mod.id), { recursive: true, force: true });
    state.mods = state.mods.filter((m) => m.id !== modId);
    writeState(gameId, state);
    return { removed: mod.name };
}

/* ---------------- mods added by hand ---------------- */

const OFFICIAL_CC = /^cc[a-z0-9]+\.(esl|esm)$/i;

/*
 * What's in the game's mod folders that the launcher didn't install: [{ base, rel, name,
 * kind: "file" | "folder" | "plugin", enabled }]. Turned-off ones are in the launcher's
 * own folder (or, for a Bethesda plugin, unticked in plugins.txt).
 */
function handAdded(game, loc, owned) {
    const found = [];
    const add = (base, rel, kind, enabled = true) => {
        if (!owned.has(`${base}:${rel.toLowerCase()}`) && ![...owned].some((key) => key.startsWith(`${base}:${rel.toLowerCase()}/`))) found.push({ base, rel, kind, enabled, name: path.posix.basename(rel) });
    };
    const entries = (dir) => {
        try {
            return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith("."));
        } catch {
            return [];
        }
    };
    const walk = (root, rel, depth, onFile) => {
        if (depth > 5) return;
        for (const entry of entries(path.join(root, rel))) {
            const child = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(root, child, depth + 1, onFile);
            else onFile(child);
        }
    };

    if (game.layout === "sims4" && loc.docsDir) {
        walk(loc.docsDir, "Mods", 0, (rel) => /\.(package|ts4script)$/i.test(rel) && add("docs", rel, "file"));
    }
    if (!loc.gameDir) return found;
    const root = loc.gameDir;
    if (game.layout === "gtav") {
        for (const entry of entries(root)) if (entry.isFile() && /\.asi$/i.test(entry.name)) add("game", entry.name, "file");
        for (const entry of entries(path.join(root, "scripts"))) if (entry.isFile() && /\.(dll|cs|vb)$/i.test(entry.name)) add("game", `scripts/${entry.name}`, "file");
    }
    if (game.layout === "bethesda") {
        const official = new Set(game.bethesda.official);
        let active = null;
        try {
            active = plugins.read(game, loc);
        } catch {
            // No load order file.
        }
        for (const entry of entries(path.join(root, "Data"))) {
            if (!entry.isFile() || !/\.(esp|esm|esl)$/i.test(entry.name)) continue;
            if (official.has(entry.name.toLowerCase()) || OFFICIAL_CC.test(entry.name)) continue;
            const on = active ? active.some((line) => line.active && line.name.toLowerCase() === entry.name.toLowerCase()) : true;
            add("game", `Data/${entry.name}`, "plugin", on);
        }
    }
    if (game.layout === "cyberpunk") {
        for (const entry of entries(path.join(root, "archive", "pc", "mod"))) if (entry.isFile() && /\.(archive|xl)$/i.test(entry.name)) add("game", `archive/pc/mod/${entry.name}`, "file");
        for (const entry of entries(path.join(root, "bin", "x64", "plugins", "cyber_engine_tweaks", "mods"))) if (entry.isDirectory()) add("game", `bin/x64/plugins/cyber_engine_tweaks/mods/${entry.name}`, "folder");
        for (const entry of entries(path.join(root, "r6", "scripts"))) add("game", `r6/scripts/${entry.name}`, entry.isDirectory() ? "folder" : "file");
        for (const entry of entries(path.join(root, "red4ext", "plugins"))) if (entry.isDirectory()) add("game", `red4ext/plugins/${entry.name}`, "folder");
    }
    if (game.layout === "smapi") {
        for (const entry of entries(path.join(root, "Mods"))) if (entry.isDirectory()) add("game", `Mods/${entry.name}`, "folder");
    }
    return found;
}

/* Hand-added items turned off: the launcher's own folder holds them. */
function parkedHandAdded(gameId) {
    const found = [];
    const root = path.join(gameData(gameId), "parked", "_hand");
    for (const base of ["game", "docs"]) {
        const index = path.join(root, base);
        const walk = (rel, depth) => {
            let entries = [];
            try {
                entries = fs.readdirSync(path.join(index, rel), { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                const child = rel ? `${rel}/${entry.name}` : entry.name;
                const marker = path.join(index, child, ".unity-folder");
                if (entry.isDirectory() && fs.existsSync(marker)) found.push({ base, rel: child, kind: "folder", enabled: false, name: entry.name });
                else if (entry.isDirectory() && depth < 8) walk(child, depth + 1);
                else if (entry.isFile() && entry.name !== ".unity-folder") found.push({ base, rel: child, kind: "file", enabled: false, name: entry.name });
            }
        };
        walk("", 0);
    }
    return found;
}

function setHandAddedEnabled(gameId, key, enabled) {
    const game = getGame(gameId);
    const loc = locate(gameId);
    const [, base, ...relParts] = key.split(":");
    const rel = relParts.join(":");
    if (key.startsWith("p:")) {
        plugins.activate(game, loc, [path.posix.basename(rel)], enabled);
        return { key, enabled };
    }
    const live = within(baseDir(loc, base), rel);
    const parked = within(path.join(gameData(gameId), "parked", "_hand", base), rel);
    if (enabled) {
        if (fs.statSync(parked).isDirectory()) fs.rmSync(path.join(parked, ".unity-folder"), { force: true });
        move(parked, live);
    } else {
        const folder = fs.statSync(live).isDirectory();
        move(live, parked);
        if (folder) fs.writeFileSync(path.join(parked, ".unity-folder"), "");
        pruneEmpty(path.dirname(live), baseDir(loc, base));
    }
    return { key, enabled };
}

function removeHandAdded(gameId, key) {
    const loc = locate(gameId);
    const [kind, base, ...relParts] = key.split(":");
    const rel = relParts.join(":");
    for (const root of [baseDir(loc, base), path.join(gameData(gameId), "parked", "_hand", base)]) {
        const target = within(root, rel);
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    }
    if (kind === "p") {
        try {
            plugins.remove(getGame(gameId), loc, [path.posix.basename(rel)]);
        } catch {
            // No load order file.
        }
    }
    return { removed: path.posix.basename(rel) };
}

/* ---------------- the list ---------------- */

function describe(game, mod) {
    const areas = {};
    for (const file of mod.files) areas[areaOf(game, file)] = (areas[areaOf(game, file)] ?? 0) + 1;
    return {
        key: `m:${mod.id}`,
        managed: true,
        name: mod.name,
        enabled: mod.enabled,
        source: mod.source,
        installedAt: mod.installedAt,
        fileCount: mod.files.length,
        areas: Object.entries(areas).map(([area, count]) => ({ area, count })),
        plugins: mod.plugins ?? [],
        notes: mod.notes ?? [],
        hooks: hooksIntoGame(game.id, mod.files.map((file) => file.to)),
        since: mod.installedAt,
    };
}

/*
 * A hand-added item's files (a folder's, a few levels down) and when it last changed, to
 * tell whether it hooks into the game's code and may need updating after a game update.
 */
function handInfo(gameId, loc, item) {
    let full;
    try {
        full = within(item.enabled ? baseDir(loc, item.base) : path.join(gameData(gameId), "parked", "_hand", item.base), item.rel);
    } catch {
        return { hooks: false, since: null };
    }
    let info;
    try {
        info = fs.statSync(full);
    } catch {
        return { hooks: false, since: null };
    }
    const files = [item.rel];
    if (info.isDirectory()) {
        const walk = (dir, rel, depth) => {
            if (depth > 3 || files.length > 400) return;
            let entries = [];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                if (entry.isDirectory()) walk(path.join(dir, entry.name), `${rel}/${entry.name}`, depth + 1);
                else files.push(`${rel}/${entry.name}`);
            }
        };
        walk(full, item.rel, 0);
    }
    return { hooks: hooksIntoGame(gameId, files), since: new Date(info.mtimeMs).toISOString() };
}

/* Every mod for a game: the ones installed here, then the ones added by hand. */
function list(gameId) {
    const game = getGame(gameId);
    const loc = locate(gameId);
    const state = readState(gameId);
    const owned = new Set(state.mods.flatMap((mod) => mod.files.map((file) => `${file.base}:${file.to.toLowerCase()}`)));
    const hand = [...handAdded(game, loc, owned), ...parkedHandAdded(gameId).filter((item) => item.kind !== "plugin")];
    return {
        mods: [
            ...state.mods.map((mod) => describe(game, mod)),
            ...hand.map((item) => ({
                key: `${item.kind === "plugin" ? "p" : "h"}:${item.base}:${item.rel}`,
                managed: false,
                name: item.name,
                enabled: item.enabled,
                source: { provider: "hand" },
                where: path.posix.dirname(item.rel) === "." ? (item.base === "docs" ? "Documents" : "game folder") : path.posix.dirname(item.rel),
                kind: item.kind,
                fileCount: 1,
                areas: [],
                plugins: item.kind === "plugin" ? [item.name] : [],
                notes: [],
                ...handInfo(gameId, loc, item),
            })),
        ],
    };
}

const setModEnabled = (gameId, key, enabled) => (key.startsWith("m:") ? setEnabled(gameId, key.slice(2), enabled) : setHandAddedEnabled(gameId, key, enabled));
const deleteMod = (gameId, key) => (key.startsWith("m:") ? removeMod(gameId, key.slice(2)) : removeHandAdded(gameId, key));

module.exports = { install, list, setModEnabled, deleteMod, readState };
