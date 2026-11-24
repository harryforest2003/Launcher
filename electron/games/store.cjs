const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getGame } = require("./registry.cjs");
const { locate } = require("./detect.cjs");
const { dataDir } = require("./storage.cjs");
const { unpack, listFiles, isArchive, contents } = require("./archive.cjs");
const layouts = require("./layouts.cjs");
const plugins = require("./plugins.cjs");
const { hooksIntoGame } = require("./protect.cjs");
const sets = require("./sets.cjs");

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
// A mod's own copy of a file another mod's copy is in the game in place of.
const versionsDir = (gameId, modId) => path.join(gameData(gameId), "versions", modId);

function readState(gameId) {
    try {
        return JSON.parse(fs.readFileSync(stateFile(gameId), "utf8"));
    } catch {
        return { mods: [] };
    }
}

/* quiet: nothing about the mods themselves changed (what's remembered about them did). */
function writeState(gameId, state, { quiet = false } = {}) {
    // When the mods last changed, so the next play backs up the saves first.
    if (!quiet) state.changedAt = new Date().toISOString();
    fs.writeFileSync(stateFile(gameId), JSON.stringify(state, null, 2));
}

/* For changes outside the launcher's own list (mods added by hand, the load order). */
function touch(gameId) {
    writeState(gameId, readState(gameId));
}

/* The real folder for "game" or "docs". */
function baseDir(loc, base) {
    if (base === "mods") {
        if (!loc.modsDir) throw new Error("Choose where this game's mods go in its Settings (Mods folder).");
        fs.mkdirSync(loc.modsDir, { recursive: true });
        return loc.modsDir;
    }
    const dir = base === "docs" ? loc.docsDir : loc.gameDir;
    if (!dir) throw new Error(base === "docs" ? "The game's Documents folder wasn't found." : "The game's folder wasn't found. Choose it in this game's Settings.");
    return dir;
}

/*
 * For a game whose mods are .zip files themselves (Factorio, Hytale), whether this download
 * is one: true unless it holds that game's other mod files (an .scs inside a .zip).
 */
