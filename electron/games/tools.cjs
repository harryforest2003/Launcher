const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getGame } = require("./registry.cjs");
const { locate } = require("./detect.cjs");
const { readSettings, writeSettings } = require("./storage.cjs");
const { CROSSOVER_WINE, startDetached, inBottle } = require("./launch.cjs");

/*
 * Modding tools for a Bethesda game (xEdit, BodySlide, Nemesis, Pandora...): the ones found in
 * or near the game's folder, and any added by hand, each started with its own arguments. On a
 * Mac a tool runs through CrossOver, in the game's bottle, so it sees the game as installed.
 *
 *   settings.modTools[gameId] = { list: [{ id, name, exe, args, added }], hidden: [exe] }
 */

const KNOWN = [
    { kind: "xedit", name: "xEdit", match: /^(x|SSE|TES[45]|TES5VR|FO[34]|FO4VR|FNV|SF1|EnderalSE|Enderal)Edit(64)?\.exe$/i, about: "Cleans and checks plugins, and patches conflicts." },
    { kind: "bodyslide", name: "BodySlide", match: /^BodySlide( x64)?\.exe$/i, about: "Builds body and outfit meshes for the sliders you pick." },
    { kind: "outfitstudio", name: "Outfit Studio", match: /^OutfitStudio( x64)?\.exe$/i, about: "Fits outfits to bodies, for BodySlide." },
    { kind: "nemesis", name: "Nemesis", match: /^Nemesis Unlimited Behavior Engine\.exe$/i, about: "Builds animation behaviour files: run after adding or removing animation mods." },
    { kind: "pandora", name: "Pandora", match: /^Pandora Behaviou?r Engine\+?\.exe$/i, about: "Builds animation behaviour files (newer than Nemesis): run after animation mods change." },
    { kind: "wryebash", name: "Wrye Bash", match: /^Wrye Bash\.exe$/i, about: "Bashed patches and plugin checks." },
    { kind: "dyndolod", name: "DynDOLOD", match: /^DynDOLOD(x64)?\.exe$/i, about: "Distant objects and trees (LOD)." },
    { kind: "texgen", name: "TexGen", match: /^TexGen(x64)?\.exe$/i, about: "Makes the textures DynDOLOD needs." },
];

/* xEdit's own name says which game; plain xEdit.exe needs telling, by the game's My Games folder. */
const XEDIT_MODE = {
    Skyrim: "-tes5",
    "Skyrim Special Edition": "-sse",
    "Skyrim Special Edition GOG": "-sse",
    "Skyrim VR": "-tes5vr",
    "Enderal Special Edition": "-enderalse",
    Oblivion: "-tes4",
    Fallout3: "-fo3",
    FalloutNV: "-fnv",
    Fallout4: "-fo4",
    Fallout4VR: "-fo4vr",
    Starfield: "-sf1",
};

// Folders full of game files, not tools: never looked through.
const SKIP = new Set(["meshes", "textures", "sound", "music", "interface", "strings", "video", "seq", "shadersfx", "lodsettings", "grass", "terrain", "materials", "scripts", "source", "facegendata", "vis", "geometries", "lod", "particles", "planetdata", "__macosx", ".git"]);
const MAX_DEPTH = 4;
const MAX_SEEN = 20000;

const idOf = (exe) => crypto.createHash("sha1").update(exe.toLowerCase()).digest("hex").slice(0, 10);
const knownFor = (exe) => KNOWN.find((tool) => tool.match.test(path.basename(exe))) ?? null;

function needBethesda(gameId) {
    const game = getGame(gameId);
    if (!game) throw new Error(`Unknown game "${gameId}".`);
    if (!game.bethesda) throw new Error(`The launcher has no modding tools for ${game.name}.`);
    return game;
}

/* Tools' exes under a folder, a few levels down. */
function scan(root, found, depth = 0, seen = { count: 0 }) {
    if (depth > MAX_DEPTH || seen.count > MAX_SEEN) return;
    let entries;
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (++seen.count > MAX_SEEN) return;
        const full = path.join(root, entry.name);
        if (entry.isFile() && /\.exe$/i.test(entry.name) && knownFor(full)) found.add(full);
        else if (entry.isDirectory() && !SKIP.has(entry.name.toLowerCase())) scan(full, found, depth + 1, seen);
    }
}

/* Where tools are looked for: the game's folder, and in a bottle, drive_c's own modding folders. */
function found(loc) {
    const exes = new Set();
    if (!loc.gameDir) return [];
    scan(loc.gameDir, exes);
    const at = loc.gameDir.indexOf(`${path.sep}drive_c${path.sep}`);
    if (at >= 0) {
        const driveC = path.join(loc.gameDir.slice(0, at), "drive_c");
        try {
            for (const entry of fs.readdirSync(driveC, { withFileTypes: true })) {
                if (entry.isDirectory() && /mod|tool|xedit|edit/i.test(entry.name)) scan(path.join(driveC, entry.name), exes, 1);
            }
        } catch {
            // No drive_c to look in.
        }
    }
    return [...exes].sort((a, b) => a.localeCompare(b));
}

function saved(gameId) {
    const entry = readSettings().modTools?.[gameId];
    return { list: Array.isArray(entry?.list) ? entry.list : [], hidden: Array.isArray(entry?.hidden) ? entry.hidden : [] };
}

function keep(gameId, data) {
    const settings = readSettings();
    settings.modTools = { ...(settings.modTools ?? {}), [gameId]: data };
    writeSettings(settings);
}

/* The game's My Games name, for plain xEdit's game switch. */
const xeditArgs = (game, exe) => (/^xEdit(64)?\.exe$/i.test(path.basename(exe)) ? (XEDIT_MODE[game.bethesda.appData?.[0]] ?? "") : "");

