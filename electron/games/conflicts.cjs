const { getGame } = require("./registry.cjs");
const { readSettings, writeSettings } = require("./storage.cjs");
const store = require("./store.cjs");
const nexus = require("./nexus.cjs");
const requirements = require("./requirements.cjs");

/*
 * Mods that have the same files (a texture, a script, a vehicle), and whose copies should
 * be the ones in the game:
 *  1. the one made for the most of the others wins: it lists them as requirements on Nexus
 *     Mods, or it's their patch ("SkyUI - Survival Patch" over SkyUI);
 *  2. between ones made for as many, the most recently updated (on Nexus, else installed);
 *  3. unless one's been chosen here by hand, which sticks.
 * The copies not used are kept, so a different one can be chosen any time.
 */

const nexusIdOf = (mod) => (mod.source?.provider === "nexus" && mod.source.modId ? String(mod.source.modId) : mod.source?.nexus?.modId ? String(mod.source.nexus.modId) : null);
const simple = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const PATCH = /\b(patch|fix|compat\w*|add-?on|addon|tweak|for)\b/i;

function choices(gameId) {
    return readSettings().conflictChoices?.[gameId] ?? {};
}

/* When each Nexus mod was last updated, and what it requires: { modId: { updated, requires: [ids] } }. */
async function nexusInfo(game, ids) {
    const out = {};
    if (!game.nexus || !ids.length) return out;
    try {
        for (let i = 0; i < ids.length; i += 40) {
            const batch = ids.slice(i, i + 40);
            const data = await nexus.gqlQuery(
                `query($ids: [CompositeDomainWithIdInput!]!, $count: Int) { legacyModsByDomain(ids: $ids, count: $count) { nodes { modId updatedAt } } }`,
                { ids: batch.map((id) => ({ gameDomain: game.nexus, modId: Number(id) })), count: batch.length }
            );
            for (const node of data.legacyModsByDomain.nodes) out[String(node.modId)] = { updated: Date.parse(node.updatedAt) || 0, requires: [] };
        }
        const lists = await requirements.nexusRequirements(game.nexus, ids);
        for (const id of ids) (out[id] ??= { updated: 0, requires: [] }).requires = (lists[id] ?? []).map((r) => r.modId).filter(Boolean);
    } catch {
        // Ranked by when they were installed instead.
    }
    return out;
}

/*
 * The groups of mods sharing files: [{ id, mods: [{ id, name }], files: [paths], live: modId | "mixed",
 * suggested: modId, reason, chosen: boolean }].
 */
async function list(gameId) {
    const game = getGame(gameId);
    const state = store.readState(gameId);
    const shared = store.sharedFiles(gameId);
    if (!shared.length) return [];
    const byId = new Map(state.mods.map((m) => [m.id, m]));
    const groups = new Map();
    for (const entry of shared) {
        const owners = [...entry.owners].sort();
        const id = owners.join("+");
        const group = groups.get(id) ?? { id, owners, files: [], keys: [], lives: new Set() };
        group.files.push(entry.file.to);
        group.keys.push(entry.key);
        group.lives.add(entry.live);
        groups.set(id, group);
    }
    const info = await nexusInfo(game, [...new Set([...groups.values()].flatMap((g) => g.owners.map((o) => nexusIdOf(byId.get(o)))).filter(Boolean))]);
    const chosen = choices(gameId);

    const builtFor = (a, b) => {
        const aId = nexusIdOf(a);
        const bId = nexusIdOf(b);
        if (aId && bId && (info[aId]?.requires ?? []).includes(bId)) return true;
        const an = simple(a.name);
        const bn = simple(b.name);
        return bn.length > 2 && an !== bn && an.includes(bn) && PATCH.test(a.name);
    };
    const updated = (mod) => info[nexusIdOf(mod)]?.updated || Date.parse(mod.installedAt) || 0;

    return [...groups.values()].map((group) => {
        const mods = group.owners.map((id) => byId.get(id)).filter(Boolean);
        let suggested;
        let reason;
        if (chosen[group.id] && mods.some((m) => m.id === chosen[group.id])) {
            suggested = mods.find((m) => m.id === chosen[group.id]);
            reason = "You chose it";
        } else {
            // How many of the others each is made for, then the newest.
            const madeFor = (mod) => mods.filter((other) => other !== mod && builtFor(mod, other)).length;
            const ranked = [...mods].sort((a, b) => madeFor(b) - madeFor(a) || updated(b) - updated(a));
            suggested = ranked[0];
            const over = mods.filter((m) => m !== suggested && builtFor(suggested, m));
            reason = over.length ? `Made for ${over.map((m) => m.name).join(", ")}` : `Updated most recently (${new Date(updated(suggested)).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })})`;
        }
        return {
            id: group.id,
            mods: mods.map((m) => ({ id: m.id, name: m.name })),
            files: group.files,
            keys: group.keys,
            live: group.lives.size === 1 ? [...group.lives][0] : "mixed",
            suggested: suggested.id,
            reason,
            chosen: Boolean(chosen[group.id]),
        };
    });
}

/* Puts the suggested mod's copies in the game wherever they aren't. -> how many files changed. */
async function resolve(gameId) {
    let changed = 0;
    for (const group of await list(gameId)) if (group.live !== group.suggested) changed += store.setWinner(gameId, group.keys, group.suggested);
    return changed;
}

/* A mod chosen by hand for a group: its copies go in, and it's remembered. null forgets the choice. */
async function choose(gameId, groupId, modId) {
    const settings = readSettings();
    settings.conflictChoices ??= {};
    settings.conflictChoices[gameId] ??= {};
    if (modId) settings.conflictChoices[gameId][groupId] = modId;
    else delete settings.conflictChoices[gameId][groupId];
    writeSettings(settings);
    return resolve(gameId);
}

module.exports = { list, resolve, choose };
