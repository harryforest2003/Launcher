const nexusKey = require("../mods/providers/nexus.cjs");

/*
 * Nexus Mods for the game sections. Searching uses Nexus' newer API (v2, GraphQL), which
 * needs no key and searches by name, unlike the old one. A mod's files and their
 * downloads use the old API (v1) with the person's own key, from Settings → API keys:
 * Premium accounts get a download straight away; free accounts download through the
 * website's "Mod Manager Download" button, which hands the launcher an nxm:// link.
 */

const GQL = "https://api.nexusmods.com/v2/graphql";
const V1 = "https://api.nexusmods.com/v1";
const HEADERS = { "Content-Type": "application/json", "User-Agent": "UnityLauncher/1.0" };

async function gql(query, variables) {
    const res = await fetch(GQL, { method: "POST", headers: HEADERS, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Nexus Mods answered ${res.status}.`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(`Nexus Mods: ${json.errors[0].message}`);
    return json.data;
}

async function v1(pathname) {
    const res = await fetch(`${V1}${pathname}`, { headers: nexusKey.apiHeaders(), signal: AbortSignal.timeout(30000) });
    if (res.status === 401) throw Object.assign(new Error("Nexus Mods didn't accept your API key. Check it in Settings → API keys."), { code: "BAD_KEY" });
    if (res.status === 403) throw Object.assign(new Error("Nexus Mods only gives download links to Premium accounts here. Use the Mod Manager Download button on the mod's page."), { code: "PREMIUM_REQUIRED" });
    if (res.status === 429) throw Object.assign(new Error("Nexus Mods has had as many requests from your key as it allows for now. Try again in an hour."), { code: "RATE_LIMITED" });
    if (!res.ok) throw new Error(`Nexus Mods answered ${res.status}.`);
    return res.json();
}

const SORTS = {
    popular: { endorsements: { direction: "DESC" } },
    downloads: { downloads: { direction: "DESC" } },
    updated: { updatedAt: { direction: "DESC" } },
    new: { createdAt: { direction: "DESC" } },
};

/* Mods for a game, by name, best first: { total, mods }. */
async function search(domain, { query = "", sort = "popular", page = 0, count = 24, adult = false } = {}) {
    const filter = { gameDomainName: [{ value: domain, op: "EQUALS" }] };
    if (query.trim()) filter.name = [{ value: query.trim(), op: "WILDCARD" }];
    if (!adult) filter.adultContent = [{ value: false, op: "EQUALS" }];
    const data = await gql(
        `query($filter: ModsFilter, $count: Int, $offset: Int, $sort: [ModsSort!]) {
            mods(filter: $filter, count: $count, offset: $offset, sort: $sort) {
                totalCount
                nodes { modId name summary pictureUrl author downloads endorsements version updatedAt adultContent }
            }
        }`,
        { filter, count, offset: page * count, sort: [SORTS[sort] ?? SORTS.popular] }
    );
    return {
        total: data.mods.totalCount,
        mods: data.mods.nodes.map((mod) => ({
            provider: "nexus",
            id: String(mod.modId),
            name: mod.name,
            summary: mod.summary ?? "",
            picture: mod.pictureUrl ?? null,
            author: mod.author ?? "",
            downloads: mod.downloads ?? 0,
            endorsements: mod.endorsements ?? 0,
            version: mod.version ?? "",
            updated: mod.updatedAt ?? null,
            adult: Boolean(mod.adultContent),
            url: `https://www.nexusmods.com/${domain}/mods/${mod.modId}`,
        })),
    };
}

/* Nexus' BBCode description as readable text, and the pictures in it. */
function readable(bbcode) {
    const images = [...String(bbcode).matchAll(/\[img\]\s*(https?:\/\/[^\s[\]]+?)\s*\[\/img\]/gi)].map((m) => m[1]).slice(0, 6);
    const text = String(bbcode)
        .replace(/<br\s*\/?>/gi, "")
        .replace(/\[img\][\s\S]*?\[\/img\]/gi, "")
        .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, "$2")
        .replace(/\[\*\]/g, "• ")
        .replace(/\[\/?[a-z]+(=[^\]]*)?\]/gi, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/﻿/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return { text: text.slice(0, 20000), images };
}

/*
 * Nexus' BBCode description as HTML, for the mod's page. The page sanitises it, as it does
 * every site's descriptions, so this only has to get the formatting right.
 */
