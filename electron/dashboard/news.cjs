const store = require("./store.cjs");

/*
 * Minecraft and mod loader news for the Home page, fetched here in the main process (the
 * page's policy lets it reach no other site) from the projects' own feeds:
 *
 *   Minecraft.net    https://launchercontent.mojang.com/v2/news.json  (the official launcher's news)
 *   Java Edition     https://launchercontent.mojang.com/v2/javaPatchNotes.json  (releases and snapshots)
 *   Bedrock Edition  https://launchercontent.mojang.com/v2/bedrockPatchNotes.json
 *                    linked to its changelog on feedback.minecraft.net (Release Changelogs section)
 *   Fabric           https://fabricmc.net/feed.xml  and  Fabric Loader releases on GitHub
 *   NeoForge         https://neoforged.net/index.xml
 *   Forge            Forge's releases on GitHub, and the Releases board of its forums
 *   Modrinth         https://modrinth.com/news/feed/rss.xml  (the mod site's news)
 *
 * Each source has its own time limit and its own entry in a cache on disk
 * (<userData>/dashboard/news-cache.json), so one that's down or slow never holds up or
 * empties the others: its last good items are shown and its name is listed in `failed`.
 * Only https links and pictures are passed on.
 */

const CACHE_FILE = "news-cache.json";
const CACHE_VERSION = 1;
/* Which page a source feeds: the Minecraft home ("minecraft", the default) or the main Home ("gaming"). */
const FEEDS = new Set(["minecraft", "gaming"]);
const feedOf = (source) => source.feed ?? "minecraft";
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 6 * 1024 * 1024;
const FRESH_MS = 30 * 60_000;
// A source that failed is tried again sooner, but not on every visit to Home.
const RETRY_MS = 5 * 60_000;
// "Refresh" still waits this long between fetches of the same source.
const MIN_REFRESH_MS = 60_000;
const USER_AGENT = "UnityLauncher/1.0";

const MOJANG = "https://launchercontent.mojang.com";
const BEDROCK_CHANGELOGS = "https://feedback.minecraft.net/hc/en-us/sections/360001186971-Release-Changelogs";
const BEDROCK_CHANGELOG_LIST =
    "https://feedback.minecraft.net/api/v2/help_center/en-us/sections/360001186971/articles.json?sort_by=created_at&sort_order=desc&per_page=60";

/* ---------------- text ---------------- */

const NAMED = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘",
    rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", copy: "©",
    reg: "®", trade: "™", eacute: "é", times: "×", middot: "·", bull: "•",
};

function decodeEntities(text) {
    return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
        if (code[0] === "#") {
            const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
            return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
        }
        return NAMED[code.toLowerCase()] ?? whole;
    });
}

/* Plain text from a bit of HTML: no tags, no scripts, one space between words. */
function plainText(html) {
    return decodeEntities(
        String(html ?? "")
            .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
            .replace(/<[^>]*>/g, " "),
    )
        .replace(/\s+/g, " ")
        .trim();
}

function shorten(text, max) {
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const space = cut.lastIndexOf(" ");
    return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}

/* An https address (resolved against base), with no user name or password in it, or null. */
function httpsUrl(value, base) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
        const url = new URL(value.trim(), base);
        if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
        return url.href;
    } catch {
        return null;
    }
}