/* Every tool: the ones found (unless taken off the list), then the ones added by hand. */
function list(gameId) {
    const game = needBethesda(gameId);
    const loc = locate(gameId);
    const { list: mine, hidden } = saved(gameId);
    const byExe = new Map(mine.map((tool) => [tool.exe.toLowerCase(), tool]));
    const out = [];
    const shown = new Set();
    const row = (exe, own, isFound) => {
        const known = knownFor(exe);
        shown.add(exe.toLowerCase());
        out.push({
            id: idOf(exe),
            name: own?.name || known?.name || path.basename(exe, path.extname(exe)),
            kind: known?.kind ?? "other",
            about: known?.about ?? null,
            exe,
            args: own?.args ?? xeditArgs(game, exe),
            found: isFound,
            exists: fs.existsSync(exe),
        });
    };
    const hiddenSet = new Set(hidden.map((exe) => exe.toLowerCase()));
    for (const exe of found(loc)) if (!hiddenSet.has(exe.toLowerCase())) row(exe, byExe.get(exe.toLowerCase()), true);
    for (const tool of mine) if (tool.added && !shown.has(tool.exe.toLowerCase())) row(tool.exe, tool, false);
    return { tools: out, hidden: hidden.length, howToRun: howToRun(loc) };
}

/* How tools start here, or why they can't: null when they can. */
function howToRun(loc) {
    if (process.platform === "win32") return null;
    if (process.platform !== "darwin") return "Start tools with Wine or Proton yourself: the launcher only starts them on Windows and, through CrossOver, on a Mac.";
    if (!fs.existsSync(CROSSOVER_WINE)) return "On a Mac, Windows tools run through CrossOver: install it, and put the game in a CrossOver bottle.";
    if (loc.gameDir && inBottle(loc.gameDir) && !loc.gameDir.includes("/CrossOver/Bottles/")) return "The game is in a Whisky bottle: start tools from Whisky.";
    return null;
}

const bottleOf = (file) => (file && file.includes("/CrossOver/Bottles/") ? (file.match(/\/Bottles\/([^/]+)\/drive_c\//)?.[1] ?? null) : null);

/* Arguments as typed: split at spaces, except inside "double quotes". */
function splitArgs(text) {
    const out = [];
    let current = "";
    let quoted = false;
    let has = false;
    for (const char of String(text ?? "")) {
        if (char === '"') {
            quoted = !quoted;
            has = true;
        } else if (/\s/.test(char) && !quoted) {
            if (has) out.push(current);
            current = "";
            has = false;
        } else {
            current += char;
            has = true;
        }
    }
    if (has) out.push(current);
    return out;
}

function edit(gameId, exe, change) {
    const data = saved(gameId);
    const at = data.list.findIndex((tool) => tool.exe.toLowerCase() === exe.toLowerCase());
    const next = { ...(at >= 0 ? data.list[at] : { exe, added: false }), ...change };
    if (at >= 0) data.list[at] = next;
    else data.list.push(next);
    keep(gameId, data);
}

const toolFor = (gameId, id) => {
    const tool = list(gameId).tools.find((entry) => entry.id === id);
    if (!tool) throw new Error("That tool isn't on the list any more.");
    return tool;
};

/* A tool chosen in the main process's file dialog. */
function add(gameId, exe) {
    needBethesda(gameId);
    if (!/\.exe$/i.test(exe) || !fs.statSync(exe).isFile()) throw new Error("Choose the tool's .exe file.");
    const data = saved(gameId);
    data.hidden = data.hidden.filter((entry) => entry.toLowerCase() !== exe.toLowerCase());
    keep(gameId, data);
    edit(gameId, exe, { added: true });
    return list(gameId);
}

function update(gameId, id, { name, args }) {
    const tool = toolFor(gameId, id);
    const clean = String(name ?? tool.name).replace(/\s+/g, " ").trim().slice(0, 60) || tool.name;
    edit(gameId, tool.exe, { name: clean, args: String(args ?? "").slice(0, 2000) });
    return list(gameId);
}

/* Off the list: a found one stays off until "Look again"; one added by hand is forgotten. */
function remove(gameId, id) {
    const tool = toolFor(gameId, id);
    const data = saved(gameId);
    data.list = data.list.filter((entry) => entry.exe.toLowerCase() !== tool.exe.toLowerCase());
    if (tool.found) data.hidden = [...data.hidden, tool.exe];
    keep(gameId, data);
    return list(gameId);
}

/* Shows the found tools taken off the list again. */
function showAll(gameId) {
    const data = saved(gameId);
    keep(gameId, { ...data, hidden: [] });
    return list(gameId);
}

async function run(gameId, id) {
    const game = needBethesda(gameId);
    const loc = locate(gameId);
    const tool = toolFor(gameId, id);
    if (!tool.exists) throw new Error(`${tool.name} isn't at ${tool.exe} any more.`);
    const args = splitArgs(tool.args);
    const cwd = path.dirname(tool.exe);
    if (process.platform === "win32") {
        await startDetached(tool.exe, args, cwd);
        return { started: tool.name };
    }
    const problem = howToRun(loc);
    if (problem) throw new Error(problem);
    // The game's bottle first: there the tool finds the game the way it would on Windows.
    const bottle = bottleOf(loc.gameDir) ?? bottleOf(tool.exe);
    if (!bottle) throw new Error(`${game.name} isn't in a CrossOver bottle: put it in one, then run ${tool.name} from here.`);
    await startDetached(CROSSOVER_WINE, ["--bottle", bottle, tool.exe, ...args], cwd);
    return { started: tool.name, bottle };
}

module.exports = { list, add, update, remove, showAll, run, splitArgs, KNOWN };
