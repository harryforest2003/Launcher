const fs = require("fs");
const path = require("path");
const { getGame } = require("./registry.cjs");
const { locate } = require("./detect.cjs");
const { dataDir } = require("./storage.cjs");
const { homes } = require("./saves.cjs");
const { gameOpen } = require("./running.cjs");

/*
 * A Bethesda game's INI files (Skyrim.ini, Fallout4Custom.ini...), in its Documents/My Games
 * folder: read and edited as text, with a copy kept before each change, and a few well-known
 * changes (presets) set in one go. Only the lines a preset names change; the rest of the
 * file, comments and all, stays as it was.
 */

const KEEP = 10;
const MAX_SIZE = 1024 * 1024;

const LOOSE_FILES = { id: "loose", label: "Use loose files", detail: "Lets mods' loose textures and meshes replace the ones packed in the game's archives." };
const PAPYRUS = { id: "papyrus", label: "Papyrus script logs", detail: "Writes script logs (My Games > Logs > Script) for finding a broken mod. Slows the game a little: turn off when done." };
const PAPYRUS_KEYS = { bEnableLogging: "1", bEnableTrace: "1", bLoadDebugInformation: "1" };

/*
 * By the game's My Games folder: its main INI (shown first) and its presets, each with the
 * file it goes in and the values it sets ([section] -> key -> value).
 */
const skyrim = (main) => ({ main, presets: [{ ...PAPYRUS, file: main, set: { Papyrus: PAPYRUS_KEYS } }] });
const fallout4 = {
    main: "Fallout4.ini",
    presets: [
        { ...LOOSE_FILES, file: "Fallout4Custom.ini", set: { Archive: { bInvalidateOlderFiles: "1", sResourceDataDirsFinal: "" } } },
        { ...PAPYRUS, file: "Fallout4Custom.ini", set: { Papyrus: PAPYRUS_KEYS } },
    ],
};
const fallout3 = { main: "Fallout.ini", presets: [{ ...LOOSE_FILES, file: "Fallout.ini", set: { Archive: { bInvalidateOlderFiles: "1", SInvalidationFile: "" } } }] };
const GAMES = {
    Skyrim: skyrim("Skyrim.ini"),
    "Skyrim Special Edition": skyrim("Skyrim.ini"),
    "Skyrim Special Edition GOG": skyrim("Skyrim.ini"),
    "Skyrim VR": skyrim("SkyrimVR.ini"),
    "Enderal Special Edition": skyrim("Enderal.ini"),
    Oblivion: { main: "Oblivion.ini", presets: [{ ...LOOSE_FILES, file: "Oblivion.ini", set: { Archive: { bInvalidateOlderFiles: "1" } } }] },
    Fallout3: fallout3,
    FalloutNV: fallout3,
    Fallout4: fallout4,
    Fallout4VR: { ...fallout4, main: "Fallout4VR.ini" },
    Starfield: {
        main: "StarfieldPrefs.ini",
        presets: [
            { ...LOOSE_FILES, file: "StarfieldCustom.ini", set: { Archive: { bInvalidateOlderFiles: "1", sResourceDataDirsFinal: "" } } },
            { ...PAPYRUS, file: "StarfieldCustom.ini", set: { Papyrus: PAPYRUS_KEYS } },
        ],
    },
};

function needBethesda(gameId) {
    const game = getGame(gameId);
    if (!game) throw new Error(`Unknown game "${gameId}".`);
    if (!game.bethesda) throw new Error(`${game.name} has no INI files the launcher knows.`);
    return game;
}

const newest = (dir) => {
    let best = 0;
    for (const name of iniNames(dir)) best = Math.max(best, mtime(path.join(dir, name)));
    return best;
};
const mtime = (file) => {
    try {
        return fs.statSync(file).mtimeMs;
    } catch {
        return 0;
    }
};
const iniNames = (dir) => {
    try {
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && /\.ini$/i.test(entry.name))
            .map((entry) => entry.name);
    } catch {
        return [];
    }
};

/*
 * The game's My Games folder and its rules: the one there whose INIs changed last (on a Mac,
 * usually in the CrossOver bottle's user's Documents). Null folder if the game hasn't made one.
 */
function where(gameId) {
    const game = needBethesda(gameId);
    const loc = locate(gameId);
    const names = game.bethesda.appData ?? [];
    const found = [];
    for (const home of homes(loc)) {
        for (const docs of ["Documents", path.join("OneDrive", "Documents")]) {
            for (const name of names) {
                const dir = path.join(home, docs, "My Games", name);
                if (fs.existsSync(dir)) found.push({ dir, name, at: newest(dir) });
            }
        }
    }
    found.sort((a, b) => b.at - a.at);
    const pick = found[0] ?? null;
    return { game, dir: pick?.dir ?? null, rules: GAMES[pick?.name ?? names[0]] ?? { main: null, presets: [] } };
}

