const fs = require("fs");
const path = require("path");
const { getGame } = require("./registry.cjs");
const { dataDir } = require("./storage.cjs");
const store = require("./store.cjs");
const nexus = require("./nexus.cjs");
const { installFromUrl } = require("./remote.cjs");
const curseforge = require("../mods/providers/curseforge.cjs");

/*
 * Newer versions of installed mods, as for Minecraft: which mods have one, and updating
 * them (one, or all) with the copy they replace kept for Undo.
 *
 * A mod is matched to its Nexus Mods file by what it was installed from: a Nexus install
 * says so; a download's MD5 finds it; and Nexus downloads carry the mod's number in their
 * name ("SkyUI_5_2_SE-12604-5-2SE-1573851403.7z"). Nexus records which file replaced
 * which, so the newer file is exactly the one meant to replace the installed one.
 *
 * Nexus limits how often a key can ask, so one request finds the mods with new files this
 * month, and only their file lists are fetched; the rest come from the last check.
 */

const DAY = 24 * 60 * 60 * 1000;

/* ---------------- what's remembered between checks ---------------- */

const cacheFile = () => path.join(dataDir(), "nexus-files.json");

function readCache() {
    try {
        return JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
    } catch {
        return {};
    }
}

function writeCache(cache) {
    fs.writeFileSync(cacheFile(), JSON.stringify(cache));
}

/* The parts of a file list an update check needs. */
const compact = (listing) => ({
    files: (listing.files ?? []).map((f) => ({ id: String(f.file_id), name: f.name, version: f.version ?? "", category: f.category_name, fileName: f.file_name, at: (f.uploaded_timestamp ?? 0) * 1000, size: (f.size_kb ?? 0) * 1024 })),
    replaced: (listing.file_updates ?? []).map((u) => [String(u.old_file_id), String(u.new_file_id)]),
});

/*
 * A mod's file list, from the last check unless Nexus says it's had new files since (or
 * it's a month old, or never fetched).
 */
async function filesFor(domain, modId, context) {
    const key = `${domain}/${modId}`;
    const known = context.cache[key];
    const changedAt = context.updated?.get(String(modId)) ?? 0;
    const stale = !known || Date.now() - known.at > 30 * DAY || changedAt > known.at || !context.updated;
    if (!stale) return known;
    const fresh = { ...compact(await nexus.filesOf(domain, modId)), at: Date.now() };
    context.cache[key] = fresh;
    context.fetched += 1;
    return fresh;
}

/* ---------------- which Nexus file a mod is ---------------- */

const idsInName = store.nexusIdsInName;

/* { modId, fileId, version } for a mod installed here, or null if it can't be told. */
async function nexusFileOf(game, mod, context) {
    const source = mod.source ?? {};
    if (source.provider === "nexus" && source.modId && source.fileId) return { modId: String(source.modId), fileId: String(source.fileId) };
    if (source.nexus?.modId) return source.nexus;
    if (source.nexusLookup === "none") return null;
    let found = null;
    if (source.md5) found = await nexus.byMd5(game.nexus, source.md5);
    if (!found && source.fileName) {
        for (const candidate of idsInName(source.fileName)) {
            let listing;
            try {
                listing = await filesFor(game.nexus, candidate, context);
            } catch {
                continue;
            }
            const file = listing.files.find((f) => f.fileName === source.fileName);
            if (file) {
                found = { modId: candidate, fileId: file.id, version: file.version };
                break;
            }
        }
    }
    // Remembered either way, so it's looked up once. A mod named after its download takes
    // its name on Nexus Mods ("SkyUI_5_2_SE-12604-…" -> "SkyUI").
    let name = null;
    if (found && source.provider === "file") name = found.name ?? (await nexus.modName(game.nexus, found.modId).catch(() => null));
    if (found) delete found.name;
    store.rememberSource(game.id, mod.id, found ? { nexus: found } : { nexusLookup: "none" }, name);
    return found;
}

/* The file that replaces this one, following Nexus' record of which replaced which. */
function newerFile(listing, fileId) {
    const next = new Map(listing.replaced);
    let current = String(fileId);
    const seen = new Set([current]);
    while (next.has(current) && !seen.has(next.get(current))) {
        current = next.get(current);
        seen.add(current);
    }
    const installed = listing.files.find((f) => f.id === String(fileId));
    let target = current !== String(fileId) ? listing.files.find((f) => f.id === current) : null;
    // Moved to old versions without a successor named: the newest main file, if there's one.
    if (!target && installed?.category === "OLD_VERSION") {
        const mains = listing.files.filter((f) => f.category === "MAIN").sort((a, b) => b.at - a.at);
        if (mains.length === 1 || mains[0]?.name === installed.name) target = mains[0];
    }
    if (!target || target.id === String(fileId)) return null;
    return { installed, target };
}

/* ---------------- checking ---------------- */

const lastResults = new Map();

/*
 * Which of a game's installed mods have a newer version.
 * -> { updates: [{ key, name, provider, modId, fromVersion, toVersion, toFileId, toName, date, size }],
 *      checked, unknown, needsKey, error }
 */