async function keptWhole(game, filePath) {
    const kind = path.extname(filePath).toLowerCase();
    const kinds = game.modExtensions ?? [];
    if (!game.generic || !kinds.includes(kind) || !isArchive(filePath)) return false;
    try {
        const inside = await contents(filePath);
        return !inside.some((file) => kinds.includes(path.extname(file).toLowerCase()) && path.extname(file).toLowerCase() !== kind);
    } catch {
        return true;
    }
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

/*
 * Removes folders left empty, up to (not including) stop. In the game's own folders the
 * top ones (The Sims 4's Mods, Skyrim's Data) are the game's and stay, even with no mods
 * left in them: only a mods folder's own top folders (one per mod) go.
 */
function pruneEmpty(dir, stop, base = "mods") {
    let current = dir;
    const top = path.resolve(stop);
    while (current.startsWith(top + path.sep)) {
        if (base !== "mods" && path.dirname(current) === top) return;
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

/*
 * Whose copy of each file is in the game: { "base:to": modId }. Kept from when files began
 * being shared; for mods installed before that, it's the last installed (as it was).
 */
function ownerMap(state) {
    if (!state.owner) {
        state.owner = {};
        const byAge = state.mods.filter((m) => m.enabled).sort((a, b) => String(a.installedAt).localeCompare(String(b.installedAt)));
        for (const mod of byAge) for (const file of mod.files) state.owner[fileKey(file)] = mod.id;
    }
    return state.owner;
}

/* Where a mod's own copy of a file is, when it isn't the one in the game: its kept copy, its turned-off copy, or (installed before copies were kept) the backup made when another overwrote it. */
function copyOf(gameId, state, mod, file) {
    const kept = within(path.join(versionsDir(gameId, mod.id), file.base), file.to);
    if (fs.existsSync(kept)) return kept;
    const parked = within(path.join(parkedDir(gameId, mod.id), file.base), file.to);
    if (fs.existsSync(parked)) return parked;
    for (const other of state.mods) {
        if (!(other.replaced ?? []).some((r) => fileKey(r) === fileKey(file) && r.owner === mod.name)) continue;
        const backup = within(path.join(backupDir(gameId, other.id), file.base), file.to);
        if (fs.existsSync(backup)) return backup;
    }
    return null;
}

/* Keeps the copy that's in the game as its owner's, before another's goes in its place. */
function keepCopy(gameId, loc, ownerId, file) {
    const live = within(baseDir(loc, file.base), file.to);
    if (!fs.existsSync(live)) return;
    const kept = within(path.join(versionsDir(gameId, ownerId), file.base), file.to);
    fs.mkdirSync(path.dirname(kept), { recursive: true });
    fs.copyFileSync(live, kept);
}

/* Puts a mod's copy of a file in the game, and says it's that mod's. */
function putIn(gameId, loc, state, mod, file) {
    const source = copyOf(gameId, state, mod, file);
    if (!source) return false;
    const live = within(baseDir(loc, file.base), file.to);
    fs.mkdirSync(path.dirname(live), { recursive: true });
    fs.copyFileSync(source, live);
    const kept = within(path.join(versionsDir(gameId, mod.id), file.base), file.to);
    if (source === kept) fs.rmSync(kept, { force: true });
    ownerMap(state)[fileKey(file)] = mod.id;
    return true;
}

/* After a file's owner goes (off or removed): the next mod with it takes over, else the game's own file comes back. */
function handOver(gameId, loc, state, leaving, file) {
    const key = fileKey(file);
    const next = state.mods
        .filter((m) => m.id !== leaving.id && m.enabled && m.files.some((f) => fileKey(f) === key))
        .sort((a, b) => String(b.installedAt).localeCompare(String(a.installedAt)))
        .find((m) => putIn(gameId, loc, state, m, file));
    if (next) return;
    delete ownerMap(state)[key];
    // The game's own file (or one added by hand) that a mod replaced, whichever mod kept it.
    const backup = originalOf(gameId, state, file);
    if (backup) {
        const live = within(baseDir(loc, file.base), file.to);
        fs.mkdirSync(path.dirname(live), { recursive: true });
        fs.copyFileSync(backup, live);
    }
}

/* The game's own copy of a file (or one added by hand), kept by whichever mod replaced it first. */
function originalOf(gameId, state, file) {
    for (const mod of state.mods) {
        if (!(mod.replaced ?? []).some((r) => fileKey(r) === fileKey(file) && !r.owner)) continue;
        const backup = within(path.join(backupDir(gameId, mod.id), file.base), file.to);
        if (fs.existsSync(backup)) return backup;
    }
    return null;
}

/* A mod going for good passes the game's own files it kept to another mod with the same file. */
function passOnOriginals(gameId, state, leaving) {
    for (const entry of (leaving.replaced ?? []).filter((r) => !r.owner)) {
        const heir = state.mods.find((m) => m.id !== leaving.id && m.files.some((f) => fileKey(f) === fileKey(entry)));
        const backup = within(path.join(backupDir(gameId, leaving.id), entry.base), entry.to);
        if (!heir || !fs.existsSync(backup)) continue;
        const target = within(path.join(backupDir(gameId, heir.id), entry.base), entry.to);
        if (!(heir.replaced ?? []).some((r) => fileKey(r) === fileKey(entry) && !r.owner)) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(backup, target);
            heir.replaced = [...(heir.replaced ?? []).filter((r) => fileKey(r) !== fileKey(entry)), { base: entry.base, to: entry.to, owner: null }];
        }
    }
}

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

/* A file's MD5, which Nexus Mods can look a download up by. */
function md5Of(file) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("md5");
        fs.createReadStream(file)
            .on("data", (chunk) => hash.update(chunk))
            .on("end", () => resolve(hash.digest("hex")))
            .on("error", reject);
    });
}

/* Earlier copies are kept this long for Undo, one per mod. */
const KEEP_PREVIOUS = 30 * 24 * 60 * 60 * 1000;

