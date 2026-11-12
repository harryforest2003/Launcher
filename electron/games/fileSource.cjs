const nexus = require("./nexus.cjs");

/*
 * Which Nexus Mods mod (and file) has a given file, such as a master plugin another plugin
 * needs: Nexus can search what's inside every mod's files (no key needed). A file turns up
 * in re-uploads and bundles too, so the mod chosen is one the needing mod's own Nexus page
 * lists as a requirement, or else the most endorsed one whose name matches the file's.
 * -> { modId, fileId, modName, fileName, version } or null.
 */

const found = new Map();

const words = (text) =>
    String(text)
        .replace(/\.(esp|esm|esl|bsa|ba2|dll)$/i, "")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w && !["se", "ae", "sse", "esp", "esm", "esl", "the", "of", "and", "for", "a"].includes(w));

/* How much of the file's name is in the mod's: 0 to 1. */
function likeness(fileName, modName) {
    const want = words(fileName);
    if (!want.length) return 0;
    const have = new Set(words(modName));
    return want.filter((w) => have.has(w)).length / want.length;
}

async function contents(gameId, fileName, offset, modId = null) {
    const data = await nexus.gqlQuery(
        `query($f: ModFileContentSearchFilter, $offset: Int) { modFileContents(filter: $f, count: 100, offset: $offset) { totalCount nodes { modId fileId } } }`,
        // The wildcard search ignores capitals; the exact one doesn't, and plugins name their masters in any case.
        {
            f: {
                gameId: [{ value: gameId, op: "EQUALS" }],
                fileNameWildcard: [{ value: fileName.replace(/[*?]/g, ""), op: "WILDCARD" }],
                ...(modId ? { modId: [{ value: Number(modId), op: "EQUALS" }] } : {}),
            },
            offset,
        }
    );
    return data.modFileContents;
}

// Translations and re-uploads of a mod in another language carry its files too.
const TRANSLATION = /\b(ru|rus|pl|de|fr|it|es|cz|cn|jp|kr|br|tr|russian|spanish|espa[nñ]ol|german|deutsch|french|fran[cç]ais|italian|italiano|polish|polski|chinese|japanese|korean|portuguese|brazil|pt-?br|czech|turkish|translation|traduction|traducci[oó]n|übersetzung|tradu[cç][aã]o|перевод)\b/i;

async function sourceOf(game, fileName, { hints = [] } = {}) {
    if (!game.nexus || !game.nexusGameId) return null;
    const key = `${game.id}|${fileName.toLowerCase()}|${hints.join(",")}`;
    if (found.has(key)) return found.get(key);

    // Up to 300 files that have it, by mod.
    const filesByMod = new Map();
    for (let offset = 0; offset < 300; offset += 100) {
        const page = await contents(game.nexusGameId, fileName, offset);
        for (const node of page.nodes) filesByMod.set(String(node.modId), [...(filesByMod.get(String(node.modId)) ?? []), String(node.fileId)]);
        if (offset + 100 >= page.totalCount) break;
    }
    // Mods named like the file (the original is usually one), kept if they really have it.
    const named = [];
    if (words(fileName).length) {
        try {
            const results = await nexus.search(game.nexus, { query: words(fileName).join(" "), sort: "popular", count: 8, adult: true });
            for (const mod of results.mods) {
                if (!filesByMod.has(mod.id)) {
                    const page = await contents(game.nexusGameId, fileName, 0, mod.id);
                    if (!page.nodes.length) continue;
                    filesByMod.set(mod.id, page.nodes.map((n) => String(n.fileId)));
                }
                named.push(mod.id);
            }
        } catch {
            // The files that were found are enough.
        }
    }
    // Requirements the needing mod lists, checked the same way.
    for (const id of hints.map(String)) {
        if (filesByMod.has(id)) continue;
        try {
            const page = await contents(game.nexusGameId, fileName, 0, id);
            if (page.nodes.length) filesByMod.set(id, page.nodes.map((n) => String(n.fileId)));
        } catch {
            // Not one of them.
        }
    }
    const hinted = hints.map(String).filter((id) => filesByMod.has(id));
    if (!filesByMod.size) {
        found.set(key, null);
        return null;
    }

    // The mods, by how likely each is to be the file's own.
    // Requirements and mods named like it first, so they're never cut off by the rest.
    const ids = [...new Set([...hinted, ...named, ...filesByMod.keys()])].slice(0, 60);
    const mods = [];
    for (let i = 0; i < ids.length; i += 30) {
        const data = await nexus.gqlQuery(
            // Nexus gives 20 a time unless asked for more.
            `query($ids: [CompositeDomainWithIdInput!]!, $count: Int) { legacyModsByDomain(ids: $ids, count: $count) { nodes { modId name endorsements downloads } } }`,
            { ids: ids.slice(i, i + 30).map((id) => ({ gameDomain: game.nexus, modId: Number(id) })), count: 30 }
        );
        mods.push(...data.legacyModsByDomain.nodes);
    }
    const score = (mod) =>
        (hinted.includes(String(mod.modId)) ? 1e12 : 0) +
        ((mod.endorsements ?? 0) * (1 + 4 * likeness(fileName, mod.name)) + (mod.downloads ?? 0) / 1000) * (TRANSLATION.test(mod.name) ? 0.02 : 1);
    const best = mods.sort((a, b) => score(b) - score(a))[0];
    if (!best) {
        found.set(key, null);
        return null;
    }

    // Its newest main file that has it (or newest main file, or newest that has it).
    const data = await nexus.gqlQuery(`query($mod: ID!, $game: ID!) { modFiles(modId: $mod, gameId: $game) { fileId name version category date } }`, {
        mod: String(best.modId),
        game: String(game.nexusGameId),
    });
    const files = (data.modFiles ?? []).filter((f) => f.category !== "ARCHIVED" && f.category !== "ARCHIVED_HIDDEN");
    const having = new Set(filesByMod.get(String(best.modId)) ?? []);
    const newest = (list) => [...list].sort((a, b) => (b.date ?? 0) - (a.date ?? 0) || Number(b.fileId) - Number(a.fileId))[0];
    const file =
        newest(files.filter((f) => f.category === "MAIN" && having.has(String(f.fileId)))) ??
        newest(files.filter((f) => f.category === "MAIN")) ??
        newest(files.filter((f) => having.has(String(f.fileId)) && f.category !== "OLD_VERSION")) ??
        null;
    const result = { modId: String(best.modId), fileId: file ? String(file.fileId) : null, modName: best.name, fileName: file?.name ?? null, version: file?.version ?? "" };
    found.set(key, result);
    return result;
}

module.exports = { sourceOf, likeness };
