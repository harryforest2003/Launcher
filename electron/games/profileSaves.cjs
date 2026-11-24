const fs = require("fs");
const path = require("path");
const { getGame } = require("./registry.cjs");
const { locate } = require("./detect.cjs");
const { dataDir, readSettings, writeSettings } = require("./storage.cjs");
const saves = require("./saves.cjs");

/*
 * Each mod profile's own saves. Switching profiles moves the saves in the game's saves
 * folder into the launcher's folder, under the profile they were made with, and moves the
 * chosen profile's back in, so a save made with one set of mods isn't loaded (and broken)
 * with another. On unless turned off for the game:
 *
 *   settings.profileSaves[gameId] = false   turned off
 *   profiles data.savesHere                 the profile whose saves are in the game's folder
 *   <data>/<game>/profile-saves/<profile>/  the others' saves
 */

const SKIP = /^(steam_autocloud\.vdf|desktop\.ini|\.ds_store|thumbs\.db)$/i;

const root = (gameId) => path.join(dataDir(), gameId, "profile-saves");
const stashOf = (gameId, profileId) => path.join(root(gameId), profileId);

const isOn = (gameId) => readSettings().profileSaves?.[gameId] !== false;

function setOn(gameId, on) {
    const settings = readSettings();
    settings.profileSaves ??= {};
    if (on) delete settings.profileSaves[gameId];
    else settings.profileSaves[gameId] = false;
    writeSettings(settings);
}

/* The game's saves folder, or null when it hasn't made one (or isn't found). */
function folder(gameId) {
    const game = getGame(gameId);
    if (!game) return null;
    try {
        return saves.savesDir(game, locate(gameId));
    } catch {
        return null;
    }
}

const entries = (dir) => {
    try {
        return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => !SKIP.test(entry.name));
    } catch {
        return [];
    }
};

/*
 * What in a saves folder is a save, as paths inside it. Only the saves move: GTA V's
 * Profiles folders also hold its settings, and Cyberpunk's and Stardew's folders hold a
 * folder per save beside files that aren't saves.
 */
function savesIn(gameId, dir) {
    if (!dir) return [];
    if (gameId === "gtav") {
        return entries(dir)
            .filter((entry) => entry.isDirectory())
            .flatMap((profile) =>
                entries(path.join(dir, profile.name))
                    .filter((file) => file.isFile() && /^SGTA/i.test(file.name))
                    .map((file) => `${profile.name}/${file.name}`)
            );
    }
    if (gameId === "cyberpunk2077" || gameId === "stardew") return entries(dir).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    return entries(dir).map((entry) => entry.name);
}

function move(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
        fs.renameSync(from, to);
    } catch (err) {
        // On another drive: copied, then removed.
        if (err.code !== "EXDEV") throw err;
        fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
        fs.rmSync(from, { recursive: true, force: true });
    }
}

const holderOf = (data) => data.savesHere ?? data.active;

/* Whether picking this profile (already chosen) still has saves to move: a switch cut short. */
function pending(gameId, data, profileId) {
    if (!isOn(gameId)) return false;
    return holderOf(data) !== profileId || savesIn(gameId, stashOf(gameId, profileId)).length > 0;
}

/*
 * Puts the saves in the game's folder away under the profile they belong to. All or none:
 * if one can't move, the ones moved go back and this throws, so the game's folder never
 * has half of a profile's saves.
 */
function stash(gameId, data) {
    if (!isOn(gameId)) return;
    const dir = folder(gameId);
    const holder = holderOf(data);
    if (!dir || !holder) return;
    const moved = [];
    try {
        for (const rel of savesIn(gameId, dir)) {
            const to = path.join(stashOf(gameId, holder), rel);
            // Left from before (shouldn't happen): kept aside, not overwritten.
            if (fs.existsSync(to)) move(to, path.join(root(gameId), "_older", new Date().toISOString().replace(/[:.]/g, "-"), holder, rel));
            move(path.join(dir, rel), to);
            moved.push(rel);
        }
    } catch (err) {
        for (const rel of moved.reverse()) {
            try {
                move(path.join(stashOf(gameId, holder), rel), path.join(dir, rel));
            } catch {
                // Still in the launcher's folder, under the profile: picking it again brings it back.
            }
        }
        throw new Error(`Your saves couldn't be put away, so nothing was switched: ${err.message}`);
    }
}

/* Moves a profile's saves into the game's folder. -> problems (ones left in the launcher's folder). */
function unstash(gameId, profileId) {
    if (!isOn(gameId)) return [];
    const from = stashOf(gameId, profileId);
    const waiting = savesIn(gameId, from);
    if (!waiting.length) return [];
    const dir = folder(gameId);
    if (!dir) return [`This profile's saves are in ${from}: the game's saves folder wasn't found to put them in.`];
    const problems = [];
    for (const rel of waiting) {
        const to = path.join(dir, rel);
        if (fs.existsSync(to)) {
            problems.push(`${rel} is in the game's saves folder already, so this profile's copy stayed in ${from}.`);
            continue;
        }
        try {
            move(path.join(from, rel), to);
        } catch (err) {
            problems.push(`${rel}: ${err.message}`);
        }
    }
    if (!problems.length) fs.rmSync(from, { recursive: true, force: true });
    return problems;
}

/* A copy of a profile gets a copy of its saves. */
function copy(gameId, data, fromId, toId) {
    if (!isOn(gameId)) return;
    const live = fromId === holderOf(data);
    const dir = live ? folder(gameId) : stashOf(gameId, fromId);
    for (const rel of savesIn(gameId, dir)) fs.cpSync(path.join(dir, rel), path.join(stashOf(gameId, toId), rel), { recursive: true });
}

/*
 * A deleted profile's saves become a save backup (one that isn't cleared out with the old
 * ones), so they can be put back from the saves list.
 */
function retire(gameId, profileId, name) {
    const from = stashOf(gameId, profileId);
    const files = savesIn(gameId, from);
    if (!files.length) {
        fs.rmSync(from, { recursive: true, force: true });
        return null;
    }
    const at = new Date();
    const id = `${at.toISOString().replace(/[:.]/g, "-")}-${profileId}`;
    const backups = saves.backupsDir(gameId);
    fs.mkdirSync(backups, { recursive: true });
    move(from, path.join(backups, id));
    const { size, files: count } = saves.folderSize(path.join(backups, id));
    const entry = { id, at: at.toISOString(), reason: `Saves of the ${name} profile, which was deleted`, size, files: count, from: folder(gameId), keep: true };
    fs.writeFileSync(path.join(backups, `${id}.json`), JSON.stringify(entry, null, 2));
    return entry;
}

module.exports = { isOn, setOn, folder, pending, stash, unstash, copy, retire, holderOf };
