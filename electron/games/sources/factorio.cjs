const { getSecret } = require("../../secrets.cjs");
const { getJson, failure } = require("./http.cjs");

/*
 * The Factorio Mod Portal, Factorio's own. Browsing needs nothing; searching and
 * downloading need the player's Factorio username and token (both on
 * factorio.com/profile), saved together in Settings as "username:token".
 */

const SITE = "https://mods.factorio.com";
const LABEL = "Factorio Mod Portal";
const FACTORIO = "427520";

// What Factorio itself provides, never downloaded.
const BUILT_IN = new Set(["base", "core", "space-age", "quality", "elevated-rails"]);

function account() {
    const saved = getSecret("factorio");
    if (!saved) return null;
    const at = saved.indexOf(":");
    if (at <= 0) return null;
    return { username: saved.slice(0, at).trim(), token: saved.slice(at + 1).trim() };
}

async function supports(game) {
    return (game.steamAppIds ?? []).includes(FACTORIO) || /^factorio$/i.test(String(game.name).trim()) ? {} : null;
}

const pageOf = (name) => `${SITE}/mod/${encodeURIComponent(name)}`;
const thumb = (path) => (path && !/\/\.thumb\.png$/.test(path) && path !== "/assets/.thumb.png" ? `https://assets-mod.factorio.com${path}` : null);

function brief(mod) {
    const release = mod.latest_release ?? mod.releases?.at(-1) ?? null;
    return {
        provider: "factorio",
        id: mod.name,
        name: mod.title || mod.name,
        summary: mod.summary ?? "",
        picture: thumb(mod.thumbnail),
        author: mod.owner ?? "",
        downloads: mod.downloads_count ?? 0,
        endorsements: null,
        version: release?.version ?? "",
        updated: release?.released_at ?? mod.updated_at ?? null,
        adult: false,
        url: pageOf(mod.name),
        installable: true,
    };
}

const SORTS = { updated: ["updated_at", "desc"], new: ["created_at", "desc"], name: ["name", "asc"] };
const RANKS = { popular: "trending", downloads: "most_downloads", updated: "last_updated_at", new: "last_updated_at", rated: "relevancy" };

async function search(_ctx, { query = "", sort, page = 0, size = 24 }) {
    const me = account();
    if (me && (query || sort === "popular" || sort === "downloads" || !sort)) {
        // Its search, which ranks by downloads too, is only open to players signed in.
        const json = await getJson(`${SITE}/api/search`, {
            label: LABEL,
            keyed: true,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: me.username, token: me.token, query, page: page + 1, page_size: size, sort_attribute: query && (sort === "popular" || !sort) ? "relevancy" : RANKS[sort] ?? "most_downloads", hide_deprecated: true }),
        });
        return { total: json.pagination?.count ?? (json.results ?? []).length, mods: (json.results ?? []).map(brief), perPage: size };
    }
    if (query) throw failure("Searching the Factorio Mod Portal needs your Factorio username and token: add them in Settings → API keys. Without them it can still be browsed.", "NEEDS_KEY");
    const [field, order] = SORTS[sort] ?? SORTS.updated;
    const params = new URLSearchParams({ page: String(page + 1), page_size: String(size), sort: field, sort_order: order, hide_deprecated: "true" });
    const json = await getJson(`${SITE}/api/mods?${params}`, { label: LABEL });
    return { total: json.pagination?.count ?? 0, mods: (json.results ?? []).map(brief), perPage: size };
}

function full(name) {
    return getJson(`${SITE}/api/mods/${encodeURIComponent(name)}/full`, { label: LABEL });
}

/* "? optional >= 1.0", "! incompatible", "~ mod >= 2" -> the mods it can't work without. */
function needs(release) {
    return (release?.info_json?.dependencies ?? [])
        .map((text) => String(text).trim())
        .filter((text) => !/^(\?|\(\?\)|!)/.test(text))
        .map((text) => text.replace(/^~\s*/, "").split(/\s*(?:>=|<=|=|>|<)\s*/)[0].trim())
        .filter((name) => name && !BUILT_IN.has(name));
}

async function details(_ctx, modId) {
    const mod = await full(modId);
    const releases = [...(mod.releases ?? [])].reverse();
    return {
        ...brief({ ...mod, latest_release: releases[0] }),
        html: "",
        markdown: mod.description || mod.summary || "",
        images: (mod.images ?? []).map((image) => image.url).filter(Boolean).slice(0, 12),
        hasKey: Boolean(account()),
        premium: Boolean(account()),
        files: releases.slice(0, 20).map((release, i) => ({
            id: release.version,
            name: release.file_name,
            version: release.version,
            category: i === 0 ? "Main" : "Older",
            size: 0,
            fileName: release.file_name,
            date: release.released_at ?? "",
            description: [`For Factorio ${release.info_json?.factorio_version ?? "?"}`, needs(release).length ? `needs ${needs(release).join(", ")}` : ""].filter(Boolean).join("; "),
        })),
    };
}

async function download(_ctx, modId, fileId) {
    const me = account();
    if (!me) {
        const err = failure("Downloading from the Factorio Mod Portal needs your Factorio username and token: add them in Settings → API keys.", "WEBSITE_ONLY");
        err.page = pageOf(modId);
        throw err;
    }
    const mod = await full(modId);
    const releases = mod.releases ?? [];
    const release = (fileId && releases.find((r) => r.version === String(fileId))) || releases.at(-1);
    if (!release) throw new Error(`${mod.title || modId} has no releases.`);
    const url = `${SITE}${release.download_url}?${new URLSearchParams({ username: me.username, token: me.token })}`;
    return {
        url,
        fileName: release.file_name,
        sha1: release.sha1 ?? null,
        version: release.version,
        fileId: release.version,
        name: mod.title || mod.name,
        requires: needs(release).map((name) => ({ modId: name, name })),
    };
}

async function latest(_ctx, modId) {
    const mod = await getJson(`${SITE}/api/mods/${encodeURIComponent(modId)}`, { label: LABEL });
    const release = mod.releases?.at(-1);
    return release ? { fileId: release.version, version: release.version, date: release.released_at, size: 0 } : null;
}

module.exports = { id: "factorio", label: LABEL, site: `${SITE}/`, keyOptional: "factorio", primary: true, supports, search, details, download, latest };
