const { getSecret } = require("../../secrets.cjs");
const { getJson, remembered, plain, failure } = require("./http.cjs");

/*
 * mod.io: mods for a few hundred games (SnowRunner, Hogwarts Legacy, Baldur's Gate 3's
 * console mods...). Every request needs a key: the player's own read-only one, made on
 * mod.io's "API access" page. Some games keep their mods to their own app; those are
 * opened on the website instead.
 */

const API = "https://api.mod.io/v1";
const LABEL = "mod.io";
const DAY = 24 * 60 * 60 * 1000;

const key = () => getSecret("modio");

const SORTS = { popular: "-popular", downloads: "-downloads_total", updated: "-date_updated", new: "-date_live", rated: "-ratings_weighted_aggregate" };

function call(pathname, params = {}) {
    const apiKey = key();
    if (!apiKey) throw failure("Add your mod.io key in Settings → API keys to use mod.io.", "NEEDS_KEY");
    const query = new URLSearchParams({ api_key: apiKey, ...params });
    return getJson(`${API}${pathname}?${query}`, { label: LABEL, keyed: true });
}

/* -> { gameId, nameId } for a game mod.io has, or null. Without a key, mod.io can't be asked. */
async function supports(game) {
    if (!key()) return null;
    const wanted = plain(game.name);
    if (!wanted) return null;
    return remembered(`modio:game:${wanted}`, DAY, async () => {
        const json = await call("/games", { _q: game.name, _limit: "10" });
        const found = (json.data ?? []).find((g) => plain(g.name) === wanted);
        // api_access_options bit 1: other apps may use its mods at all.
        if (!found || (typeof found.api_access_options === "number" && (found.api_access_options & 1) === 0)) return null;
        // Without bit 2 its download links change often, so each is asked for just before downloading.
        return { gameId: found.id, nameId: found.name_id, profile: found.profile_url };
    });
}

function brief(mod) {
    return {
        provider: "modio",
        id: String(mod.id),
        name: mod.name,
        summary: mod.summary ?? "",
        picture: mod.logo?.thumb_320x180 ?? mod.logo?.original ?? null,
        author: mod.submitted_by?.username ?? "",
        downloads: mod.stats?.downloads_total ?? 0,
        endorsements: mod.stats?.ratings_positive ?? null,
        version: mod.modfile?.version ?? "",
        updated: mod.date_updated ? new Date(mod.date_updated * 1000).toISOString() : null,
        // maturity_option is a set of flags: alcohol, drugs, violence, explicit.
        adult: ((mod.maturity_option ?? 0) & 8) !== 0,
        url: mod.profile_url ?? null,
        installable: true,
    };
}

async function search(ctx, { query = "", sort, page = 0, size = 24, adult = false }) {
    const params = { _limit: String(size), _offset: String(page * size), _sort: SORTS[sort] ?? "-popular" };
    if (query) params._q = query;
    if (!adult) params["maturity_option-bitwise-and"] = "0";
    let json;
    try {
        json = await call(`/games/${ctx.gameId}/mods`, params);
    } catch (err) {
        // Not every game takes the maturity filter.
        if (err.status !== 400 || adult) throw err;
        delete params["maturity_option-bitwise-and"];
        json = await call(`/games/${ctx.gameId}/mods`, params);
    }
    return { total: json.result_total ?? 0, mods: (json.data ?? []).map(brief), perPage: size };
}

const date = (seconds) => (seconds ? new Date(seconds * 1000).toISOString() : "");

async function details(ctx, modId) {
    const [mod, files] = await Promise.all([
        call(`/games/${ctx.gameId}/mods/${encodeURIComponent(modId)}`),
        call(`/games/${ctx.gameId}/mods/${encodeURIComponent(modId)}/files`, { _sort: "-date_added", _limit: "20" }).catch(() => ({ data: [] })),
    ]);
    return {
        ...brief(mod),
        html: mod.description || mod.summary || "",
        images: (mod.media?.images ?? []).map((image) => image.original).filter(Boolean).slice(0, 12),
        hasKey: true,
        premium: true,
        files: (files.data ?? []).map((file) => ({
            id: String(file.id),
            name: file.filename,
            version: file.version ?? "",
            category: String(file.id) === String(mod.modfile?.id) ? "Main" : "Older",
            size: file.filesize ?? 0,
            fileName: file.filename,
            date: date(file.date_added),
            description: (file.changelog ?? "").replace(/<[^>]+>/g, "").slice(0, 400),
        })),
    };
}

async function download(ctx, modId, fileId) {
    const mod = await call(`/games/${ctx.gameId}/mods/${encodeURIComponent(modId)}`);
    let file = mod.modfile;
    try {
        if (fileId) file = await call(`/games/${ctx.gameId}/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}`);
    } catch (err) {
        if (err.code !== "BAD_KEY") throw err;
        // A file only the game's own app (or a signed-in player) may have.
        file = null;
    }
    if (!file?.download?.binary_url) {
        const err = failure(`${mod.name} has no file to download.`, "WEBSITE_ONLY");
        err.page = mod.profile_url;
        throw err;
    }
    let requires = [];
    if (mod.dependencies) {
        const deps = await call(`/games/${ctx.gameId}/mods/${encodeURIComponent(modId)}/dependencies`).catch(() => ({ data: [] }));
        requires = (deps.data ?? []).map((dep) => ({ modId: String(dep.mod_id ?? dep.id), name: dep.name ?? `mod ${dep.mod_id ?? dep.id}` }));
    }
    return {
        url: file.download.binary_url,
        fileName: file.filename,
        md5: file.filehash?.md5 ?? null,
        version: file.version ?? "",
        fileId: String(file.id),
        name: mod.name,
        page: mod.profile_url,
        requires,
    };
}

async function latest(ctx, modId) {
    const mod = await call(`/games/${ctx.gameId}/mods/${encodeURIComponent(modId)}`);
    const file = mod.modfile;
    return file?.id ? { fileId: String(file.id), version: file.version || file.filename, date: date(file.date_added), size: file.filesize ?? 0 } : null;
}

/* The game's own page on the site. */
const home = (ctx) => ctx.profile || `https://mod.io/g/${encodeURIComponent(ctx.nameId)}`;

module.exports = { id: "modio", label: LABEL, site: "https://mod.io/", needsKey: "modio", primary: true, home, supports, search, details, download, latest };
