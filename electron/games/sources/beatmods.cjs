const { getJson, remembered } = require("./http.cjs");

/*
 * BeatMods: Beat Saber's checked mod list, the one its mod installers read. No key, no
 * search of its own: the whole list for a Beat Saber version is one answer (about 300 KB),
 * kept for an hour and searched here.
 */

const SITE = "https://beatmods.com";
const LABEL = "BeatMods";
const BEAT_SABER = "620980";
const HOUR = 60 * 60 * 1000;

async function supports(game) {
    return (game.steamAppIds ?? []).includes(BEAT_SABER) || /^beat ?saber$/i.test(String(game.name).trim()) ? {} : null;
}

/*
 * The mods checked for the newest Beat Saber version that has any. A new version starts
 * empty and stays so for weeks while mods catch up, so up to 12 are tried, newest first;
 * an empty answer is a few bytes.
 */
function catalogue() {
    return remembered("beatmods:catalogue", HOUR, async () => {
        const info = await getJson(`${SITE}/api/v3/games/beatsaber`, { label: LABEL });
        const versions = (info.gameVersions ?? []).map((v) => v.version).filter(Boolean);
        const preferred = (info.gameVersions ?? []).find((v) => v.defaultVersion)?.version;
        const tries = [...new Set([preferred, ...versions.slice(0, 12)].filter(Boolean))];
        for (const gameVersion of tries) {
            const json = await getJson(`${SITE}/api/mods?${new URLSearchParams({ gameName: "BeatSaber", gameVersion, status: "verified", platform: "steampc" })}`, { label: LABEL, timeout: 30000 });
            const mods = (json.mods ?? []).filter((entry) => entry.mod && entry.latest);
            if (mods.length) return { gameVersion, mods, byVersion: new Map(mods.map((entry) => [entry.latest.id, entry])) };
        }
        return { gameVersion: tries[0] ?? "", mods: [], byVersion: new Map() };
    });
}

const authors = (entry) => (entry.mod.authors ?? []).map((a) => a.displayName || a.username).filter(Boolean).join(", ");

function brief(entry, gameVersion) {
    return {
        provider: "beatmods",
        id: String(entry.mod.id),
        name: entry.mod.name,
        summary: entry.mod.summary ?? "",
        picture: null,
        author: authors(entry),
        downloads: entry.latest.downloadCount ?? 0,
        endorsements: null,
        version: entry.latest.modVersion ?? "",
        updated: entry.latest.updatedAt ?? entry.mod.updatedAt ?? null,
        adult: false,
        url: `${SITE}/mods/${entry.mod.id}`,
        installable: Boolean(entry.latest.zipHash),
        gameVersion,
    };
}

const SORTS = {
    updated: (a, b) => String(b.latest.updatedAt).localeCompare(String(a.latest.updatedAt)),
    new: (a, b) => String(b.mod.createdAt).localeCompare(String(a.mod.createdAt)),
    // Core libraries first, as everything else needs them; then by name.
    popular: (a, b) => rank(a) - rank(b) || a.mod.name.localeCompare(b.mod.name),
};
const rank = (entry) => (["core", "essential", "library"].includes(entry.mod.category) ? 0 : 1);

async function search(_ctx, { query = "", sort, page = 0, size = 24 }) {
    const { mods, gameVersion } = await catalogue();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const found = mods.filter((entry) => {
        const text = `${entry.mod.name} ${entry.mod.summary} ${authors(entry)} ${entry.mod.category}`.toLowerCase();
        return words.every((word) => text.includes(word));
    });
    found.sort(SORTS[sort] ?? SORTS.popular);
    return { total: found.length, mods: found.slice(page * size, page * size + size).map((entry) => brief(entry, gameVersion)), perPage: size };
}

async function entryOf(modId) {
    const cat = await catalogue();
    const entry = cat.mods.find((e) => String(e.mod.id) === String(modId));
    if (!entry) throw new Error(`BeatMods has no checked version of that mod for Beat Saber ${cat.gameVersion}.`);
    return { entry, cat };
}

const needs = (entry, cat) => (entry.latest.dependencies ?? []).map((id) => cat.byVersion.get(id)).filter(Boolean);

async function details(_ctx, modId) {
    const { entry, cat } = await entryOf(modId);
    const required = needs(entry, cat);
    return {
        ...brief(entry, cat.gameVersion),
        html: "",
        markdown: entry.mod.description || entry.mod.summary || "",
        images: [],
        hasKey: true,
        premium: true,
        files: [{
            id: String(entry.latest.id),
            name: `${entry.mod.name} ${entry.latest.modVersion}`,
            version: entry.latest.modVersion,
            category: "Main",
            size: entry.latest.fileSize ?? 0,
            fileName: `${entry.mod.name}-${entry.latest.modVersion}.zip`,
            date: entry.latest.updatedAt ?? "",
            description: [`For Beat Saber ${cat.gameVersion}`, required.length ? `needs ${required.map((e) => e.mod.name).join(", ")}` : ""].filter(Boolean).join("; "),
        }],
    };
}

async function download(_ctx, modId) {
    const { entry, cat } = await entryOf(modId);
    if (!entry.latest.zipHash) throw new Error(`${entry.mod.name} has nothing to download.`);
    return {
        url: `${SITE}/cdn/mod/${entry.latest.zipHash}.zip`,
        fileName: `${entry.mod.name}-${entry.latest.modVersion}.zip`.replace(/[/\\:*?"<>|]/g, "_"),
        md5: entry.latest.zipHash,
        version: entry.latest.modVersion,
        fileId: String(entry.latest.id),
        name: entry.mod.name,
        page: `${SITE}/mods/${entry.mod.id}`,
        requires: needs(entry, cat).map((dep) => ({ modId: String(dep.mod.id), name: dep.mod.name })),
    };
}

async function latest(_ctx, modId) {
    const { entry } = await entryOf(modId);
    return { fileId: String(entry.latest.id), version: entry.latest.modVersion, date: entry.latest.updatedAt, size: entry.latest.fileSize ?? 0 };
}

module.exports = { id: "beatmods", label: LABEL, site: `${SITE}/`, primary: true, supports, search, details, download, latest };
