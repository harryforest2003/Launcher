const { hasSecret } = require("../../secrets.cjs");
const { openExternalChecked } = require("../../security.cjs");
const { installFromUrl } = require("../remote.cjs");
const store = require("../store.cjs");

/*
 * The mod sites beyond Nexus Mods and CurseForge. Each knows which games it has mods
 * for, searches them, and gives a mod's file (or, for the Workshop, the Steam page to
 * subscribe on). Keys are the player's own, optional ones from Settings; the Workshop
 * can also go through the launcher's host, which holds a Steam key of its own.
 *
 * Primary sites are mixed into a game's "Any site" results. GameBanana isn't (its skins
 * and sound packs would crowd out the mods), unless the game has nothing else.
 */

const PROVIDERS = [
    require("./thunderstore.cjs"),
    require("./modio.cjs"),
    require("./workshop.cjs"),
    require("./factorio.cjs"),
    require("./spacedock.cjs"),
    require("./beatmods.cjs"),
    require("./gamebanana.cjs"),
    require("./modworkshop.cjs"),
    require("./ficsit.cjs"),
    require("./vintagestory.cjs"),
    require("./contentdb.cjs"),
    require("./idgames.cjs"),
];
const BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

const isSource = (id) => BY_ID.has(id);

/* Whether a site that needs a key can be used: the player added one, or the host stands in. */
async function usable(provider) {
    if (!provider.needsKey || hasSecret(provider.needsKey)) return true;
    try {
        return Boolean(await provider.viaHost?.());
    } catch {
        return false;
    }
}
const labelOf = (id) => BY_ID.get(id)?.label ?? id;

function need(id) {
    const provider = BY_ID.get(id);
    if (!provider) throw new Error(`"${id}" isn't a mod site the launcher knows.`);
    return provider;
}

/*
 * The sites with mods for a game: [{ id, label, primary, ready, needsKey, page }], page being
 * the game's own page there. One that needs
 * a key the player hasn't added is listed (not ready) only where it surely applies: the
 * Workshop, for a Steam game. A site that can't be reached is left out this time.
 */
async function forGame(game) {
    const found = await Promise.all(
        PROVIDERS.map(async (provider) => {
            const entry = { id: provider.id, label: provider.label, primary: provider.primary, needsKey: provider.needsKey ?? provider.keyOptional ?? null };
            if (!(await usable(provider))) {
                const appId = game.steamAppIds?.[0];
                return provider.id === "workshop" && appId ? { ...entry, ready: false, page: provider.home({ appId }) } : null;
            }
            try {
                const ctx = await provider.supports(game);
                return ctx ? { ...entry, ready: true, page: provider.home?.(ctx) ?? provider.site ?? null } : null;
            } catch {
                return null;
            }
        }),
    );
    return found.filter(Boolean);
}

async function contextOf(provider, game) {
    if (!(await usable(provider))) {
        const err = new Error(`Add your ${provider.id === "workshop" ? "Steam Web API" : provider.label} key in Settings → API keys to use ${provider.label}.`);
        err.code = "NEEDS_KEY";
        throw err;
    }
    const ctx = await provider.supports(game);
    if (!ctx) throw new Error(`${provider.label} has no mods for ${game.name}.`);
    return ctx;
}

/* A page of one site's mods for a game: { total, mods, perPage }. */
async function search(game, id, options) {
    const provider = need(id);
    return provider.search(await contextOf(provider, game), options);
}

async function details(game, id, modId) {
    const provider = need(id);
    return { provider: id, ...(await provider.details(await contextOf(provider, game), String(modId))) };
}

const installedFrom = (gameId, provider, modId) =>
    store.readState(gameId).mods.some((mod) => mod.source?.provider === provider && String(mod.source?.modId) === String(modId));

// Enough for any real mod's requirements; stops a loop of them.
const MOST_REQUIREMENTS = 25;

/*
 * Downloads a mod and installs it, with what it needs from the same site first (those
 * already in are left be). -> an install result, plus requirements: the names put in.
 * The Workshop: its page opens in Steam, -> { viaSteam }.
 */
async function install(game, id, modId, fileId, name, progress, seen = new Set([String(modId)])) {
    const provider = need(id);
    const ctx = await contextOf(provider, game);
    const got = await provider.download(ctx, String(modId), fileId ? String(fileId) : null);
    if (got.steam) {
        await openExternalChecked(got.steam, { steam: true });
        return { viaSteam: true, opened: got.page, reason: "Opened in Steam: press Subscribe there and Steam downloads it, then keeps it up to date." };
    }
    const requirements = [];
    const notes = [];
    for (const dep of got.requires ?? []) {
        const depId = String(dep.modId);
        if (seen.has(depId) || seen.size >= MOST_REQUIREMENTS) continue;
        seen.add(depId);
        if (installedFrom(game.id, id, depId)) continue;
        try {
            const result = await install(game, id, depId, null, dep.name, progress, seen);
            if (result.mod) requirements.push(result.mod.name, ...(result.requirements ?? []));
            notes.push(...(result.notes ?? []));
        } catch (err) {
            notes.push(`${dep.name}, which it needs, didn't install: ${err.message}`);
        }
    }
    const result = await installFromUrl(
        game,
        got.url,
        { name: String(name || got.name), source: { provider: id, modId: String(modId), fileId: got.fileId ? String(got.fileId) : undefined, version: got.version || undefined } },
        progress,
        { sha1: got.sha1, md5: got.md5, fileName: got.fileName },
    );
    if (requirements.length) result.requirements = requirements;
    if (requirements.length) notes.unshift(`Also installed what it needs: ${requirements.join(", ")}.`);
    if (notes.length) result.notes = [...(result.notes ?? []), ...notes];
    return result;
}

/* The newest file of an installed mod: { fileId, version, date, size } or null. */
async function latest(game, id, modId) {
    const provider = need(id);
    if (!provider.latest) return null;
    return provider.latest(await contextOf(provider, game), String(modId));
}

module.exports = { PROVIDERS, isSource, labelOf, forGame, search, details, install, latest };
