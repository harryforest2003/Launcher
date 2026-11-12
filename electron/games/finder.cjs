const path = require("path");
const { getGame } = require("./registry.cjs");
const { locate } = require("./detect.cjs");
const { readSettings, writeSettings } = require("./storage.cjs");
const store = require("./store.cjs");
const plugins = require("./plugins.cjs");

/*
 * Finding the mod that breaks a game, the "50/50" way: first everything off, to check
 * it's a mod at all; then half the suspects off at a time, playing and saying whether the
 * problem happened, until one is left. About 1 + log2(n) plays: 7 for 60 mods.
 *
 * A plugin is never left on while a master it needs is off (that crashes the game for a
 * different reason), so the suspects are ordered with masters first and each round turns
 * off the second half: whatever needs something turned off is turned off with it.
 *
 * It's kept in the launcher's settings, so it survives closing the app; Stop puts
 * everything back as it was.
 */

const nameOf = (key, mods) => mods.find((m) => m.key === key)?.name ?? key;

/* The plugins each mod in the list provides and needs, to keep masters before what needs them. */
function pluginLinks(game, loc, mods) {
    const provides = new Map();
    const needs = new Map();
    if (!game.bethesda || !loc.gameDir) return { provides, needs };
    const data = path.join(loc.gameDir, "Data");
    const state = store.readState(game.id);
    for (const mod of mods) {
        let names = [];
        if (mod.key.startsWith("m:")) names = state.mods.find((m) => `m:${m.id}` === mod.key)?.plugins ?? [];
        else if (mod.key.startsWith("p:")) names = [path.posix.basename(mod.key.split(":").slice(2).join(":"))];
        provides.set(mod.key, names.map((n) => n.toLowerCase()));
        const masters = names.flatMap((name) => plugins.header(path.join(data, name))?.masters ?? []).map((n) => n.toLowerCase());
        needs.set(mod.key, masters);
    }
    return { provides, needs };
}

/* The suspects ordered so each comes after the ones it needs. */
function ordered(keys, links) {
    const byPlugin = new Map();
    for (const key of keys) for (const plugin of links.provides.get(key) ?? []) byPlugin.set(plugin, key);
    const out = [];
    const placed = new Set();
    const visiting = new Set();
    const place = (key) => {
        if (placed.has(key) || visiting.has(key)) return;
        visiting.add(key);
        for (const master of links.needs.get(key) ?? []) {
            const provider = byPlugin.get(master);
            if (provider && provider !== key && keys.includes(provider)) place(provider);
        }
        visiting.delete(key);
        placed.add(key);
        out.push(key);
    };
    keys.forEach(place);
    return out;
}

/* Turns each mod on or off to match `on` (a set of keys), among the ones being tested. */
function apply(gameId, keys, on) {
    const current = new Map(store.list(gameId).mods.map((m) => [m.key, m.enabled]));
    // Off first, then on, so masters are back before what needs them.
    for (const key of keys) if (current.get(key) && !on.has(key)) store.setModEnabled(gameId, key, false);
    for (const key of keys) if (current.has(key) && !current.get(key) && on.has(key)) store.setModEnabled(gameId, key, true);
}

function read(gameId) {
    return readSettings().finder?.[gameId] ?? null;
}

function save(gameId, finder) {
    const settings = readSettings();
    settings.finder ??= {};
    if (finder) settings.finder[gameId] = finder;
    else delete settings.finder[gameId];
    writeSettings(settings);
}

/* Sets up a round: the first half of the suspects on, the rest off. */
function setRound(gameId, finder) {
    const half = Math.ceil(finder.suspects.length / 2);
    finder.testing = finder.suspects.slice(0, half);
    const on = new Set([...finder.cleared.filter((key) => finder.clearedOn.includes(key)), ...finder.testing]);
    apply(gameId, finder.all, on);
    finder.round += 1;
}

