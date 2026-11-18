const { getJson } = require("./http.cjs");

/*
 * SpaceDock: Kerbal Space Program's mod site, the one CKAN reads. No key. Its top list
 * and search come 30 at a time with no total, so paging goes on while a page is full.
 */

const SITE = "https://spacedock.info";
const LABEL = "SpaceDock";
const KSP = { steam: "220200", id: 3102 };
const PER_PAGE = 30;

async function supports(game) {
    return (game.steamAppIds ?? []).includes(KSP.steam) || /^kerbal ?space ?program$/i.test(String(game.name).trim()) ? { gameId: KSP.id } : null;
}

const absolute = (link) => (!link ? null : /^https?:/i.test(link) ? link : `${SITE}${link.startsWith("/") ? "" : "/"}${link}`);
const newest = (mod) => (mod.versions ?? []).find((v) => v.id === mod.default_version_id) ?? mod.versions?.[0] ?? null;

function brief(mod) {
    const version = newest(mod);
    return {
        provider: "spacedock",
        id: String(mod.id),
        name: mod.name,
        summary: mod.short_description ?? "",
        picture: absolute(mod.background),
        author: mod.author ?? "",
        downloads: mod.downloads ?? 0,
        endorsements: mod.followers ?? null,
        version: version?.friendly_version ?? "",
        updated: version?.created ?? null,
        adult: false,
        url: absolute(mod.url) ?? `${SITE}/mod/${mod.id}`,
        installable: Boolean(version?.download_path),
    };
}

const SORTS = { updated: "updated", new: "created" };

async function search(ctx, { query = "", sort, page = 0 }) {
    let list;
    let total = null;
    if (query) {
        list = await getJson(`${SITE}/api/search/mod?${new URLSearchParams({ query, page: String(page + 1), game_id: String(ctx.gameId) })}`, { label: LABEL });
    } else if (SORTS[sort]) {
        const json = await getJson(`${SITE}/api/browse?${new URLSearchParams({ page: String(page + 1), count: String(PER_PAGE), orderby: SORTS[sort], order: "desc", game_id: String(ctx.gameId) })}`, { label: LABEL });
        list = json.result ?? [];
        total = json.total ?? null;
    } else {
        // Most downloaded and followed.
        list = await getJson(`${SITE}/api/browse/top?${new URLSearchParams({ page: String(page + 1), game_id: String(ctx.gameId) })}`, { label: LABEL });
    }
    list = (Array.isArray(list) ? list : []).filter((mod) => !mod.game_id || mod.game_id === ctx.gameId);
    if (query) {
        // SpaceDock's search matches descriptions too and ranks by downloads: mods named for it come first.
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const named = (mod) => (words.every((word) => String(mod.name).toLowerCase().includes(word)) ? 0 : 1);
        list = list.map((mod, i) => [mod, i]).sort((a, b) => named(a[0]) - named(b[0]) || a[1] - b[1]).map(([mod]) => mod);
    }
    const counted = page * PER_PAGE + list.length + (list.length >= PER_PAGE ? 1 : 0);
    return { total: total ?? counted, mods: list.map(brief), perPage: PER_PAGE };
}

function modOf(modId) {
    return getJson(`${SITE}/api/mod/${encodeURIComponent(modId)}`, { label: LABEL });
}

async function details(_ctx, modId) {
    const mod = await modOf(modId);
    return {
        ...brief(mod),
        html: "",
        markdown: mod.description || mod.short_description || "",
        images: [absolute(mod.background)].filter(Boolean),
        hasKey: true,
        premium: true,
        files: (mod.versions ?? []).slice(0, 20).map((version) => ({
            id: String(version.id),
            name: `${mod.name} ${version.friendly_version}`,
            version: version.friendly_version,
            category: version.id === mod.default_version_id ? "Main" : "Older",
            size: 0,
            fileName: `${mod.name}-${version.friendly_version}.zip`,
            date: version.created ?? "",
            description: [`For KSP ${version.game_version}`, (version.changelog ?? "").slice(0, 300)].filter(Boolean).join(". "),
        })),
    };
}

async function download(_ctx, modId, fileId) {
    const mod = await modOf(modId);
    const version = (fileId && (mod.versions ?? []).find((v) => String(v.id) === String(fileId))) || newest(mod);
    if (!version?.download_path) throw new Error(`${mod.name} has nothing to download.`);
    return {
        url: absolute(version.download_path),
        fileName: `${mod.name}-${version.friendly_version}.zip`.replace(/[/\\:*?"<>|]/g, "_"),
        version: version.friendly_version,
        fileId: String(version.id),
        name: mod.name,
        page: absolute(mod.url),
        // SpaceDock doesn't record what a mod needs; CKAN's own index does.
        requires: [],
    };
}

async function latest(_ctx, modId) {
    const mod = await modOf(modId);
    const version = newest(mod);
    return version ? { fileId: String(version.id), version: version.friendly_version, date: version.created, size: 0 } : null;
}

module.exports = { id: "spacedock", label: LABEL, site: `${SITE}/`, primary: true, supports, search, details, download, latest };
