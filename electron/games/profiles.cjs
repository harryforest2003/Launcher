const { getGame } = require("./registry.cjs");
const { locate } = require("./detect.cjs");
const { readSettings, writeSettings } = require("./storage.cjs");
const profileSaves = require("./profileSaves.cjs");

/*
 * Mod profiles: several setups of one game's mods ("Story", "Build mode", "Vanilla+").
 * Every mod belongs to one or more profiles, and only the chosen profile's mods are in the
 * game's mods folder; the rest wait in the launcher's own folder until their profile is
 * picked. Mods installed while a profile is chosen go in that profile.
 *
 *   settings.profiles[gameId] = { active, savesHere, list: [{ id, name, keys: [mod keys], on: [keys turned on when last left] }] }
 *
 * Each profile has its own saves too (profileSaves.cjs), unless that's turned off.
 */

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const store = () => require("./store.cjs"); // store.cjs loads this file: required when used.

function read(gameId) {
    return readSettings().profiles?.[gameId] ?? null;
}

function write(gameId, data) {
    const settings = readSettings();
    settings.profiles ??= {};
    if (data) settings.profiles[gameId] = data;
    else delete settings.profiles[gameId];
    writeSettings(settings);
    return data;
}

/*
 * The game's profiles, with the mods put right: a mod in no profile (just installed, or
 * added by hand in the folder) joins the chosen one, and uninstalled mods leave them all.
 * Null while the game has only its one unnamed setup.
 */
function current(gameId, mods = store().list(gameId).mods) {
    const data = read(gameId);
    if (!data) return null;
    const keys = new Set(mods.map((mod) => mod.key));
    const active = data.list.find((p) => p.id === data.active) ?? data.list[0];
    data.active = active.id;
    let changed = false;
    for (const profile of data.list) {
        // Hand-added files can be missing for a while (the folder moved): only managed mods go.
        const kept = profile.keys.filter((key) => keys.has(key) || !key.startsWith("m:"));
        if (kept.length !== profile.keys.length) {
            profile.keys = kept;
            profile.on = profile.on.filter((key) => kept.includes(key));
            changed = true;
        }
    }
    const anywhere = new Set(data.list.flatMap((p) => p.keys));
    for (const mod of mods) {
        if (anywhere.has(mod.key)) continue;
        active.keys.push(mod.key);
        changed = true;
    }
    if (changed) write(gameId, data);
    return data;
}

/* Mods only other profiles have: kept out of the game's folder while this one is chosen. */
function outside(data) {
    if (!data) return new Set();
    const active = data.list.find((p) => p.id === data.active);
    const mine = new Set(active?.keys ?? []);
    return new Set(data.list.flatMap((p) => p.keys).filter((key) => !mine.has(key)));
}

/*
 * For the page: the profiles, which is chosen, and the mods in each. A mod of another
 * profile that's been turned on anyway (an update installs it turned on) goes back out of
 * the game's folder, on in its own profile for when that's picked.
 */
function list(gameId) {
    let mods = store().list(gameId).mods;
    const data = current(gameId, mods);
    // pending: the chosen profile's saves aren't all back in the game's folder (a switch cut short).
    const saves = { on: profileSaves.isOn(gameId), folder: profileSaves.folder(gameId), pending: Boolean(data && profileSaves.pending(gameId, data, data.active)) };
    if (!data) return { active: null, profiles: [], turnedOff: 0, saves };
    const away = outside(data);
    const strays = mods.filter((mod) => mod.enabled && away.has(mod.key));
    if (strays.length) {
        for (const profile of data.list) {
            for (const mod of strays) if (profile.keys.includes(mod.key) && !profile.on.includes(mod.key)) profile.on.push(mod.key);
        }
        write(gameId, data);
        for (const mod of strays) {
            try {
                store().setModEnabled(gameId, mod.key, false);
            } catch {
                // Left on: shown as on in its own profile's list.
            }
        }
        mods = store().list(gameId).mods;
    }
    const have = new Set(mods.map((mod) => mod.key));
    return {
        active: data.active,
        profiles: data.list.map((p) => ({ id: p.id, name: p.name, keys: p.keys.filter((key) => have.has(key)) })),
        turnedOff: strays.length,
        saves,
    };
}