/*
 * Numbers in a Nexus Mods download's name that could be its mod's number, most likely
 * first: "SkyUI_5_2_SE-12604-5-2SE-1573851403.7z" -> ["12604", "5"].
 */
function nexusIdsInName(fileName) {
    const match = String(fileName ?? "").match(/^(.*)-(\d{9,11})\.(zip|7z|rar)$/i);
    if (!match) return [];
    return [...match[1].matchAll(/-(\d{1,7})(?=-)/g)].map((m) => m[1]).filter((id, i, all) => all.indexOf(id) === i).slice(0, 4);
}

const sameSource = (a, b) =>
    Boolean(a?.modId) &&
    ((a.provider === b?.provider && String(a.modId) === String(b?.modId)) || (a.provider === "nexus" && String(a.modId) === String(b?.nexus?.modId)));

/* Forgets an earlier copy kept for Undo, and its files. */
function dropPrevious(gameId, state, previous) {
    fs.rmSync(parkedDir(gameId, previous.id), { recursive: true, force: true });
    fs.rmSync(backupDir(gameId, previous.id), { recursive: true, force: true });
    state.previous = (state.previous ?? []).filter((p) => p.id !== previous.id);
}

/*
 * Sets the copy a newer one replaces aside, turned off, so Undo can bring it back.
 * Only the latest earlier copy of each mod is kept, and only for a month.
 */
