const fs = require("fs");
const path = require("path");
const { readSettings, writeSettings } = require("./storage.cjs");

/*
 * Keeping mods from crashing a game after it updates. Game updates are what break mods
 * that hook into its code (The Sims 4's script mods, GTA V's Script Hook V, SKSE and F4SE,
 * Cyber Engine Tweaks): the game changes underneath them. So the launcher remembers which
 * version of each game was last played, and when that's changed, says so before playing,
 * names the mods most likely to need updating, and offers to play without them.
 *
 * For The Sims 4 it also reads what the game says went wrong (its lastException files),
 * which usually name the mod that failed.
 */

/* ---------------- which version of the game this is ---------------- */

function stat(file) {
    try {
        const { size, mtimeMs } = fs.statSync(file);
        return { size, mtimeMs };
    } catch {
        return null;
    }
}

const EXES = {
    gtav: ["GTA5.exe", "GTA5_Enhanced.exe"],
    skyrimse: ["SkyrimSE.exe"],
    fallout4: ["Fallout4.exe"],
    cyberpunk2077: ["bin/x64/Cyberpunk2077.exe"],
    stardew: ["Stardew Valley.dll", "StardewValley.dll", "Stardew Valley.exe"],
};

/* The Sims 4's version, from GameVersion.txt in its Documents folder ("1.112.519.1020"). */
function simsVersion(loc) {
    try {
        return fs.readFileSync(path.join(loc.docsDir, "GameVersion.txt"), "latin1").match(/\d+\.\d+\.\d+\.\d+/)?.[0] ?? null;
    } catch {
        return null;
    }
}

/*
 * The Sims 4's own program, which an update replaces as soon as it installs, before the
 * game next starts. (GameVersion.txt in Documents only changes once the updated game has
 * run, which is too late to warn before playing.)
 */
const SIMS_PROGRAMS = ["Game/Bin/TS4_x64.exe", "Contents/MacOS/The Sims 4", "Contents/Info.plist"];

/* What identifies this version of the game: { id, label, at } or null if it can't be told. */
function fingerprint(game, loc) {
    if (game.id === "sims4") {
        const version = simsVersion(loc);
        for (const rel of loc.gameDir ? SIMS_PROGRAMS : []) {
            const found = stat(path.join(loc.gameDir, rel));
            if (found) {
                const date = new Date(found.mtimeMs).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
                return { id: `${rel}:${found.size}:${Math.round(found.mtimeMs / 1000)}`, label: `updated ${date}`, at: found.mtimeMs, version };
            }
        }
        return version ? { id: version, label: version, at: null, version } : null;
    }
    if (!loc.gameDir) return null;
    for (const exe of EXES[game.id] ?? []) {
        const found = stat(path.join(loc.gameDir, exe));
        if (found) return { id: `${exe}:${found.size}`, label: `updated ${new Date(found.mtimeMs).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`, at: found.mtimeMs };
    }
    return null;
}

/* ---------------- remembering the last game played ---------------- */

function lastPlayed(gameId) {
    return readSettings().played?.[gameId] ?? null;
}

/* Called on every Play: remembers this version. */
function rememberPlay(game, loc) {
    const print = fingerprint(game, loc);
    const settings = readSettings();
    settings.played ??= {};
    const before = settings.played[game.id];
    settings.played[game.id] = { print: print?.id ?? null, label: print?.label ?? null, at: Date.now(), updatedAt: before && print && before.print !== print.id ? Date.now() : before?.updatedAt ?? null };
    writeSettings(settings);
}

/*
 * Whether the game has updated since it was last played here: { from, to } or null.
 * Nothing is said the first time, as there's nothing to compare with.
 */
function updatedSince(game, loc) {
    const before = lastPlayed(game.id);
    const now = fingerprint(game, loc);
    if (!before?.print || !now || before.print === now.id) return null;
    return { from: before.label, to: now.label };
}

/* ---------------- The Sims 4's own settings ---------------- */

function simsOptionsFile(loc) {
    return loc.docsDir ? path.join(loc.docsDir, "Options.ini") : null;
}