/* A date as ISO. A plain calendar date is put at midday UTC, so it shows as that day everywhere. */
function isoDate(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    const time = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T12:00:00Z` : trimmed);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/* ---------------- feeds (RSS and Atom) ---------------- */

/* The inside of the first <name>...</name> in xml, CDATA unwrapped, entities left as they are. */
function tagContent(xml, name) {
    const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
    if (!m) return null;
    const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(m[1]);
    return cdata ? { raw: cdata[1], cdata: true } : { raw: m[1], cdata: false };
}

/* Text of a tag: entities decoded once (and, for HTML inside, the tags removed too). */
function tagText(xml, name) {
    const found = tagContent(xml, name);
    if (!found) return "";
    return plainText(found.cdata ? found.raw : decodeEntities(found.raw));
}

function tagHtml(xml, name) {
    const found = tagContent(xml, name);
    if (!found) return "";
    return found.cdata ? found.raw : decodeEntities(found.raw);
}

const attr = (tag, name) => {
    const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
    return m ? decodeEntities(m[2] ?? m[3]) : null;
};

function feedLink(block) {
    const links = block.match(/<link\b[^>]*>/gi) ?? [];
    for (const tag of links) {
        const rel = attr(tag, "rel");
        const href = attr(tag, "href");
        if (href && (!rel || rel === "alternate")) return href;
    }
    return tagText(block, "link") || null;
}

function feedImage(block, html, base) {
    const tags = block.match(/<(media:thumbnail|media:content|enclosure)\b[^>]*>/gi) ?? [];
    for (const tag of tags) {
        const type = attr(tag, "type") ?? "";
        const medium = attr(tag, "medium") ?? "";
        if (/^enclosure/i.test(tag.slice(1)) && !type.startsWith("image/")) continue;
        if (/^media:content/i.test(tag.slice(1)) && medium && medium !== "image") continue;
        const url = httpsUrl(attr(tag, "url"), base);
        if (url) return url;
    }
    const img = /<img\b[^>]*>/i.exec(html);
    return img ? httpsUrl(attr(img[0], "src"), base) : null;
}

/* Every <item> or <entry> of a feed as { title, url, date, summary, image, id }. */
function parseFeed(xml) {
    const blocks = String(xml).match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
    return blocks.map((block) => {
        const link = feedLink(block);
        const url = httpsUrl(link);
        const html = tagHtml(block, "content:encoded") || tagHtml(block, "content") || tagHtml(block, "description") || tagHtml(block, "summary");
        const summary = tagText(block, "summary") || tagText(block, "description") || plainText(html);
        return {
            title: tagText(block, "title"),
            url,
            date: isoDate(tagText(block, "pubDate") || tagText(block, "published") || tagText(block, "updated") || tagText(block, "dc:date")),
            summary,
            image: feedImage(block, html, url ?? undefined),
            id: tagText(block, "guid") || tagText(block, "id") || url,
        };
    });
}

/* ---------------- each source ---------------- */

const mojangImage = (image) => httpsUrl(typeof image === "string" ? image : image?.url, MOJANG);

/* The launcher's tracking tag isn't needed to read an article. */
function withoutTracking(link) {
    const url = httpsUrl(link);
    if (!url) return null;
    const parsed = new URL(url);
    parsed.searchParams.delete("OCID");
    return parsed.href;
}

const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function mojangEntries(text) {
    const json = JSON.parse(text);
    return Array.isArray(json?.entries) ? json.entries.filter((e) => e && typeof e === "object") : [];
}

const SOURCES = [
    {
        key: "minecraft",
        label: "Minecraft.net",
        url: `${MOJANG}/v2/news.json`,
        max: 12,
        parse: (text) =>
            mojangEntries(text)
                // Java and Bedrock news: not the news for the other Minecraft games.
                .filter((e) => Array.isArray(e.newsType) && e.newsType.some((t) => t === "Java" || t === "Bedrock"))
                .map((e) => ({
                    title: String(e.title ?? ""),
                    summary: plainText(e.text),
                    date: isoDate(e.date),
                    url: withoutTracking(e.readMoreLink),
                    image: mojangImage(e.newsPageImage) ?? mojangImage(e.playPageImage),
                    category: "minecraft",
                    id: e.id,
                })),
    },
    {
        key: "java",
        label: "Java Edition",
        url: `${MOJANG}/v2/javaPatchNotes.json`,
        max: 10,
        parse: (text) =>
            mojangEntries(text).map((e) => ({
                title: String(e.title ?? ""),
                summary: plainText(e.shortText),
                date: isoDate(e.date),
                // Each patch note's article on minecraft.net is named after its title
                // ("Minecraft 26.4 Snapshot 8" -> /article/minecraft-26-4-snapshot-8).
                url: e.title ? `https://www.minecraft.net/en-us/article/${slug(String(e.title))}` : null,
                image: mojangImage(e.image),
                category: e.type === "release" ? "java" : "snapshot",
                id: e.id ?? e.version,
            })),
    },
    {
        key: "bedrock",
        label: "Bedrock Edition",
        url: `${MOJANG}/v2/bedrockPatchNotes.json`,
        max: 6,
        links: true,
        parse: (text, links) =>
            mojangEntries(text).map((e) => {
                const title = String(e.title ?? "");
                // The short text starts with the title again.
                const summary = plainText(e.shortText);
                return {
                    title,
                    summary: summary.startsWith(title) ? summary.slice(title.length).trim() : summary,
                    date: isoDate(e.date),
                    url: bedrockLink(String(e.version ?? ""), links),
                    image: mojangImage(e.image),
                    category: "bedrock",
                    id: e.id ?? e.version,
                };
            }),
    },
    {
        key: "fabric",
        label: "Fabric",
        url: "https://fabricmc.net/feed.xml",
        max: 5,
        parse: (text) => parseFeed(text).map((item) => ({ ...item, category: "fabric" })),
    },
    {
        key: "fabric-loader",
        label: "Fabric Loader",
        url: "https://github.com/FabricMC/fabric-loader/releases.atom",
        max: 3,
        parse: (text) =>
            parseFeed(text).map((item) => ({
                ...item,
                summary: item.summary ? `Changes: ${item.summary}` : "A new Fabric Loader release.",
                image: null,
                category: "fabric",
            })),
    },
    {
        key: "neoforge",
        label: "NeoForge",
        url: "https://neoforged.net/index.xml",
        max: 6,
        parse: (text) => parseFeed(text).map((item) => ({ ...item, category: "neoforge" })),
    },
    {
        key: "forge",
        label: "Forge",
        url: "https://github.com/MinecraftForge/MinecraftForge/releases.atom",
        max: 5,
        // Each release is named by its Forge version, with "26.3 RB 1" (Minecraft version,
        // recommended build) as its notes.
        parse: (text) =>
            parseFeed(text).map((item) => {
                const m = /^(\d+(?:\.\d+)+)(?:\s+RB\s*(\d+))?/i.exec(item.summary);
                const forTitle = m ? ` for Minecraft ${m[1]}` : "";
                return {
                    ...item,
                    title: `Forge ${item.title}${forTitle}`,
                    summary: m
                        ? m[2]
                            ? `Recommended build ${m[2]} of Forge for Minecraft ${m[1]}.`
                            : `A new Forge line for Minecraft ${m[1]}.`
                        : item.summary || "A new Forge release.",
                    image: null,
                    category: "forge",
                };
            }),
    },
    {
        key: "forge-forums",
        label: "Forge forums",
        url: "https://forums.minecraftforge.net/forum/7-releases.xml/",
        max: 3,
        parse: (text) =>
            parseFeed(text).map((item) => ({ ...item, summary: item.summary || "Release announcement on the Forge forums.", category: "forge" })),
    },
    {
        key: "modrinth",
        label: "Modrinth",
        url: "https://modrinth.com/news/feed/rss.xml",
        max: 5,
        parse: (text) => parseFeed(text).map((item) => ({ ...item, category: "modding" })),
    },
    /* ---- General gaming news, for the launcher's main Home ---- */
    ...[
        ["pcgamer", "PC Gamer", "https://www.pcgamer.com/rss/"],
        ["eurogamer", "Eurogamer", "https://www.eurogamer.net/feed"],
        ["rps", "Rock Paper Shotgun", "https://www.rockpapershotgun.com/feed"],
        ["gamespot", "GameSpot", "https://www.gamespot.com/feeds/news/"],
        ["ign", "IGN", "https://feeds.feedburner.com/ign/news"],
        ["verge-games", "The Verge", "https://www.theverge.com/rss/games/index.xml"],
    ].map(([key, label, url]) => ({
        key,
        label,
        url,
        feed: "gaming",
        max: 8,
        parse: (text) => parseFeed(text).map((item) => ({ ...item, category: "gaming" })),
    })),
];