function setAside(gameId, previous, replacedBy) {
    const wasEnabled = previous.enabled;
    setEnabled(gameId, previous.id, false);
    const state = readState(gameId);
    const mod = state.mods.find((m) => m.id === previous.id);
    state.mods = state.mods.filter((m) => m.id !== previous.id);
    for (const old of [...(state.previous ?? [])]) {
        if (old.supersededBy === previous.id || Date.now() - Date.parse(old.setAsideAt) > KEEP_PREVIOUS) dropPrevious(gameId, state, old);
    }
    state.previous = [...(state.previous ?? []), { ...mod, enabled: false, wasEnabled, supersededBy: replacedBy, setAsideAt: new Date().toISOString() }];
    writeState(gameId, state);
}

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

    const whole = await keptWhole(game, filePath);
    const unpacked = await unpack(filePath, { whole });
    try {
        const broken = whole ? [] : await unpackNested(unpacked.dir);
        const files = listFiles(unpacked.dir).filter((rel) => !broken.includes(path.posix.basename(rel)));
        const gameHas = (rel) => Boolean(loc.gameDir) && fs.existsSync(path.join(loc.gameDir, rel));
        const listGame = (rel) => {
            if (!loc.gameDir) return [];
            try {
                return fs.readdirSync(path.join(loc.gameDir, rel), { withFileTypes: true }).map((entry) => ({ name: entry.name, dir: entry.isDirectory() }));
            } catch {
                return [];
            }
        };
        const state = readState(gameId);
        // A newer copy of the same mod replaces the old one, which is kept for Undo.
        // A Nexus download added from Downloads replaces the mod it's a newer copy of.
        const nexusId = !meta.source?.modId ? nexusIdsInName(path.basename(filePath))[0] : null;
        const previous = meta.replaces
            ? state.mods.find((mod) => mod.id === meta.replaces)
            : state.mods.find(
                  (mod) =>
                      sameSource(meta.source, mod.source) ||
                      (nexusId && String(mod.source?.nexus?.modId ?? "") === nexusId) ||
                      (!meta.source?.modId && mod.name === modName)
              );

        const ctx = {
            modName,
            dir: unpacked.dir,
            gameHas,
            listGame,
            hasGameDir: Boolean(loc.gameDir),
            modsDir: loc.modsDir,
            modsChosen: Boolean(loc.modsChosen),
            game,
        };
        // A FOMOD installer's options are picked in the app, starting from last time's picks.
        let fomodChoices = Array.isArray(meta.fomodChoices) ? meta.fomodChoices : undefined;
        if (!fomodChoices && game.layout === "bethesda") {
            const info = layouts.fomodInfo(files, ctx);
            if (info?.steps.some((step) => step.groups.length)) {
                const preset = previous?.fomod?.choices;
                const answer = meta.auto ? undefined : await require("./fomodAsk.cjs").ask({ gameId, modName, info, preset: preset ?? null });
                if (answer === null) throw new Error("Install cancelled.");
                fomodChoices = answer ?? preset;
            }
        }
        const planned = layouts.plan(game, files, { ...ctx, fomodChoices });

        if (!planned.placements.length) {
            const why = planned.skipped.length ? planned.skipped.slice(0, 3).map((s) => `${path.posix.basename(s.file)} (${s.reason})`).join("; ") : "it had no files for this game";
            const error = new Error(`Nothing from ${modName} could be installed: ${why}.`);
            error.notes = planned.notes;
            throw error;
        }

        const id = newId();
        if (previous) {
            setAside(gameId, previous, id);
            sets.renameKey(gameId, `m:${previous.id}`, `m:${id}`);
            require("./profiles.cjs").renameKey(gameId, `m:${previous.id}`, `m:${id}`);
        }

        const fresh = readState(gameId);
        const owners = new Map();
        for (const mod of fresh.mods.filter((m) => m.enabled)) for (const file of mod.files) owners.set(fileKey(file), mod);

        let md5 = null;
        try {
            md5 = await md5Of(filePath);
        } catch {
            // Only needed to look it up on Nexus Mods later.
        }
        const mod = {
            id,
            // An update keeps the name it had (the site's, once it's been looked up).
            name: meta.name || (previous?.source?.nexus && nexusId ? previous.name : modName),
            source: { ...(meta.source ?? { provider: "file" }), fileName: path.basename(filePath), md5 },
            files: [],
            replaced: [],
            plugins: [],
            enabled: true,
            installedAt: new Date().toISOString(),
            notes: planned.notes,
        };
        if (planned.fomod) mod.fomod = planned.fomod;

        const owner = ownerMap(fresh);
        for (const placement of planned.placements) {
            const root = baseDir(loc, placement.base);
            const target = within(root, placement.to);
            const file = { base: placement.base, to: placement.to };
            // Another mod's copy that's in the game is kept as that mod's.
            const holder = fresh.mods.find((m) => m.id === owner[fileKey(file)] && m.enabled);
            if (holder && fs.existsSync(target)) keepCopy(gameId, loc, holder.id, file);
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
            owner[fileKey(file)] = id;
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
        if (previous) notes.unshift(`Replaced the copy installed before (Undo puts it back).`);
        return { mod: describe(game, mod), placed, skipped: planned.skipped.map((s) => ({ file: path.posix.basename(s.file), reason: s.reason })), notes };
    } finally {
        unpacked.cleanup();
    }
}

