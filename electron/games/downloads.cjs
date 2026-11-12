const fs = require("fs");
const os = require("os");
const path = require("path");
const { ARCHIVES, contents } = require("./archive.cjs");

/*
 * What's in Downloads that could be a mod for a game: archives, and the game's own mod
 * files, newest first, so installing what was just downloaded is one click.
 */

const OWN_FILES = {
    sims4: [".package", ".ts4script", ".trayitem", ".blueprint", ".bpi", ".hhi", ".sgi", ".householdbinary", ".room", ".rmi"],
    gtav: [".asi", ".oiv", ".dll"],
    skyrimse: [".esp", ".esm", ".esl"],
    fallout4: [".esp", ".esm", ".esl"],
    cyberpunk2077: [".archive", ".reds"],
    stardew: [],
};

const MAX_AGE = 90 * 24 * 60 * 60 * 1000;

/*
 * Whether what's inside looks like a mod for the game, by the kinds of files each game's
 * mods are made of. A download for another game (or not a mod at all) shouldn't be
 * installed by "Install all new".
 */
const LOOKS_LIKE = {
    sims4: (name) => /\.(package|ts4script|trayitem|blueprint|bpi|hhi|sgi|householdbinary|room|rmi)$/i.test(name),
    gtav: (name) => /\.(asi|oiv|rpf|ytd|yft|ydr|ymap|ytyp)$/i.test(name) || /(^|\/)scripts\/[^/]+\.(dll|cs|vb)$/i.test(name) || /(^|\/)(scripthookv|scripthookvdotnet\d?|dinput8)\.dll$/i.test(name),
    skyrimse: (name) => /\.(esp|esm|esl|bsa)$/i.test(name) || /(^|\/)fomod\/moduleconfig\.xml$/i.test(name) || /(^|\/)(meshes|textures|skse|interface|seq)\//i.test(name),
    fallout4: (name) => /\.(esp|esm|esl|ba2)$/i.test(name) || /(^|\/)fomod\/moduleconfig\.xml$/i.test(name) || /(^|\/)(meshes|textures|f4se|materials|interface)\//i.test(name),
    cyberpunk2077: (name) => /\.(archive|reds|xl)$/i.test(name) || /(^|\/)(r6|red4ext|archive\/pc)\//i.test(name) || /cyber_engine_tweaks|(^|\/)init\.lua$/i.test(name),
    stardew: (name) => /(^|\/)manifest\.json$/i.test(name),
};

const peeked = new Map();

/* true (looks like this game's mod), false (doesn't), or null (can't tell: an archive inside, or unreadable). */
async function fits(gameId, file) {
    const key = `${gameId}:${file.path}:${file.size}:${file.modified}`;
    if (peeked.has(key)) return peeked.get(key);
    let answer = null;
    try {
        const names = await contents(file.path);
        if (names.some((name) => LOOKS_LIKE[gameId]?.(name))) answer = true;
        else if (names.some((name) => ARCHIVES.includes(path.extname(name).toLowerCase()))) answer = null;
        else answer = false;
    } catch {
        answer = null;
    }
    peeked.set(key, answer);
    return answer;
}

/* [{ path, name, size, modified, fits }] from the Downloads folder (and one folder down). */
async function recent(gameId) {
    const root = path.join(os.homedir(), "Downloads");
    const wanted = new Set([...ARCHIVES, ...(OWN_FILES[gameId] ?? [])]);
    const found = [];
    const look = (dir, depth) => {
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith(".")) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (depth < 1) look(full, depth + 1);
                continue;
            }
            if (!wanted.has(path.extname(entry.name).toLowerCase())) continue;
            let info;
            try {
                info = fs.statSync(full);
            } catch {
                continue;
            }
            if (Date.now() - info.mtimeMs > MAX_AGE) continue;
            found.push({ path: full, name: entry.name, size: info.size, modified: new Date(info.mtimeMs).toISOString() });
        }
    };
    look(root, 0);
    const newest = found.sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 60);
    // A few at a time: listing a big .7z takes a moment.
    for (let i = 0; i < newest.length; i += 4) {
        await Promise.all(newest.slice(i, i + 4).map(async (file) => (file.fits = await fits(gameId, file))));
    }
    return newest;
}

module.exports = { recent };