function bbcodeHtml(bbcode) {
    let html = String(bbcode)
        .replace(/﻿/g, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const tags = [
        [/\[(\/?)(b|i|u|s|center|code|quote)\]/gi, (_m, close, tag) => {
            const html = { b: "b", i: "i", u: "u", s: "s", center: "center", code: "pre", quote: "blockquote" }[tag.toLowerCase()];
            return `<${close}${html}>`;
        }],
        [/\[quote=[^\]]*\]/gi, "<blockquote>"],
        [/\[heading\]([\s\S]*?)\[\/heading\]/gi, "<h3>$1</h3>"],
        [/\[line\]/gi, "<hr>"],
        [/\[img\]\s*(https?:\/\/[^\s[\]]+?)\s*\[\/img\]/gi, '<img src="$1" alt="">'],
        [/\[url=["']?(https?:\/\/[^\]"']+)["']?\]([\s\S]*?)\[\/url\]/gi, '<a href="$1">$2</a>'],
        [/\[url\](https?:\/\/[^[]+?)\[\/url\]/gi, '<a href="$1">$1</a>'],
        [/\[youtube\]\s*([\w-]{6,20})\s*\[\/youtube\]/gi, '<a href="https://www.youtube.com/watch?v=$1">YouTube video</a>'],
        [/\[spoiler\]/gi, "<details><summary>Spoiler</summary>"],
        [/\[\/spoiler\]/gi, "</details>"],
        [/\[list=1\]/gi, "<ol>"],
        [/\[list\]/gi, "<ul>"],
        [/\[\/list\]/gi, "</ul>"],
        [/\[\*\]/g, "<li>"],
        [/\[\/\*\]/g, "</li>"],
        // Sizes, colours, fonts and anything else: the text stays, the tag goes.
        [/\[\/?[a-z]+(=[^\]]*)?\]/gi, ""],
    ];
    for (const [pattern, replacement] of tags) html = html.replace(pattern, replacement);
    return html
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .replace(/\n/g, "<br>")
        // A line break straight after a block is one too many.
        .replace(/(<\/?(?:ul|ol|li|h3|hr|blockquote|pre|details|summary|center)>)(?:<br>)+/gi, "$1")
        .replace(/(?:<br>)+(<\/?(?:ul|ol|li)>)/gi, "$1");
}

let account = null;
let adultInfo = null;

/*
 * Whether the key's account is age-verified on Nexus Mods, and its own adult-content
 * preferences: { verified, adult, blur }, or null without a key. Nexus' newer API takes
 * the same personal key.
 */
async function adultAccess() {
    if (!nexusKey.hasApiKey()) return null;
    adultInfo ??= (async () => {
        const res = await fetch(GQL, {
            method: "POST",
            headers: { ...HEADERS, ...nexusKey.apiHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ query: "{ ageVerificationInfo { verified } preferences { adult adultBlurImages } }" }),
            signal: AbortSignal.timeout(30000),
        });
        if (res.status === 401) throw Object.assign(new Error("Nexus Mods didn't accept your API key. Check it in Settings → API keys."), { code: "BAD_KEY" });
        if (!res.ok) throw new Error(`Nexus Mods answered ${res.status}.`);
        const json = await res.json();
        return {
            verified: json.data?.ageVerificationInfo?.verified === true,
            adult: json.data?.preferences?.adult === true,
            blur: json.data?.preferences?.adultBlurImages !== false,
        };
    })().catch((err) => {
        adultInfo = null;
        throw err;
    });
    return adultInfo;
}

/* Who the key belongs to and whether they're Premium (null without a key). */
async function whoAmI() {
    if (!nexusKey.hasApiKey()) return null;
    account ??= v1("/users/validate.json")
        .then((me) => ({ name: me.name, premium: Boolean(me.is_premium) }))
        .catch((err) => {
            account = null;
            throw err;
        });
    return account;
}

const CATEGORY = { MAIN: "Main", UPDATE: "Update", OPTIONAL: "Optional", OLD_VERSION: "Old", MISCELLANEOUS: "Miscellaneous", ARCHIVED: "Archived" };