/* The folder a file shows as being in: "Mods", "scripts", "Data", "archive/pc/mod"... */
function areaOf(game, file) {
    const parts = file.to.split("/");
    if (game.layout === "sims4") return parts[0];
    if (game.layout === "generic") {
        if (file.base === "mods") return parts.length === 1 ? "mods folder" : parts[0];
        // In the game's folder: down to the folder that tells what it is ("Content/Paks/~mods", "BepInEx/plugins").
        const known = file.to.match(/^(.*?(?:Paks\/~mods|Paks\/LogicMods|Paks|BepInEx\/plugins|reframework\/autorun|ue4ss\/Mods|custom|scripts|Mods))\//i);
        return known ? known[1] : parts.length === 1 ? "game folder" : parts[0];
    }
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

    const owner = ownerMap(state);
    for (const file of mod.files) {
        const key = fileKey(file);
        const live = within(baseDir(loc, file.base), file.to);
        const parked = within(path.join(parkedDir(gameId, mod.id), file.base), file.to);
        const kept = within(path.join(versionsDir(gameId, mod.id), file.base), file.to);
        if (enabled) {
            if (!fs.existsSync(parked)) continue;
            const holder = state.mods.find((m) => m.id === owner[key] && m.id !== mod.id && m.enabled);
            if (holder) {
                // Another mod's copy is in the game: this one's is kept until it's chosen.
                fs.mkdirSync(path.dirname(kept), { recursive: true });
                fs.renameSync(parked, kept);
            } else {
                // What's there now (the game's own file, or one added by hand) is kept to come back later.
                if (fs.existsSync(live)) {
                    const backup = within(path.join(backupDir(gameId, mod.id), file.base), file.to);
                    fs.mkdirSync(path.dirname(backup), { recursive: true });
                    fs.copyFileSync(live, backup);
                    mod.replaced = [...(mod.replaced ?? []).filter((r) => fileKey(r) !== key), { ...file, owner: null }];
                }
                move(parked, live);
                owner[key] = mod.id;
            }
        } else if (owner[key] === mod.id || owner[key] === undefined) {
            // Its copy is the one in the game: it's put away, and the next mod's (or the game's own) goes in.
            if (fs.existsSync(live)) move(live, parked);
            handOver(gameId, loc, state, mod, file);
            if (!fs.existsSync(live)) pruneEmpty(path.dirname(live), baseDir(loc, file.base), file.base);
        } else if (fs.existsSync(kept)) {
            // Another mod's copy is in the game; this one's is put away with the rest.
            fs.mkdirSync(path.dirname(parked), { recursive: true });
            fs.renameSync(kept, parked);
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
        const owner = ownerMap(state);
        for (const file of mod.files) {
            const key = fileKey(file);
            // Only its own copy leaves the game; another mod's stays.
            if (owner[key] !== mod.id && owner[key] !== undefined) continue;
            const root = baseDir(loc, file.base);
            const live = within(root, file.to);
            fs.rmSync(live, { force: true });
            handOver(gameId, loc, state, mod, file);
            if (!fs.existsSync(live)) pruneEmpty(path.dirname(live), root, file.base);
        }
    }
    if (mod.plugins?.length) {
        try {
            plugins.remove(game, loc, mod.plugins);
        } catch {
            // No load order file.
        }
    }
    passOnOriginals(gameId, state, mod);
    fs.rmSync(parkedDir(gameId, mod.id), { recursive: true, force: true });
    fs.rmSync(backupDir(gameId, mod.id), { recursive: true, force: true });
    fs.rmSync(versionsDir(gameId, mod.id), { recursive: true, force: true });
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
    if (game.layout === "generic") {
        // Whatever sits in the mods folder: each file or folder is one mod.
        if (loc.modsDir) for (const entry of entries(loc.modsDir)) add("mods", entry.name, entry.isDirectory() ? "folder" : "file");
        return found;
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
    for (const base of ["game", "docs", "mods"]) {
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
    touch(gameId);
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
        pruneEmpty(path.dirname(live), baseDir(loc, base), base);
    }
    return { key, enabled };
}

function removeHandAdded(gameId, key) {
    touch(gameId);
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

function describe(game, mod, state = readState(game.id)) {
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
        version: mod.source?.version ?? mod.source?.nexus?.version ?? null,
        canUndo: (state.previous ?? []).some((previous) => previous.supersededBy === mod.id),
        kept: Boolean(mod.kept),
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
            ...state.mods.map((mod) => describe(game, mod, state)),
            ...hand.map((item) => ({
                key: `${item.kind === "plugin" ? "p" : "h"}:${item.base}:${item.rel}`,
                managed: false,
                name: item.name,
                enabled: item.enabled,
                source: { provider: "hand" },
                where: path.posix.dirname(item.rel) === "." ? ({ docs: "Documents", mods: "mods folder" }[item.base] ?? "game folder") : path.posix.dirname(item.rel),
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

/*
 * Files more than one mod that's on has: [{ key, file: { base, to }, owners: [modIds], live: modId }].
 */
function sharedFiles(gameId) {
    const state = readState(gameId);
    const owner = ownerMap(state);
    const byKey = new Map();
    for (const mod of state.mods.filter((m) => m.enabled)) {
        for (const file of mod.files) {
            const key = fileKey(file);
            const entry = byKey.get(key) ?? { key, file, owners: [] };
            entry.owners.push(mod.id);
            byKey.set(key, entry);
        }
    }
    return [...byKey.values()].filter((e) => e.owners.length > 1).map((e) => ({ ...e, live: owner[e.key] ?? e.owners.at(-1) }));
}

/* Makes a mod's copy of files the one in the game, keeping the copies it replaces. -> how many changed. */
function setWinner(gameId, keys, winnerId) {
    const loc = locate(gameId);
    const state = readState(gameId);
    const owner = ownerMap(state);
    const winner = state.mods.find((m) => m.id === winnerId && m.enabled);
    if (!winner) throw new Error("That mod isn't on.");
    let changed = 0;
    for (const key of keys) {
        const file = winner.files.find((f) => fileKey(f) === key);
        if (!file || owner[key] === winner.id) continue;
        const current = state.mods.find((m) => m.id === owner[key] && m.enabled);
        if (current) keepCopy(gameId, loc, current.id, file);
        if (putIn(gameId, loc, state, winner, file)) changed += 1;
    }
    writeState(gameId, state);
    return changed;
}

/* Puts back the copy an update replaced. */
function undoReplace(gameId, key) {
    const modId = key.replace(/^m:/, "");
    const state = readState(gameId);
    const previous = (state.previous ?? []).find((p) => p.supersededBy === modId);
    if (!previous) throw new Error("There's no earlier copy of that mod to go back to.");
    removeMod(gameId, modId);
    const fresh = readState(gameId);
    fresh.previous = (fresh.previous ?? []).filter((p) => p.id !== previous.id);
    const { supersededBy, setAsideAt, wasEnabled, ...mod } = previous;
    fresh.mods.push({ ...mod, enabled: false });
    writeState(gameId, fresh);
    if (wasEnabled) setEnabled(gameId, previous.id, true);
    sets.renameKey(gameId, `m:${modId}`, `m:${previous.id}`);
    require("./profiles.cjs").renameKey(gameId, `m:${modId}`, `m:${previous.id}`);
    return { restored: previous.name, version: previous.source?.version ?? previous.source?.nexus?.version ?? null };
}

/* Adds what was found out about where a mod came from (its Nexus Mods file, say), and its proper name. */
function rememberSource(gameId, modId, patch, name = null) {
    const state = readState(gameId);
    const mod = state.mods.find((m) => m.id === modId);
    if (!mod) return;
    mod.source = { ...(mod.source ?? {}), ...patch };
    if (name) mod.name = name;
    writeState(gameId, state, { quiet: true });
}

/* Deleting a mod deletes any earlier copy kept for it too. */
function deleteManaged(gameId, modId) {
    const result = removeMod(gameId, modId);
    const state = readState(gameId);
    for (const previous of (state.previous ?? []).filter((p) => p.supersededBy === modId)) dropPrevious(gameId, state, previous);
    writeState(gameId, state);
    return result;
}

/* A mod kept at its version isn't offered for updating, or updated by Update all, until it's let go. */
function setKept(gameId, key, kept) {
    if (!String(key).startsWith("m:")) throw new Error("Only mods the launcher installed can be kept at a version.");
    const state = readState(gameId);
    const mod = state.mods.find((m) => m.id === String(key).slice(2));
    if (!mod) throw new Error("That mod isn't installed any more.");
    if (kept) mod.kept = true;
    else delete mod.kept;
    writeState(gameId, state, { quiet: true });
    return { kept: Boolean(mod.kept) };
}

const setModEnabled = (gameId, key, enabled) => (key.startsWith("m:") ? setEnabled(gameId, key.slice(2), enabled) : setHandAddedEnabled(gameId, key, enabled));
const deleteMod = (gameId, key) => (key.startsWith("m:") ? deleteManaged(gameId, key.slice(2)) : removeHandAdded(gameId, key));

module.exports = { install, list, setModEnabled, deleteMod, setKept, readState, undoReplace, rememberSource, nexusIdsInName, touch, sharedFiles, setWinner };
