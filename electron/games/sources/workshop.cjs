const { getSecret } = require("../../secrets.cjs");
const { getJson, remembered, failure } = require("./http.cjs");
const { bbcodeHtml } = require("../nexus.cjs");

/*
 * Steam Workshop: the mods of every game that has one (RimWorld, Cities: Skylines,
 * Garry's Mod...). Searching needs the player's own Steam Web API key; a mod's page
 * doesn't. Steam installs Workshop mods itself, for the account that subscribes, so
 * Install opens the mod in Steam to press Subscribe.
 */

const API = "https://api.steampowered.com";
const LABEL = "Steam Workshop";
const DAY = 24 * 60 * 60 * 1000;

const key = () => getSecret("steam");

// Steam's EPublishedFileQueryType.
const QUERY_TYPES = { popular: 3, downloads: 12, updated: 19, new: 1, rated: 0 };

function query(params) {
    const apiKey = key();
    if (!apiKey) throw failure("Add your Steam Web API key in Settings → API keys to search the Workshop.", "NEEDS_KEY");
    const search = new URLSearchParams({ key: apiKey, ...params });
    return getJson(`${API}/IPublishedFileService/QueryFiles/v1/?${search}`, { label: LABEL, keyed: true });
}

/* -> { appId } when the game has a Workshop with something in it; needs the key to ask. */
async function supports(game) {
    const appId = game.steamAppIds?.[0];
    if (!appId || !key()) return null;
    return remembered(`workshop:has:${appId}`, DAY, async () => {
        const json = await query({ appid: appId, query_type: "0", numperpage: "1", page: "1", totalonly: "true" });
        return (json.response?.total ?? 0) > 0 ? { appId: String(appId) } : null;
    });
}

/* Steam ids to their profile names (one request for a page of them). */
async function names(ids) {
    const unique = [...new Set(ids.filter(Boolean))].slice(0, 100);
    if (!unique.length || !key()) return new Map();
    try {
        const json = await getJson(`${API}/ISteamUser/GetPlayerSummaries/v2/?${new URLSearchParams({ key: key(), steamids: unique.join(",") })}`, { label: LABEL, keyed: true });
        return new Map((json.response?.players ?? []).map((p) => [p.steamid, p.personaname]));
    } catch {
        return new Map();
    }
}

const iso = (seconds) => (seconds ? new Date(seconds * 1000).toISOString() : null);
const pageOf = (id) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

function brief(item, people) {
    return {
        provider: "workshop",
        id: String(item.publishedfileid),
        name: item.title ?? `Workshop item ${item.publishedfileid}`,
        summary: item.short_description ?? String(item.file_description ?? "").replace(/\[[^\]]+\]/g, "").slice(0, 200),
        picture: item.preview_url ?? null,
        author: people.get(item.creator) ?? "",
        downloads: item.lifetime_subscriptions ?? item.subscriptions ?? 0,
        endorsements: item.vote_data?.votes_up ?? item.favorited ?? null,
        version: "",
        updated: iso(item.time_updated),
        adult: Boolean(item.maybe_inappropriate_sex),
        url: pageOf(item.publishedfileid),
        installable: true,
    };
}

async function search(ctx, { query: text = "", sort, page = 0, size = 24, adult = false }) {
    const params = {
        appid: ctx.appId,
        query_type: String(text ? 11 : (QUERY_TYPES[sort] ?? 3)),
        page: String(page + 1),
        numperpage: String(size),
        return_vote_data: "true",
        return_short_description: "true",
        return_details: "true",
        // Items in collections, guides and the like aren't mods.
        filetype: "0",
    };
    // Trending: over the last month.
    if (params.query_type === "3") params.days = "30";
    if (text) params.search_text = text;
    const json = await query(params);
    const items = (json.response?.publishedfiledetails ?? []).filter((item) => adult || !item.maybe_inappropriate_sex);
    const people = await names(items.map((item) => item.creator));
    return { total: json.response?.total ?? 0, mods: items.filter((item) => item.result === undefined || item.result === 1).map((item) => brief(item, people)), perPage: size };
}

/* A Workshop item's details, which Steam gives without a key. */
async function itemOf(id) {
    const body = new URLSearchParams({ itemcount: "1", "publishedfileids[0]": String(id) });
    const json = await getJson(`${API}/ISteamRemoteStorage/GetPublishedFileDetails/v1/`, { label: LABEL, method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const item = json.response?.publishedfiledetails?.[0];
    if (!item || item.result !== 1) throw new Error("Steam has no Workshop item with that id (or it's private).");
    return item;
}

async function details(_ctx, modId) {
    const item = await itemOf(modId);
    let images = [];
    let children = [];
    if (key()) {
        // With a key, its gallery and the other items it needs.
        try {
            const params = new URLSearchParams({ key: key(), "publishedfileids[0]": String(modId), includeadditionalpreviews: "true", includechildren: "true" });
            const json = await getJson(`${API}/IPublishedFileService/GetDetails/v1/?${params}`, { label: LABEL, keyed: true });
            const full = json.response?.publishedfiledetails?.[0];
            images = (full?.previews ?? []).filter((p) => p.preview_type === 0 && p.url).map((p) => p.url);
            children = (full?.children ?? []).map((child) => child.publishedfileid);
        } catch {
            // The main picture stands in.
        }
    }
    const people = await names([item.creator]);
    return {
        ...brief(item, people),
        html: bbcodeHtml(item.description ?? ""),
        images: [item.preview_url, ...images].filter(Boolean).slice(0, 12),
        hasKey: Boolean(key()),
        premium: true,
        files: [{
            id: String(item.publishedfileid),
            name: item.title,
            version: "",
            category: "Main",
            size: Number(item.file_size) || 0,
            fileName: item.filename || "",
            date: iso(item.time_updated) ?? "",
            description: children.length ? `Steam subscribes to ${children.length} other item${children.length === 1 ? "" : "s"} it needs as well.` : "",
        }],
    };
}

/* Steam downloads Workshop mods itself: -> where to subscribe. */
async function download(ctx, modId) {
    return { steam: `steam://url/CommunityFilePage/${encodeURIComponent(String(modId))}`, page: pageOf(modId), appId: ctx.appId };
}

module.exports = { id: "workshop", label: LABEL, site: "https://steamcommunity.com/", needsKey: "steam", primary: true, supports, search, details, download };