const cleanName = (name) => {
    const clean = String(name ?? "").trim().slice(0, 40);
    if (!clean) throw new Error("A profile needs a name.");
    return clean;
};

/* The first time: what's installed now becomes "Default", and the new one is made beside it. */
function ensure(gameId, mods) {
    const data = current(gameId, mods);
    if (data) return data;
    const id = newId();
    return { active: id, list: [{ id, name: "Default", keys: mods.map((m) => m.key), on: [] }] };
}

/*
 * A new profile: empty, or a copy of another (its mods, turned on the same; copyOf is its
 * ID, or "active"). Not chosen
 * yet: pick it to switch the game over.
 */
function create(gameId, { name, copyOf = null }) {
    const mods = store().list(gameId).mods;
    const data = ensure(gameId, mods);
    const clean = cleanName(name);
    if (data.list.some((p) => p.name.toLowerCase() === clean.toLowerCase())) throw new Error(`There's already a profile called ${clean}.`);
    // "active": the chosen one, which on the first time is the Default just made.
    const fromId = copyOf === "active" ? data.active : copyOf;
    const from = fromId && data.list.find((p) => p.id === fromId);
    const on = from ? (from.id === data.active ? mods.filter((m) => m.enabled && from.keys.includes(m.key)).map((m) => m.key) : from.on) : [];
    const profile = { id: newId(), name: clean, keys: from ? [...from.keys] : [], on: [...on] };
    // A copy starts with a copy of the saves too; an empty one with none.
    if (from) profileSaves.copy(gameId, data, from.id, profile.id);
    data.list.push(profile);
    write(gameId, data);
    return { ...list(gameId), created: profile.id };
}

function rename(gameId, id, name) {
    const data = current(gameId);
    const profile = data?.list.find((p) => p.id === id);
    if (!profile) throw new Error("That profile isn't there any more.");
    const clean = cleanName(name);
    if (data.list.some((p) => p.id !== id && p.name.toLowerCase() === clean.toLowerCase())) throw new Error(`There's already a profile called ${clean}.`);
    profile.name = clean;
    write(gameId, data);
    return list(gameId);
}

/*
 * Deletes a profile, not its mods: ones only it had join the chosen profile, turned off,
 * to delete or keep from there. The last profile left goes too, back to one setup.
 */
function remove(gameId, id) {
    const data = current(gameId);
    if (!data) return list(gameId);
    if (id === data.active && data.list.length > 1) throw new Error("Pick another profile before deleting this one.");
    const gone = data.list.find((p) => p.id === id);
    data.list = data.list.filter((p) => p.id !== id);
    if (!data.list.length) {
        // Back to one setup: saves still waiting to go in (a switch cut short) go in.
        profileSaves.unstash(gameId, id);
        write(gameId, null);
        return list(gameId);
    }
    // Its saves are kept as a save backup.
    if (gone) profileSaves.retire(gameId, gone.id, gone.name);
    const active = data.list.find((p) => p.id === data.active);
    const anywhere = new Set(data.list.flatMap((p) => p.keys));
    for (const key of gone?.keys ?? []) if (!anywhere.has(key)) active.keys.push(key);
    write(gameId, data);
    return list(gameId);
}

