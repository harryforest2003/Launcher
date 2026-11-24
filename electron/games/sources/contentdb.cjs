const { getJson, remembered, plain } = require("./http.cjs");

/*
 * ContentDB (content.luanti.org), the official mod site of Luanti (once called Minetest),
 * and the one the game's own "Browse online content" uses. No key. Its list isn't paged, so
 * each order is fetched once in a while and paged here. Mods are ids like "TenPlus1/mobs";
 * their zips hold one folder named after the mod, which goes into mods/ as it is.
 */

const SITE = "https://content.luanti.org";
const LABEL = "ContentDB";
const PER_PAGE = 24;
const KEEP = 10 * 60 * 1000;

async function supports(game) {
    return ["luanti", "minetest"].includes(plain(game.name)) ? {} : null;
}

const SORTS = { popular: "score", downloads: "downloads", updated: "last_release", new: "approved_at" };

const pathOf = (id) => String(id).split("/").map(encodeURIComponent).join("/");
const pageOf = (id) => `${SITE}/packages/${pathOf(id)}/`;
const absolute = (url) => (!url ? null : /^https?:/.test(url) ? url : `${SITE}${url.startsWith("/") ? "" : "/"}${url}`);

function brief(pkg) {
    const id = `${pkg.author}/${pkg.name}`;
    return {
        provider: "contentdb",
        id,
        name: pkg.title || pkg.name,
        summary: pkg.short_description ?? "",
        picture: absolute(pkg.thumbnail),
        author: pkg.author ?? "",
        downloads: pkg.downloads ?? 0,
        endorsements: null,
        version: "",
        updated: null,
        adult: false,
        url: pageOf(id),
        installable: Boolean(pkg.release),
    };
}

async function search(_ctx, { query = "", sort, page = 0 }) {
    const order = SORTS[sort] ?? SORTS.popular;
    const params = new URLSearchParams({ type: "mod", sort: order, order: "desc" });
    if (query) params.set("q", query);
    const list = await remembered(`contentdb:${order}:${query.toLowerCase()}`, KEEP, async () => {
        const json = await getJson(`${SITE}/api/packages/?${params}`, { label: LABEL, timeout: 40000 });
        return Array.isArray(json) ? json : [];
    });
    return { total: list.length, mods: list.slice(page * PER_PAGE, (page + 1) * PER_PAGE).map(brief), perPage: PER_PAGE };
}

const packageOf = (id) => getJson(`${SITE}/api/packages/${pathOf(id)}/`, { label: LABEL });
const releasesOf = (id) => getJson(`${SITE}/api/packages/${pathOf(id)}/releases/`, { label: LABEL }).then((list) => (Array.isArray(list) ? list : []));

async function details(_ctx, modId) {
    const [pkg, releases] = await Promise.all([packageOf(modId), releasesOf(modId).catch(() => [])]);
    const shots = (pkg.screenshots ?? []).map((shot) => absolute(typeof shot === "string" ? shot : shot?.url)).filter(Boolean);
    return {
        ...brief(pkg),
        version: releases[0]?.title ?? "",
        updated: releases[0]?.release_date ?? null,
        endorsements: pkg.score != null ? Math.round(pkg.score) : null,
        installable: releases.length > 0,
        html: "",
        markdown: pkg.long_description || pkg.short_description || "",
        images: (shots.length ? shots : [absolute(pkg.thumbnail)]).filter(Boolean).slice(0, 12),
        hasKey: true,
        premium: true,
        files: releases.slice(0, 20).map((release, i) => ({
            id: String(release.id),
            name: release.title,
            version: release.title ?? "",
            category: i === 0 ? "Main" : "Older",
            size: release.size ?? 0,
            fileName: `${pkg.name}.zip`,
            date: release.release_date ?? "",
            description: String(release.release_notes ?? "").slice(0, 300),
        })),
    };
}

/* What a mod can't run without, as ContentDB ids. A need another mod can meet is only
 * taken when one is named just like it (preferring the same author); a need nothing is
 * named after, like "default", comes with the game itself. */
async function needs(modId) {
    const json = await getJson(`${SITE}/api/packages/${pathOf(modId)}/dependencies/?only_hard=1`, { label: LABEL }).catch(() => ({}));
    const author = String(modId).split("/")[0];
    return (json?.[modId] ?? [])
        .filter((dep) => !dep.is_optional && dep.name)
        .map((dep) => {
            const named = (dep.packages ?? []).filter((id) => String(id).split("/")[1] === dep.name);
            const pick = named.find((id) => id.split("/")[0] === author) ?? named[0];
            return pick ? { modId: pick, name: dep.name } : null;
        })
        .filter(Boolean);
}

async function download(_ctx, modId, fileId) {
    const [pkg, releases] = await Promise.all([packageOf(modId), releasesOf(modId)]);
    const release = (fileId && releases.find((r) => String(r.id) === String(fileId))) || releases[0];
    if (!release) throw new Error(`${pkg.title || modId} has no release to download.`);
    return {
        url: absolute(release.url) ?? `${pageOf(modId)}releases/${release.id}/download/`,
        fileName: `${pkg.name}.zip`,
        version: release.title ?? "",
        fileId: String(release.id),
        name: pkg.title || pkg.name,
        page: pageOf(modId),
        requires: await needs(modId),
    };
}

async function latest(_ctx, modId) {
    const release = (await releasesOf(modId))[0];
    return release ? { fileId: String(release.id), version: release.title ?? "", date: release.release_date ?? "", size: release.size ?? 0 } : null;
}

module.exports = { id: "contentdb", label: LABEL, site: `${SITE}/`, primary: true, supports, search, details, download, latest };