/* A file name the renderer passed: an .ini directly in the folder, nothing more. */
function fileIn(dir, name) {
    const base = String(name ?? "");
    if (!/^[^/\\]+\.ini$/i.test(base) || base.startsWith(".")) throw new Error("That isn't an INI file name.");
    return path.join(dir, base);
}

/* Bytes as text: UTF-8 when they are, else Windows' Latin-1, so saving changes nothing else. */
function decode(buffer) {
    const text = buffer.toString("utf8");
    return Buffer.from(text, "utf8").equals(buffer) ? { text, encoding: "utf8" } : { text: buffer.toString("latin1"), encoding: "latin1" };
}

function readText(file) {
    if (!fs.existsSync(file)) return { text: "", encoding: "utf8", exists: false };
    if (fs.statSync(file).size > MAX_SIZE) throw new Error(`${path.basename(file)} is too big to be an INI file.`);
    return { ...decode(fs.readFileSync(file)), exists: true };
}

/* ---------------- editing lines ---------------- */

const sectionOf = (line) => line.match(/^\s*\[([^\]]+)\]\s*$/)?.[1].trim().toLowerCase() ?? null;
const keyOf = (line) => (/^\s*[;#]/.test(line) ? null : (line.match(/^\s*([^=\s][^=]*?)\s*=/)?.[1].toLowerCase() ?? null));

/* The value a key has in a section, or undefined. The last one counts, as in the game. */
function getValue(text, section, key) {
    let inside = false;
    let value;
    for (const line of text.split(/\r?\n/)) {
        const head = sectionOf(line);
        if (head !== null) {
            inside = head === section.toLowerCase();
            continue;
        }
        if (inside && keyOf(line) === key.toLowerCase()) value = line.slice(line.indexOf("=") + 1).trim();
    }
    return value;
}

/* Sets keys in a section: each line that has one changes, the rest are added at the section's end. */
function setValues(text, section, pairs) {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text === "" ? [] : text.split(/\r?\n/);
    const wanted = new Map(Object.entries(pairs).map(([key, value]) => [key.toLowerCase(), [key, value]]));
    const done = new Set();
    let inside = false;
    let end = -1;
    for (let i = 0; i < lines.length; i++) {
        const head = sectionOf(lines[i]);
        if (head !== null) {
            inside = head === section.toLowerCase();
            if (inside) end = i;
            continue;
        }
        if (!inside) continue;
        const key = keyOf(lines[i]);
        if (key && wanted.has(key)) {
            lines[i] = `${lines[i].slice(0, lines[i].indexOf("=") + 1)}${wanted.get(key)[1]}`;
            done.add(key);
        }
        if (lines[i].trim()) end = i;
    }
    const missing = [...wanted].filter(([key]) => !done.has(key)).map(([, [key, value]]) => `${key}=${value}`);
    if (!missing.length) return lines.join(eol);
    if (end >= 0) {
        lines.splice(end + 1, 0, ...missing);
        return lines.join(eol);
    }
    // No such section: a new one at the end.
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return [...lines, ...(lines.length ? [""] : []), `[${section}]`, ...missing, ""].join(eol);
}

/* ---------------- copies kept before each change ---------------- */

const backupsDir = (gameId, name) => path.join(dataDir(), gameId, "ini-backups", name.toLowerCase());

function backupsOf(gameId, name) {
    const dir = backupsDir(gameId, name);
    try {
        return fs
            .readdirSync(dir)
            .filter((entry) => /^\d+\.ini$/.test(entry))
            .map((entry) => ({ id: entry.slice(0, -4), at: new Date(Number(entry.slice(0, -4))).toISOString(), size: fs.statSync(path.join(dir, entry)).size }))
            .sort((a, b) => Number(b.id) - Number(a.id));
    } catch {
        return [];
    }
}

/* A copy of the file as it is now (none if it isn't there yet); the oldest go past KEEP. */
function keepCopy(gameId, file) {
    if (!fs.existsSync(file)) return;
    const name = path.basename(file);
    const dir = backupsDir(gameId, name);
    fs.mkdirSync(dir, { recursive: true });
    let stamp = Date.now();
    while (fs.existsSync(path.join(dir, `${stamp}.ini`))) stamp++;
    fs.copyFileSync(file, path.join(dir, `${stamp}.ini`));
    for (const old of backupsOf(gameId, name).slice(KEEP)) fs.rmSync(path.join(dir, `${old.id}.ini`), { force: true });
}

/* Some INIs are written by the game when it closes: a change made while it's open is lost. */
async function needClosed(game) {
    if (await gameOpen(game.id)) throw new Error(`Close ${game.name} first: it writes its INI files when it quits, over any change made now.`);
}

function write(file, text, encoding) {
    const tmp = `${file}.unity-tmp`;
    fs.writeFileSync(tmp, text, encoding);
    fs.renameSync(tmp, file);
}

/* ---------------- what the page calls ---------------- */

function presetState(dir, preset) {
    const text = dir ? readText(path.join(dir, preset.file)).text : "";
    const pairs = Object.entries(preset.set).flatMap(([section, keys]) => Object.entries(keys).map(([key, value]) => ({ toggle: /^b[A-Z]/.test(key), set: getValue(text, section, key) === value })));
    if (pairs.every((pair) => pair.set)) return "on";
    // Off is judged by its switches (bName) alone: turning it off leaves the other values.
    return pairs.some((pair) => pair.toggle && pair.set) ? "partial" : "off";
}

/* The folder, its INI files (the main one first) and the presets, each on or off. */
function list(gameId) {
    const { game, dir, rules } = where(gameId);
    const names = dir ? iniNames(dir) : [];
    const main = rules.main?.toLowerCase();
    names.sort((a, b) => (a.toLowerCase() === main ? -1 : b.toLowerCase() === main ? 1 : a.localeCompare(b, undefined, { sensitivity: "base" })));
    return {
        game: game.name,
        folder: dir,
        files: names.map((name) => {
            const file = path.join(dir, name);
            const stat = fs.statSync(file);
            return { name, size: stat.size, modified: new Date(stat.mtimeMs).toISOString(), backups: backupsOf(gameId, name).length };
        }),
        presets: rules.presets.map((preset) => ({ id: preset.id, label: preset.label, detail: preset.detail, file: preset.file, state: presetState(dir, preset) })),
    };
}

function needFolder(gameId) {
    const found = where(gameId);
    if (!found.dir) throw new Error(`${found.game.name} hasn't made its settings folder yet: start the game once, then try again.`);
    return found;
}

function read(gameId, name) {
    const { dir } = needFolder(gameId);
    const file = fileIn(dir, name);
    if (!fs.existsSync(file)) throw new Error(`${name} isn't there any more.`);
    return { name: path.basename(file), text: readText(file).text, backups: backupsOf(gameId, path.basename(file)) };
}

async function save(gameId, name, text) {
    const { game, dir } = needFolder(gameId);
    const file = fileIn(dir, name);
    if (typeof text !== "string" || text.length > MAX_SIZE) throw new Error("That's too much text for an INI file.");
    await needClosed(game);
    const before = readText(file);
    if (before.exists && before.text === text) return read(gameId, name);
    keepCopy(gameId, file);
    write(file, text, before.encoding === "latin1" && /^[\u0000-ÿ]*$/.test(text) ? "latin1" : "utf8");
    return read(gameId, name);
}

/* Puts a kept copy back; what's there now is kept first, so this can be undone too. */
async function restore(gameId, name, id) {
    const { game, dir } = needFolder(gameId);
    const file = fileIn(dir, name);
    const copy = path.join(backupsDir(gameId, path.basename(file)), `${String(id)}.ini`);
    if (!/^\d+$/.test(String(id)) || !fs.existsSync(copy)) throw new Error("That copy isn't there any more.");
    await needClosed(game);
    keepCopy(gameId, file);
    fs.copyFileSync(copy, `${file}.unity-tmp`);
    fs.renameSync(`${file}.unity-tmp`, file);
    return read(gameId, name);
}

/* Turns a preset on (its values set, the file made if need be) or off (its switches set to 0). */
async function preset(gameId, id, on) {
    const { game, dir, rules } = needFolder(gameId);
    const chosen = rules.presets.find((entry) => entry.id === id);
    if (!chosen) throw new Error("That preset isn't for this game.");
    await needClosed(game);
    const file = fileIn(dir, chosen.file);
    const before = readText(file);
    let text = before.text;
    for (const [section, keys] of Object.entries(chosen.set)) {
        // Off: the switches (bName) go to 0; the other values stay, harmless alone.
        const pairs = on ? keys : Object.fromEntries(Object.keys(keys).filter((key) => /^b[A-Z]/.test(key)).map((key) => [key, "0"]));
        text = setValues(text, section, pairs);
    }
    if (before.exists && text === before.text) return list(gameId);
    keepCopy(gameId, file);
    write(file, text, before.encoding);
    return list(gameId);
}

/* Opens the folder in Finder or Explorer: returns it, for the main process to show. */
const folder = (gameId) => needFolder(gameId).dir;

module.exports = { list, read, save, restore, preset, folder, getValue, setValues };
