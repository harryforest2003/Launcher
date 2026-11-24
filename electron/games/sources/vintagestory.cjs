const { getJson, remembered, plain } = require("./http.cjs");

/*
 * Vintage Story's Mod DB (mods.vintagestory.at), the game's official mod site. No key.
 * Its list comes whole (about 10,000 mods), so each order is fetched once in a while and
 * paged here. A mod is a .zip the game reads as it is, from VintagestoryData/Mods.
 */

const SITE = "https://mods.vintagestory.at";
const LABEL = "Vintage Story Mod DB";
const PER_PAGE = 24;
const KEEP = 30 * 60 * 1000;

async function supports(game) {
    return plain(game.name) === "vintagestory" ? {} : null;
}

const SORTS = { popular: "trendingpoints", downloads: "downloads", updated: "lastreleased", new: "created" };

function brief(mod) {
    return {
        provider: "vintagestory",
        id: String(mod.urlalias || mod.modidstrs?.[0] || mod.modid),
        name: mod.name,
        summary: mod.summary ?? "",
        picture: mod.logo ?? mod.logofile ?? null,
        author: mod.author ?? "",
        downloads: mod.downloads ?? 0,
        endorsements: mod.follows ?? null,
        version: "",
        updated: mod.lastreleased ? `${mod.lastreleased.replace(" ", "T")}Z` : null,
        adult: false,
        url: `${SITE}/${mod.urlalias || `show/mod/${mod.assetid}`}`,
        installable: true,
    };
}

async function search(_ctx, { query = "", sort, page = 0 }) {
    const orderby = SORTS[sort] ?? SORTS.popular;
    const params = new URLSearchParams({ orderby });
    if (query) params.set("text", query);
    const list = await remembered(`vintagestory:${orderby}:${query.toLowerCase()}`, KEEP, async () => {
        const json = await getJson(`${SITE}/api/mods?${params}`, { label: LABEL, timeout: 40000 });
        // Tools and other kinds aren't mods for the Mods folder.
        return (json.mods ?? []).filter((mod) => mod.type === "mod");
    });
    return { total: list.length, mods: list.slice(page * PER_PAGE, (page + 1) * PER_PAGE).map(brief), perPage: PER_PAGE };
}

const modOf = (modId) =>
    getJson(`${SITE}/api/mod/${encodeURIComponent(modId)}`, { label: LABEL }).then((json) => {
        if (!json.mod) throw new Error("The Vintage Story Mod DB has no mod by that name.");
        return json.mod;
    });

const dateOf = (text) => (text ? `${String(text).replace(" ", "T")}Z` : "");

async function details(_ctx, modId) {
    const mod = await modOf(modId);
    const releases = mod.releases ?? [];
    return {
        ...brief({ ...mod, logo: mod.logofile }),
        id: String(modId),
        version: releases[0]?.modversion ?? "",
        installable: releases.length > 0,
        html: mod.text ?? "",
        images: [mod.logofile, ...(mod.screenshots ?? []).map((shot) => shot.mainfile)].filter(Boolean).slice(0, 12),
        hasKey: true,
        premium: true,
        files: releases.slice(0, 20).map((release, i) => ({
            id: String(release.releaseid),
            name: release.filename,
            version: release.modversion ?? "",
            category: i === 0 ? "Main" : "Older",
            size: 0,
            fileName: release.filename,
            date: dateOf(release.created),
            description: release.tags?.length ? `For Vintage Story ${release.tags[0]}${release.tags.length > 1 ? ` to ${release.tags[release.tags.length - 1]}` : ""}` : "",
        })),
    };
}

async function download(_ctx, modId, fileId) {
    const mod = await modOf(modId);
    const releases = mod.releases ?? [];
    const release = (fileId && releases.find((r) => String(r.releaseid) === String(fileId))) || releases[0];
    if (!release?.mainfile) throw new Error(`${mod.name} has nothing to download.`);
    return {
        url: release.mainfile,
        fileName: release.filename,
        version: release.modversion ?? "",
        fileId: String(release.releaseid),
        name: mod.name,
        page: `${SITE}/${mod.urlalias || `show/mod/${mod.assetid}`}`,
        // The Mod DB doesn't list what a mod needs; the game names anything missing when it starts.
        requires: [],
    };
}

async function latest(_ctx, modId) {
    const release = (await modOf(modId)).releases?.[0];
    return release ? { fileId: String(release.releaseid), version: release.modversion ?? "", date: dateOf(release.created), size: 0 } : null;
}

module.exports = { id: "vintagestory", label: LABEL, site: `${SITE}/`, primary: true, supports, search, details, download, latest };