/* Bedrock's changelog on the feedback site, matched by version; the changelog list otherwise. */
function bedrockLink(version, links) {
    if (version && Array.isArray(links)) {
        const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`(^|[^\\d.])${escaped}(?![\\d])`);
        const found = links.find((a) => /bedrock/i.test(a.title) && pattern.test(a.title));
        if (found) return found.url;
    }
    return BEDROCK_CHANGELOGS;
}

async function bedrockLinks() {
    try {
        const json = JSON.parse((await fetchText(BEDROCK_CHANGELOG_LIST)).text);
        return (Array.isArray(json?.articles) ? json.articles : [])
            .map((a) => ({ title: String(a?.title ?? ""), url: httpsUrl(a?.html_url) }))
            .filter((a) => a.title && a.url && new URL(a.url).hostname === "feedback.minecraft.net");
    } catch {
        // Without it, Bedrock notes link to the changelog list.
        return null;
    }
}

/* ---------------- fetching ---------------- */

/*
 * A source's text, within the time limit and size cap. previous: the validators of what's
 * cached, to be told when nothing changed. -> { text, etag, lastModified } or { notModified }.
 */
async function fetchText(url, previous = null) {
    const headers = { "User-Agent": USER_AGENT, Accept: "application/json, application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5" };
    if (previous?.etag) headers["If-None-Match"] = previous.etag;
    if (previous?.lastModified) headers["If-Modified-Since"] = previous.lastModified;

    const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!httpsUrl(response.url || url)) throw new Error("It sent the request somewhere that isn't https.");
    if (response.status === 304 && previous) return { notModified: true };
    if (!response.ok) throw new Error(`The site answered ${response.status}.`);

    const declared = Number(response.headers.get("content-length"));
    if (declared > MAX_BYTES) throw new Error("Too large.");

    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
            await reader.cancel();
            throw new Error("Too large.");
        }
        chunks.push(value);
    }
    return {
        text: Buffer.concat(chunks).toString("utf8"),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
    };
}

