const { getSecret } = require("../../secrets.cjs");
const { hostBase } = require("../../curseforge.cjs");
const { getJson, remembered, failure } = require("./http.cjs");
const { bbcodeHtml } = require("../nexus.cjs");

/*
 * Steam Workshop: the mods of every game that has one (RimWorld, Cities: Skylines,
 * Garry's Mod...). Searching needs a Steam Web API key: the player's own from Settings,
 * or else the launcher's, which its host (the CurseForge proxy) adds on its server. A
 * mod's page needs none. Steam installs Workshop mods itself, for the account that
 * subscribes, so Install opens the mod in Steam to press Subscribe.
 */

const API = "https://api.steampowered.com";
const LABEL = "Steam Workshop";
const DAY = 24 * 60 * 60 * 1000;

const key = () => getSecret("steam");

/* Whether the launcher's host can ask Steam (it has a key set up). Asked every 10 minutes. */
function viaHost() {
    const base = hostBase();
    if (!base) return Promise.resolve(false);
    return remembered("workshop:host", 10 * 60 * 1000, () =>
        getJson(`${base}/status`, { label: "The launcher's host", timeout: 8000 })
            .then((json) => json?.steam === true)
            // An older host, or none reachable: only a key of the player's own works.
            .catch(() => false),
    );
}

/* A keyed Steam Web API call: with the player's key straight to Steam, else through the host. */
async function steam(path, params) {
    const apiKey = key();
    if (apiKey) return getJson(`${API}${path}?${new URLSearchParams({ key: apiKey, ...params })}`, { label: LABEL, keyed: true });
    if (await viaHost()) return getJson(`${hostBase()}/steam${path}?${new URLSearchParams(params)}`, { label: LABEL });
    throw failure("Add your Steam Web API key in Settings → API keys to search the Workshop.", "NEEDS_KEY");
}

const canSearch = async () => Boolean(key()) || viaHost();

// Steam's EPublishedFileQueryType.
const QUERY_TYPES = { popular: 3, downloads: 12, updated: 19, new: 1, rated: 0 };

const query = (params) => steam("/IPublishedFileService/QueryFiles/v1/", params);

/* -> { appId } when the game has a Workshop with something in it; needs a key to ask. */
async function supports(game) {
    const appId = game.steamAppIds?.[0];
    if (!appId || !(await canSearch())) return null;
    return remembered(`workshop:has:${appId}`, DAY, async () => {
        const json = await query({ appid: appId, query_type: "0", numperpage: "1", page: "1", totalonly: "true" });
        return (json.response?.total ?? 0) > 0 ? { appId: String(appId) } : null;
    });
}

/* Steam ids to their profile names (one request for a page of them). */
async function names(ids) {
    const unique = [...new Set(ids.filter(Boolean))].slice(0, 100);
    if (!unique.length || !(await canSearch())) return new Map();
    try {
        const json = await steam("/ISteamUser/GetPlayerSummaries/v2/", { steamids: unique.join(",") });
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
    const keyed = await canSearch();
    if (keyed) {
        // With a key, its gallery and the other items it needs.
        try {
            const json = await steam("/IPublishedFileService/GetDetails/v1/", { "publishedfileids[0]": String(modId), includeadditionalpreviews: "true", includechildren: "true" });
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
        hasKey: keyed,
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

/* The game's own Workshop page. */
const home = (ctx) => `https://steamcommunity.com/app/${ctx.appId}/workshop/`;

module.exports = { id: "workshop", label: LABEL, site: "https://steamcommunity.com/", needsKey: "steam", viaHost, primary: true, home, supports, search, details, download };
