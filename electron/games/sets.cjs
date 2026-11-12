const { readSettings, writeSettings } = require("./storage.cjs");

/*
 * Named sets of a game's mods ("Gameplay", "Build only"), to show just those in the list,
 * or turn on just those. Kept by each mod's key in the list.
 */

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function list(gameId) {
    return readSettings().sets?.[gameId] ?? [];
}

function write(gameId, sets) {
    const settings = readSettings();
    settings.sets ??= {};
    settings.sets[gameId] = sets;
    writeSettings(settings);
    return sets;
}

/* Adds a set, or renames one. -> the sets. */
function save(gameId, { id = null, name }) {
    const clean = String(name ?? "").trim().slice(0, 40);
    if (!clean) throw new Error("A set needs a name.");
    const sets = list(gameId);
    const clash = sets.find((set) => set.name.toLowerCase() === clean.toLowerCase() && set.id !== id);
    if (clash) throw new Error(`There's already a set called ${clash.name}.`);
    const existing = id && sets.find((set) => set.id === id);
    if (existing) existing.name = clean;
    else sets.push({ id: newId(), name: clean, keys: [] });
    return write(gameId, sets);
}

function remove(gameId, id) {
    return write(gameId, list(gameId).filter((set) => set.id !== id));
}

/* Puts a mod in a set, or takes it out. */
function setMember(gameId, id, key, member) {
    const sets = list(gameId);
    const set = sets.find((s) => s.id === id);
    if (!set) throw new Error("That set isn't there any more.");
    set.keys = member ? [...new Set([...set.keys, key])] : set.keys.filter((k) => k !== key);
    return write(gameId, sets);
}

/* A mod's key changed (an update installs it afresh): its sets follow it. */
function renameKey(gameId, from, to) {
    const sets = list(gameId);
    if (!sets.some((set) => set.keys.includes(from))) return;
    for (const set of sets) set.keys = set.keys.map((k) => (k === from ? to : k));
    write(gameId, sets);
}

module.exports = { list, save, remove, setMember, renameKey };