/* Whether custom content and script mods are on in the game's own options: { mods, scripts } or null. */
function simsOptions(loc) {
    const file = simsOptionsFile(loc);
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch {
        return null;
    }
    const value = (key) => text.match(new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)`, "mi"))?.[1];
    return { mods: value("modsdisabled") !== "1", scripts: value("scriptmodsenabled") === "1" };
}

/* Turns custom content and/or script mods on or off in Options.ini (the game must be closed). */
function setSimsOptions(loc, { mods, scripts }) {
    const file = simsOptionsFile(loc);
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch {
        throw new Error("The Sims 4 hasn't made its Options.ini yet: start the game once first.");
    }
    const set = (body, key, value) => (new RegExp(`^\\s*${key}\\s*=`, "mi").test(body) ? body.replace(new RegExp(`^(\\s*${key}\\s*=\\s*)\\d+`, "mi"), `$1${value}`) : body.replace(/^\[options\]\s*$/mi, (line) => `${line}\n${key} = ${value}`));
    if (mods !== undefined) text = set(text, "modsdisabled", mods ? 0 : 1);
    if (scripts !== undefined) text = set(text, "scriptmodsenabled", scripts ? 1 : 0);
    fs.writeFileSync(file, text);
    return simsOptions(loc);
}

/*
 * What went wrong in The Sims 4, newest first: [{ file, time, mods, line }]. Its
 * lastException files hold Python tracebacks, whose paths name the script mods
 * ("Mods\MCCC\mc_cmd_center.ts4script\mc_cmd_center.py").
 */
function simsProblems(loc, since = 0) {
    if (!loc.docsDir) return [];
    let names = [];
    try {
        names = fs.readdirSync(loc.docsDir).filter((name) => /^last(UI)?Exception.*\.txt$/i.test(name));
    } catch {
        return [];
    }
    return names
        .map((name) => ({ name, at: stat(path.join(loc.docsDir, name))?.mtimeMs ?? 0 }))
        .filter((entry) => entry.at > since)
        .sort((a, b) => b.at - a.at)
        .slice(0, 8)
        .map(({ name, at }) => {
            const text = fs.readFileSync(path.join(loc.docsDir, name), "utf8");
            const scripts = [...new Set([...text.matchAll(/([\w .'()+-]+)\.ts4script/gi)].map((m) => m[1].split(/[\\/]/).pop().trim()))];
            const folders = [...new Set([...text.matchAll(/Mods[\\/]+([^\\/\n<>"]+)[\\/]/gi)].map((m) => m[1].trim()))];
            const line = text.match(/(\w*(?:Error|Exception)\b[^\n<]{0,160})/)?.[1]?.trim() ?? null;
            return { file: name, time: new Date(at).toISOString(), mods: [...new Set([...scripts, ...folders])].slice(0, 6), line };
        });
}

/* ---------------- mods most likely to need updating after a game update ---------------- */

/* Mods that change the game's code, by where their files are. */
const CODE_MODS = {
    sims4: (file) => /\.ts4script$/i.test(file),
    gtav: (file) => /\.(asi|dll)$/i.test(file) || /^scripts\//i.test(file),
    skyrimse: (file) => /^Data\/SKSE\/Plugins\/.+\.dll$/i.test(file) || /^skse64_.+\.dll$/i.test(file),
    fallout4: (file) => /^Data\/F4SE\/Plugins\/.+\.dll$/i.test(file) || /^f4se_.+\.dll$/i.test(file),
    cyberpunk2077: (file) => /^(red4ext\/plugins\/|bin\/x64\/plugins\/|r6\/scripts\/)/i.test(file),
    stardew: (file) => /\.dll$/i.test(file),
};

const hooksIntoGame = (gameId, files) => files.some((file) => CODE_MODS[gameId]?.(file));

module.exports = {
    fingerprint,
    rememberPlay,
    updatedSince,
    lastPlayed,
    simsOptions,
    setSimsOptions,
    simsProblems,
    hooksIntoGame,
};