/* A source's items, checked and trimmed: every one with a title, an https link and a date. */
function cleanItems(source, raw) {
    const items = [];
    const seen = new Set();
    for (const item of raw) {
        const title = shorten(plainText(item.title), 200);
        const url = httpsUrl(item.url);
        const date = item.date;
        if (!title || !url || !date || seen.has(url)) continue;
        seen.add(url);
        items.push({
            id: `${source.key}:${String(item.id || url).slice(0, 200)}`,
            title,
            summary: shorten(plainText(item.summary), 280),
            date,
            source: source.label,
            category: item.category,
            url,
            image: httpsUrl(item.image ?? undefined) ?? null,
        });
    }
    return items.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, source.max);
}

async function refreshSource(source, entry) {
    const cached = entry?.items?.length ? entry : null;
    const fetched = await fetchText(source.url, cached && { etag: cached.etag, lastModified: cached.lastModified });
    if (fetched.notModified) return { items: cached.items, etag: cached.etag, lastModified: cached.lastModified };
    const links = source.links ? await bedrockLinks() : undefined;
    const items = cleanItems(source, source.parse(fetched.text, links));
    if (!items.length) throw new Error("It had no news we could read.");
    return { items, etag: fetched.etag ?? null, lastModified: fetched.lastModified ?? null };
}

function readCache() {
    const cache = store.readJson(CACHE_FILE, null);
    return cache && cache.version === CACHE_VERSION && cache.sources && typeof cache.sources === "object"
        ? cache
        : { version: CACHE_VERSION, sources: {} };
}

const inFlight = new Map();

/* -> { items, failed, fetchedAt, fromCache } for one feed (see src/types/dashboard.d.ts). */
function getNews({ refresh = false, feed = "minecraft" } = {}) {
    const which = FEEDS.has(feed) ? feed : "minecraft";
    if (!inFlight.has(which)) {
        inFlight.set(
            which,
            loadNews(refresh, which).finally(() => {
                inFlight.delete(which);
            }),
        );
    }
    return inFlight.get(which);
}

async function loadNews(refresh, feed) {
    const now = Date.now();
    const cache = readCache();
    const failed = [];
    let fetchedAny = false;
    const sources = SOURCES.filter((source) => feedOf(source) === feed);

    await Promise.all(
        sources.map(async (source) => {
            const entry = cache.sources[source.key];
            const age = entry ? now - entry.attemptedAt : Infinity;
            const due = !entry || age >= (entry.ok ? FRESH_MS : RETRY_MS) || (refresh && age >= MIN_REFRESH_MS);
            if (!due) {
                if (!entry.ok) failed.push(source.label);
                return;
            }
            fetchedAny = true;
            try {
                const result = await refreshSource(source, entry);
                cache.sources[source.key] = { ...result, ok: true, attemptedAt: now, fetchedAt: now };
            } catch (err) {
                failed.push(source.label);
                console.warn(`News from ${source.label} couldn't be fetched:`, err?.message ?? err);
                // Its last good news stays.
                cache.sources[source.key] = { ...(entry ?? { items: [] }), ok: false, attemptedAt: now, error: String(err?.message ?? err) };
            }
        }),
    );

    if (fetchedAny) {
        try {
            // Both feeds share one cache file: keep what the other feed saved meanwhile.
            const latest = readCache();
            for (const source of sources) latest.sources[source.key] = cache.sources[source.key];
            store.writeJson(CACHE_FILE, latest);
        } catch (err) {
            console.warn("Couldn't save the news:", err.message);
        }
    }

    const items = [];
    const seen = new Set();
    for (const source of sources) {
        for (const item of cache.sources[source.key]?.items ?? []) {
            if (seen.has(item.url)) continue;
            seen.add(item.url);
            items.push(item);
        }
    }
    items.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

    const times = sources.map((s) => cache.sources[s.key]?.fetchedAt).filter(Number.isFinite);
    return {
        items,
        failed: sources.map((s) => s.label).filter((label) => failed.includes(label)),
        fetchedAt: new Date(times.length ? Math.max(...times) : now).toISOString(),
        fromCache: !fetchedAny,
    };
}

module.exports = { getNews, SOURCES, FEEDS, fetchText, _internal: { parseFeed, plainText, decodeEntities, httpsUrl, isoDate, cleanItems, bedrockLink, slug } };