/* A mod's description, and with a key its files (main ones first) and whether downloads can be direct. */
async function details(domain, modId) {
    const data = await gql(
        `query($ids: [CompositeDomainWithIdInput!]!) {
            legacyModsByDomain(ids: $ids) { nodes { modId name summary description pictureUrl author version downloads endorsements updatedAt } }
        }`,
        { ids: [{ gameDomain: domain, modId: Number(modId) }] }
    );
    const mod = data.legacyModsByDomain.nodes[0];
    if (!mod) throw new Error("That mod isn't on Nexus Mods any more.");
    const { text, images } = readable(mod.description ?? "");
    const out = { id: String(mod.modId), name: mod.name, summary: mod.summary ?? "", picture: mod.pictureUrl ?? null, downloads: mod.downloads ?? 0, endorsements: mod.endorsements ?? 0, updated: mod.updatedAt ?? null, author: mod.author, version: mod.version, description: text, html: bbcodeHtml(mod.description ?? ""), images, url: `https://www.nexusmods.com/${domain}/mods/${modId}`, hasKey: nexusKey.hasApiKey(), premium: false, files: [] };
    if (!out.hasKey) return out;
    try {
        out.premium = (await whoAmI())?.premium ?? false;
    } catch {
        out.hasKey = false;
        return out;
    }
    const files = await filesOf(domain, modId);
    const order = ["MAIN", "UPDATE", "OPTIONAL", "MISCELLANEOUS", "OLD_VERSION", "ARCHIVED"];
    out.files = (files.files ?? [])
        .filter((file) => file.category_name !== "ARCHIVED")
        .sort((a, b) => order.indexOf(a.category_name) - order.indexOf(b.category_name) || (b.uploaded_timestamp ?? 0) - (a.uploaded_timestamp ?? 0))
        .map((file) => ({
            id: String(file.file_id),
            name: file.name,
            version: file.version ?? "",
            category: CATEGORY[file.category_name] ?? file.category_name,
            size: (file.size_kb ?? 0) * 1024,
            fileName: file.file_name,
            date: file.uploaded_time,
            description: readable(file.description ?? "").text.slice(0, 400),
        }));
    return out;
}

/*
 * A mod's files, and which file replaced which ({ files, file_updates }), as Nexus Mods
 * lists them. Needs the key.
 */
async function filesOf(domain, modId) {
    return v1(`/games/${domain}/mods/${modId}/files.json`);
}

/* The Nexus Mods file a download is, from its MD5: { modId, fileId, version, name } or null. */
async function byMd5(domain, md5) {
    try {
        const found = await v1(`/games/${domain}/mods/md5_search/${md5}.json`);
        const hit = Array.isArray(found) ? found[0] : null;
        if (!hit?.mod?.mod_id || !hit.file_details?.file_id) return null;
        return { modId: String(hit.mod.mod_id), fileId: String(hit.file_details.file_id), version: hit.file_details.version ?? "", name: hit.mod.name ?? null };
    } catch (err) {
        if (/answered 404/.test(err.message)) return null;
        throw err;
    }
}

/* A mod's name on Nexus Mods (no key needed). */
async function modName(domain, modId) {
    const data = await gql(
        `query($ids: [CompositeDomainWithIdInput!]!) { legacyModsByDomain(ids: $ids) { nodes { name } } }`,
        { ids: [{ gameDomain: domain, modId: Number(modId) }] }
    );
    return data.legacyModsByDomain.nodes[0]?.name ?? null;
}

/* Mods with new files in the last month: Map(modId -> when, in ms). One request for a whole game. */
async function updatedThisMonth(domain) {
    const list = await v1(`/games/${domain}/mods/updated.json?period=1m`);
    return new Map((list ?? []).map((entry) => [String(entry.mod_id), (entry.latest_file_update ?? entry.latest_mod_activity ?? 0) * 1000]));
}

/*
 * A file's download address. Premium accounts need nothing more; an nxm:// link carries a
 * key and expiry that let a free account download that one file.
 */
async function downloadUrl(domain, modId, fileId, nxm = null) {
    const params = nxm ? `?key=${encodeURIComponent(nxm.key)}&expires=${encodeURIComponent(nxm.expires)}` : "";
    const links = await v1(`/games/${domain}/mods/${modId}/files/${fileId}/download_link.json${params}`);
    if (!links?.length) throw new Error("Nexus Mods gave no download address.");
    return links[0].URI;
}

/* nxm://skyrimspecialedition/mods/12604/files/35407?key=...&expires=...&user_id=... */
function parseNxm(link) {
    const url = new URL(link);
    if (url.protocol !== "nxm:") return null;
    const match = `${url.hostname}${url.pathname}`.match(/^([\w-]+)\/mods\/(\d+)\/files\/(\d+)/i);
    if (!match) return null;
    return { domain: match[1].toLowerCase(), modId: match[2], fileId: match[3], key: url.searchParams.get("key"), expires: url.searchParams.get("expires") };
}

const forgetAccount = () => {
    account = null;
    adultInfo = null;
};

module.exports = { search, details, downloadUrl, parseNxm, whoAmI, forgetAccount, readable, bbcodeHtml, filesOf, byMd5, updatedThisMonth, modName, adultAccess, hasKey: () => nexusKey.hasApiKey() };