/*
 * Where it's got to, for the page:
 * { active, phase: "baseline"|"split"|"found"|"not-mods", round, roundsLeft, suspects, testing, found, names }
 */
function status(gameId) {
    const finder = read(gameId);
    if (!finder) return { active: false };
    const mods = store.list(gameId).mods;
    const names = (keys) => keys.map((key) => nameOf(key, mods));
    return {
        active: true,
        phase: finder.phase,
        round: finder.round,
        roundsLeft: finder.phase === "split" ? Math.ceil(Math.log2(Math.max(finder.suspects.length, 1))) : finder.phase === "baseline" ? Math.ceil(Math.log2(Math.max(finder.suspects.length, 1))) + 1 : 0,
        suspects: names(finder.suspects),
        testing: names(finder.testing),
        off: names(finder.all.filter((key) => !finder.testing.includes(key) && !(finder.cleared.includes(key) && finder.clearedOn.includes(key)))),
        found: finder.found ? nameOf(finder.found, mods) : null,
        foundKey: finder.found,
        total: finder.all.length,
    };
}

/* Starts with every mod that's on as a suspect, and turns them all off to check it's a mod at all. */
function start(gameId) {
    if (read(gameId)) throw new Error("Already finding a broken mod: carry on or stop that first.");
    const game = getGame(gameId);
    const loc = locate(gameId);
    const mods = store.list(gameId).mods;
    const on = mods.filter((m) => m.enabled);
    if (on.length < 1) throw new Error("No mods are on, so none can be breaking the game.");
    const links = pluginLinks(game, loc, on);
    const all = ordered(on.map((m) => m.key), links);
    const finder = {
        startedAt: new Date().toISOString(),
        original: Object.fromEntries(mods.map((m) => [m.key, m.enabled])),
        all,
        suspects: all,
        cleared: [],
        clearedOn: [],
        testing: [],
        round: 0,
        phase: "baseline",
        found: null,
    };
    apply(gameId, all, new Set());
    save(gameId, finder);
    return status(gameId);
}

/* After playing: whether the problem happened. Narrows the suspects and sets up the next round. */
function answer(gameId, happened) {
    const finder = read(gameId);
    if (!finder) throw new Error("Not finding a broken mod at the moment.");
    if (finder.phase === "baseline") {
        if (happened) {
            // With every mod off it still happens: it isn't one of them.
            finder.phase = "not-mods";
            save(gameId, finder);
            return status(gameId);
        }
        finder.phase = "split";
    } else if (finder.phase === "split") {
        const rest = finder.suspects.filter((key) => !finder.testing.includes(key));
        if (happened) {
            // It's among the ones on; the rest were off, and stay off.
            finder.cleared.push(...rest);
            finder.suspects = finder.testing;
        } else {
            // It's among the ones off; the ones on are fine, and stay on.
            finder.cleared.push(...finder.testing);
            finder.clearedOn.push(...finder.testing);
            finder.suspects = rest;
        }
    } else {
        throw new Error("The finder has finished: keep its answer or put everything back.");
    }
    if (finder.suspects.length === 1) {
        finder.phase = "found";
        finder.found = finder.suspects[0];
        finder.testing = [];
        save(gameId, finder);
        return status(gameId);
    }
    if (finder.suspects.length === 0) {
        finder.phase = "not-mods";
        save(gameId, finder);
        return status(gameId);
    }
    setRound(gameId, finder);
    save(gameId, finder);
    return status(gameId);
}

/* Stops: every mod back as it was, except (if given) the broken one, left off. */
function stop(gameId, { keepOff = null } = {}) {
    const finder = read(gameId);
    if (!finder) return { active: false };
    const on = new Set(Object.entries(finder.original).filter(([key, enabled]) => enabled && key !== keepOff).map(([key]) => key));
    apply(gameId, finder.all, on);
    save(gameId, null);
    return { active: false, keptOff: keepOff ? nameOf(keepOff, store.list(gameId).mods) : null };
}

module.exports = { start, answer, stop, status, ordered, read };
