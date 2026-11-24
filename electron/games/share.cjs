const store = require("./store.cjs");
const shareCodes = require("../shareCodes.cjs");

/*
 * A game's mod list as a share code: each mod by the site and ID it came from, so a
 * friend's launcher can fetch the same ones. Mods added by hand can't be fetched, so
 * only their names go along.
 */

// Where a mod can be fetched from again: [provider, mod ID, file ID] or null.
function whereFrom(source) {
    if (!source) return null;
    if (source.provider && !["file", "hand", "url"].includes(source.provider) && source.modId) {
        return [source.provider, String(source.modId), source.fileId != null ? String(source.fileId) : ""];
    }
    // A file from Nexus added by hand is still known by its Nexus ID.
    if (source.nexus?.modId) return ["nexus", String(source.nexus.modId), source.nexus.fileId != null ? String(source.nexus.fileId) : ""];
    return null;
}

function gameShareCode(gameId) {
    const mods = store.list(gameId).mods.filter((mod) => mod.enabled);
    const shared = [];
    const missing = [];
    for (const mod of mods) {
        const from = mod.managed ? whereFrom(mod.source) : null;
        if (from) shared.push([...from, String(mod.name ?? "").slice(0, 120)]);
        else missing.push(String(mod.name ?? "").slice(0, 120));
    }
    const data = { k: "game", g: gameId, m: shared };
    if (missing.length) data.x = missing;
    return { code: shareCodes.encode(data), linked: shared.length, missing };
}

/* A pasted code, with each mod marked if this game has it already. */
function readGameShareCode(gameId, code) {
    const shared = shareCodes.decode(code);
    if (shared.kind !== "game") throw new Error("That code is a Minecraft instance. Paste it under Minecraft, in Import.");
    if (shared.gameId !== gameId) throw new Error(`That code is a mod list for another game (${shared.gameId}).`);
    const have = new Set(
        store
            .list(gameId)
            .mods.map((mod) => whereFrom(mod.source))
            .filter(Boolean)
            .map(([provider, modId]) => `${provider}:${modId}`)
    );
    return {
        mods: shared.mods.map((mod) => ({ ...mod, installed: have.has(`${mod.provider}:${mod.modId}`) })),
        missing: shared.missing,
    };
}

module.exports = { gameShareCode, readGameShareCode };
