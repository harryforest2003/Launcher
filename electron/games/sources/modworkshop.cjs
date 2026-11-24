const { getJson, remembered, plain } = require("./http.cjs");

/*
 * ModWorkshop: PAYDAY 2's main mod site, with mods for about 70 other games too (PAYDAY 3,
 * RAID: World War II, Noita, Teardown, Enter the Gungeon...). No key. Its API is open to
 * community mod managers (api.modworkshop.net/.openapi), as long as they don't hammer it.
 * Authors can ask that mod managers leave a mod be: those open on the site instead.
 */

const SITE = "https://modworkshop.net";
const API = "https://api.modworkshop.net";
const STORAGE = "https://storage.modworkshop.net/mods";
const LABEL = "ModWorkshop";
const DAY = 24 * 60 * 60 * 1000;

const get = (path) => getJson(`${API}${path}`, { label: LABEL });

/* Every game ModWorkshop has mods for: [{ id, name, short, steam }]. Kept a day. */
function games() {
    return remembered("modworkshop:games", DAY, async () => {
        const all = [];
        for (let page = 1; page <= 10; page++) {
            const json = await get(`/games?limit=50&page=${page}`);
            all.push(...(json.data ?? []));
            if (page >= (json.meta?.last_page ?? 1)) break;
        }
        return all
            .filter((game) => (game.mod_count ?? 0) > 0)
            .map((game) => ({
                id: game.id,
                name: game.name,
                short: game.short_name,
                // Its links say which Steam game it is: "Store Page|https://store.steampowered.com/app/218620/...".
                steam: String(game.buttons ?? "").match(/store\.steampowered\.com\/app\/(\d+)/)?.[1] ?? null,
            }));
    });
}

async function supports(game) {
    const list = await games();
    const steamIds = (game.steamAppIds ?? []).map(String);
    const found = list.find((g) => g.steam && steamIds.includes(g.steam)) ?? list.find((g) => plain(g.name) === plain(game.name));
    return found ? { gameId: found.id, short: found.short } : null;
}

const image = (picture, thumb = false) => (picture?.file ? `${STORAGE}/images/${thumb && picture.has_thumb ? "thumbnail_" : ""}${picture.file}` : null);
// Its descriptions are Markdown with colour tags: "{#ff0000}(red words)".
const unColour = (text) => String(text ?? "").replace(/\{#[0-9a-z]+\}\(([^)]*)\)/gi, "$1");
const pageOf = (id) => `${SITE}/mod/${id}`;

function brief(mod) {
    return {
        provider: "modworkshop",
        id: String(mod.id),
        name: mod.name,
        summary: unColour(mod.short_desc || String(mod.desc ?? "").replace(/[#*_`>]/g, "").slice(0, 200)).trim(),
        picture: image(mod.thumbnail, true),
        author: mod.user?.name ?? "",
        downloads: mod.downloads ?? 0,
        endorsements: mod.likes ?? null,
        version: mod.custom_version || mod.download?.version || "",
        updated: mod.bumped_at ?? mod.updated_at ?? null,
        adult: false,
        url: pageOf(mod.id),
        installable: Boolean(mod.has_download) && !mod.disable_mod_managers,
    };
}

const SORTS = { popular: "weekly_score", downloads: "downloads", updated: "bumped_at", new: "published_at" };

async function search(ctx, { query = "", sort, page = 0, size = 24 }) {
    const params = new URLSearchParams({ limit: String(Math.min(50, size)), page: String(page + 1), sort: query ? "best_match" : (SORTS[sort] ?? SORTS.popular) });
    if (query) params.set("query", query);
    const json = await get(`/games/${ctx.gameId}/mods?${params}`);
    return { total: json.meta?.total ?? 0, mods: (json.data ?? []).map(brief), perPage: Math.min(50, size) };
}

const modOf = (modId) => get(`/mods/${encodeURIComponent(modId)}`);
const filesOf = (modId) => get(`/mods/${encodeURIComponent(modId)}/files?limit=20`).then((json) => json.data ?? []);

const fileNameOf = (file) => {
    try {
        return new URL(file.download_url).searchParams.get("filename") || file.file;
    } catch {
        return file.file;
    }
};

async function details(_ctx, modId) {
    const [mod, files] = await Promise.all([modOf(modId), filesOf(modId).catch(() => [])]);
    return {
        ...brief(mod),
        html: "",
        markdown: unColour(mod.desc || mod.short_desc || ""),
        images: [image(mod.thumbnail), ...(mod.images ?? []).map((pic) => image(pic))].filter(Boolean).slice(0, 12),
        hasKey: true,
        premium: true,
        files: mod.disable_mod_managers
            ? []
            : files.map((file) => ({
                id: String(file.id),
                name: file.label || file.name,
                version: file.version ?? "",
                category: file.id === (mod.download_id ?? mod.download?.id) ? "Main" : "Other",
                size: file.size ?? 0,
                fileName: fileNameOf(file),
                date: file.created_at ?? "",
                description: unColour(file.desc ?? "").slice(0, 300),
            })),
    };
}

async function download(_ctx, modId, fileId) {
    const mod = await modOf(modId);
    if (mod.disable_mod_managers) throw new Error(`${mod.name}'s author asks for it to be downloaded from its page on ModWorkshop.`);
    let file = mod.download?.download_url ? mod.download : null;
    if (fileId && String(file?.id) !== String(fileId)) file = (await filesOf(modId)).find((f) => String(f.id) === String(fileId)) ?? null;
    if (!file) file = (await filesOf(modId))[0];
    if (!file?.download_url) throw new Error(`${mod.name} is only a link to another site: open its page to get it.`);
    return {
        url: file.download_url,
        fileName: fileNameOf(file),
        version: file.version || mod.custom_version || "",
        fileId: String(file.id),
        name: mod.name,
        page: pageOf(mod.id),
        requires: (mod.dependencies ?? [])
            .filter((dep) => dep.mod_id && !dep.optional)
            .map((dep) => ({ modId: String(dep.mod_id), name: dep.mod?.name ?? dep.name })),
    };
}

async function latest(_ctx, modId) {
    const mod = await modOf(modId);
    const file = mod.download ?? (await filesOf(modId))[0];
    return file?.id ? { fileId: String(file.id), version: file.version || mod.custom_version || "", date: file.created_at ?? mod.bumped_at, size: file.size ?? 0 } : null;
}

/* The game's own page on the site. */
const home = (ctx) => (ctx.short ? `${SITE}/g/${encodeURIComponent(ctx.short)}` : `${SITE}/`);

module.exports = { id: "modworkshop", label: LABEL, site: `${SITE}/`, primary: true, home, supports, search, details, download, latest, games };