/* Puts a mod in a profile too, or takes it out of one (it stays installed). */
function setMember(gameId, id, key, member) {
    const data = current(gameId);
    const profile = data?.list.find((p) => p.id === id);
    if (!profile) throw new Error("That profile isn't there any more.");
    if (member) {
        if (!profile.keys.includes(key)) profile.keys.push(key);
    } else {
        if (data.list.filter((p) => p.keys.includes(key)).length <= 1) throw new Error("A mod has to be in at least one profile. Delete it to remove it.");
        profile.keys = profile.keys.filter((k) => k !== key);
        profile.on = profile.on.filter((k) => k !== key);
    }
    write(gameId, data);
    // Taken out of the chosen profile: out of the game's folder too.
    if (!member && profile.id === data.active) {
        const mod = store().list(gameId).mods.find((m) => m.key === key);
        if (mod?.enabled) store().setModEnabled(gameId, key, false);
    }
    return list(gameId);
}

const gameOpen = (gameId) => require("./running.cjs").gameOpen(gameId);

/*
 * Switches the game to another profile: what the chosen one has on is remembered, its
 * mods leave the game's folder, and the other's mods that were on go back in.
 */
async function use(gameId, id) {
    const data = current(gameId);
    const target = data?.list.find((p) => p.id === id);
    if (!target) throw new Error("That profile isn't there any more.");
    if (data.active === id && !profileSaves.pending(gameId, data, id)) return { ...list(gameId), changed: 0, problems: [] };
    if (await gameOpen(gameId)) throw new Error("Close the game before switching profiles: it reads its mods while it runs.");

    // The saves first: the ones in the game's folder go away with the profile they're from,
    // and the chosen profile's come back. A switch cut short is finished by picking it again.
    profileSaves.stash(gameId, data);
    data.savesHere = target.id;
    if (data.active === id) {
        write(gameId, data);
        const problems = profileSaves.unstash(gameId, id);
        return { ...list(gameId), changed: 0, problems };
    }

    const mods = store().list(gameId).mods;
    const leaving = data.list.find((p) => p.id === data.active);
    if (leaving) leaving.on = mods.filter((m) => m.enabled && leaving.keys.includes(m.key)).map((m) => m.key);
    // Remembered first, so a switch cut short can be finished by picking the profile again.
    data.active = target.id;
    write(gameId, data);
    const problems = profileSaves.unstash(gameId, target.id);

    const want = new Set(target.on.filter((key) => target.keys.includes(key)));
    let changed = 0;
    // Off first, so files two profiles' mods share end up with the one going in.
    const order = [...mods.filter((m) => m.enabled && !want.has(m.key)), ...mods.filter((m) => !m.enabled && want.has(m.key))];
    for (const mod of order) {
        try {
            store().setModEnabled(gameId, mod.key, want.has(mod.key));
            changed += 1;
        } catch (err) {
            problems.push(`${mod.name}: ${err.message}`);
        }
    }
    return { ...list(gameId), changed, problems };
}

/* A mod's key changed (an update installs it afresh): its profiles follow it. */
function renameKey(gameId, from, to) {
    const data = read(gameId);
    if (!data || !data.list.some((p) => p.keys.includes(from))) return;
    for (const profile of data.list) {
        profile.keys = profile.keys.map((k) => (k === from ? to : k));
        profile.on = profile.on.map((k) => (k === from ? to : k));
    }
    write(gameId, data);
}

/*
 * Turns separate saves for each profile on or off. Turned on, the saves in the game's folder
 * now count as the chosen profile's; turned off, other profiles' saves stay in the
 * launcher's folder until it's turned back on.
 */
function setSaves(gameId, on) {
    profileSaves.setOn(gameId, on);
    const data = read(gameId);
    if (on && data) {
        data.savesHere = data.active;
        write(gameId, data);
        // Saves put away under it before this was turned off go back in (ones already there stay).
        profileSaves.unstash(gameId, data.active);
    }
    return list(gameId);
}

/* Keys of mods that belong only to profiles that aren't chosen. */
const hiddenKeys = (gameId) => outside(current(gameId));

module.exports = { list, create, rename, remove, setMember, use, renameKey, hiddenKeys, setSaves };