async function check(gameId) {
    const game = getGame(gameId);
    const state = store.readState(gameId);
    const out = { updates: [], checked: 0, unknown: 0, needsKey: 0, error: null };
    const context = { cache: readCache(), updated: null, fetched: 0 };
    const hasKey = nexus.hasKey();

    if (game.nexus && hasKey) {
        try {
            context.updated = await nexus.updatedThisMonth(game.nexus);
        } catch (err) {
            if (err.code === "BAD_KEY" || err.code === "RATE_LIMITED") out.error = err.message;
        }
    }

    const work = state.mods.map((mod) => async () => {
        const key = `m:${mod.id}`;
        const source = mod.source ?? {};
        try {
            if (source.provider === "curseforge" && source.modId) {
                const files = await curseforge.getFiles(String(source.modId));
                const newest = files[0];
                const installed = files.find((f) => String(f.id) === String(source.fileId));
                out.checked += 1;
                if (newest && String(newest.id) !== String(source.fileId) && (!installed || Date.parse(newest.date) > Date.parse(installed.date))) {
                    out.updates.push({ key, name: mod.name, provider: "curseforge", modId: String(source.modId), fromVersion: installed?.name ?? source.version ?? "", toVersion: newest.name, toFileId: String(newest.id), toName: newest.name, date: newest.date, size: newest.size, website: !newest.downloadUrl });
                }
                return;
            }
            if (!game.nexus || out.error) return;
            if (!hasKey) {
                if (source.provider === "nexus" || source.nexus || /-\d{9,11}\.(zip|7z|rar)$/i.test(source.fileName ?? "")) out.needsKey += 1;
                return;
            }
            const link = await nexusFileOf(game, mod, context);
            if (!link) {
                out.unknown += 1;
                return;
            }
            const listing = await filesFor(game.nexus, link.modId, context);
            out.checked += 1;
            const newer = newerFile(listing, link.fileId);
            if (newer) {
                out.updates.push({
                    key,
                    name: mod.name,
                    provider: "nexus",
                    modId: link.modId,
                    fromVersion: newer.installed?.version || link.version || "",
                    toVersion: newer.target.version,
                    toFileId: newer.target.id,
                    toName: newer.target.name,
                    date: new Date(newer.target.at).toISOString(),
                    size: newer.target.size,
                });
            }
        } catch (err) {
            if (err.code === "RATE_LIMITED" || err.code === "BAD_KEY") out.error = err.message;
            else out.unknown += 1;
        }
    });

    // A few at a time.
    for (let i = 0; i < work.length; i += 4) await Promise.all(work.slice(i, i + 4).map((run) => run()));
    writeCache(context.cache);
    out.fetched = context.fetched;
    lastResults.set(gameId, out);
    return out;
}

/* ---------------- updating ---------------- */

/*
 * Installs the newer version of one mod, keeping the copy it replaces for Undo.
 * -> an install result, or { needsWebsite, reason } where the site has to be used.
 */
async function update(gameId, key, progress) {
    const game = getGame(gameId);
    let found = lastResults.get(gameId)?.updates.find((u) => u.key === key);
    if (!found) found = (await check(gameId)).updates.find((u) => u.key === key);
    if (!found) throw new Error("That mod has no newer version.");
    const mod = store.readState(gameId).mods.find((m) => `m:${m.id}` === key);
    if (!mod) throw new Error("That mod isn't installed any more.");

    if (found.provider === "curseforge") {
        if (found.website) return { needsWebsite: null, reason: "Its author only allows downloads from CurseForge's website." };
        const file = await curseforge.resolveDownload(found.modId, found.toFileId);
        const result = await installFromUrl(game, file.downloadUrl, { name: mod.name, replaces: mod.id, source: { provider: "curseforge", modId: found.modId, fileId: found.toFileId, version: found.toVersion } }, progress);
        forget(gameId, key);
        return result;
    }

    const page = `https://www.nexusmods.com/${game.nexus}/mods/${found.modId}?tab=files&file_id=${found.toFileId}&nmm=1`;
    const account = await nexus.whoAmI().catch(() => null);
    if (!account?.premium) return { needsWebsite: page, modId: found.modId, reason: "Nexus Mods only lets apps download straight away for Premium accounts." };
    try {
        const url = await nexus.downloadUrl(game.nexus, found.modId, found.toFileId);
        const result = await installFromUrl(game, url, { name: mod.name, replaces: mod.id, source: { provider: "nexus", modId: found.modId, fileId: found.toFileId, version: found.toVersion } }, progress);
        forget(gameId, key);
        return result;
    } catch (err) {
        if (err.code === "PREMIUM_REQUIRED") return { needsWebsite: page, modId: found.modId, reason: err.message };
        throw err;
    }
}

/* An update that's been installed (here, or through the website) isn't offered again. */
function forget(gameId, key) {
    const results = lastResults.get(gameId);
    if (results) results.updates = results.updates.filter((u) => u.key !== key);
}

module.exports = { check, update, idsInName, newerFile };
