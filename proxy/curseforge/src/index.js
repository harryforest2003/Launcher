/*
 * Unity Launcher's proxy, a Cloudflare Worker: CurseForge, and the Steam Workshop.
 *
 * CurseForge gives API keys to apps, not players, and anything inside a downloaded app
 * can be read out of it. So the launcher carries no key: it asks this Worker, which adds
 * the key on Cloudflare's side and passes the answer back. The keys live only in the
 * Worker's secret store (wrangler secret put CURSEFORGE_API_KEY, STEAM_WEB_API_KEY).
 *
 * Steam's Workshop search needs a Steam Web API key too. Players can add their own in the
 * launcher's Settings; everyone else's searches come here, under /steam/.
 *
 * Only the requests the launcher makes get through, at a limited rate, so the keys
 * can't be borrowed for anything else.
 */

const UPSTREAM = "https://api.curseforge.com";

// Requests the launcher makes, and how long (in seconds) an answer may be reused.
const GET_ROUTES = [
  { path: /^\/v1\/mods\/search$/, cache: 300 },
  { path: /^\/v1\/mods\/\d+$/, cache: 600 },
  { path: /^\/v1\/mods\/\d+\/files$/, cache: 600 },
  { path: /^\/v1\/mods\/\d+\/description$/, cache: 3600 },
  // Every game CurseForge hosts mods for, for "Add a game".
  { path: /^\/v1\/games$/, cache: 86400 },
];

// Batch lookups, used when installing a modpack. Each takes one list of numbers.
const POST_ROUTES = {
  "/v1/mods": "modIds",
  "/v1/mods/files": "fileIds",
};

const STEAM = "https://api.steampowered.com";

// Query words a Steam request may carry, each with what it may hold. Anything else is
// dropped, a caller's own "key" included.
const number = (max) => (value) => /^\d{1,20}$/.test(value) && (max === undefined || Number(value) <= max);
const flag = (value) => value === "true" || value === "false";
const text = (max) => (value) => value.length <= max;

// Workshop calls the launcher makes, and how long (in seconds) an answer may be reused.
const STEAM_ROUTES = {
  "/steam/IPublishedFileService/QueryFiles/v1/": {
    cache: 300,
    required: ["appid"],
    params: {
      appid: number(),
      query_type: number(100),
      page: number(1000),
      numperpage: number(100),
      days: number(3650),
      filetype: number(100),
      return_vote_data: flag,
      return_short_description: flag,
      return_details: flag,
      totalonly: flag,
      search_text: text(200),
      cursor: text(200),
    },
  },
  "/steam/IPublishedFileService/GetDetails/v1/": {
    cache: 600,
    required: ["publishedfileids[0]"],
    params: {
      ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`publishedfileids[${i}]`, number()])),
      includeadditionalpreviews: flag,
      includechildren: flag,
    },
  },
  "/steam/ISteamUser/GetPlayerSummaries/v2/": {
    cache: 3600,
    required: ["steamids"],
    params: { steamids: (value) => /^\d{1,20}(,\d{1,20}){0,99}$/.test(value) },
  },
};

/* A Steam request's query, rebuilt from the words it may carry, or null if one is wrong. */
function steamQuery(route, search) {
  const out = new URLSearchParams();
  for (const [name, value] of search) {
    const valid = route.params[name];
    if (!valid) continue;
    if (!valid(value)) return null;
    out.set(name, value);
  }
  return route.required.every((name) => out.has(name)) ? out : null;
}

const MAX_IDS = 50;
const MAX_BODY_BYTES = 4096;

// Used when no rate limiting binding is set up. Each Cloudflare machine counts on its
// own, so it's rougher, but it still stops one address hammering the key.
const FALLBACK_LIMIT = 120;
const FALLBACK_WINDOW_MS = 60 * 1000;
const counts = new Map();

function fallbackLimit(key, now = Date.now()) {
  const entry = counts.get(key);

  if (!entry || now >= entry.resetAt) {
    counts.set(key, { used: 1, resetAt: now + FALLBACK_WINDOW_MS });
    if (counts.size > 10000) counts.clear();
    return true;
  }

  entry.used += 1;
  return entry.used <= FALLBACK_LIMIT;
}

function reply(status, message, headers = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const busy = () => reply(429, "Too many requests. Try again in a minute.", { "Retry-After": "60" });

/* The body of a batch lookup, rebuilt from scratch so nothing else is passed on. */
async function batchBody(request, field) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const ids = parsed?.[field];
  const valid =
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.length <= MAX_IDS &&
    ids.every((id) => Number.isSafeInteger(id) && id > 0);

  return valid ? JSON.stringify({ [field]: ids }) : null;
}

/* A Workshop request, with the launcher's Steam key added. */
async function steam(request, env, url, route) {
  if (!env.STEAM_WEB_API_KEY) return reply(503, "This proxy has no Steam key yet.");
  if (request.method !== "GET") return reply(405, "Only GET here.");

  const query = steamQuery(route, url.searchParams);
  if (!query) return reply(400, "That isn't a request the launcher makes.");

  const caller = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await allow(env, `steam:${caller}`))) return busy();

  query.set("key", env.STEAM_WEB_API_KEY);
  const upstream = await fetch(`${STEAM}${url.pathname.slice("/steam".length)}?${query}`, {
    headers: { Accept: "application/json", "User-Agent": "UnityLauncher-proxy/1.0 (+https://github.com/harryforest2003/Launcher)" },
    cf: { cacheTtl: route.cache, cacheEverything: true },
  });
  if (upstream.status === 429) return busy();

  const out = new Headers({ "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" });
  if (upstream.ok) out.set("Cache-Control", `public, max-age=${route.cache}`);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

// Counted per address. Many players can share one (a school network, say), so the
// limit is generous; it's there to stop someone using a key for something else.
async function allow(env, key) {
  return env.LIMITER ? (await env.LIMITER.limit({ key })).success : fallbackLimit(key);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Which sites this proxy has a key for, so the launcher knows what to ask it.
    if (url.pathname === "/status" && request.method === "GET") {
      return new Response(JSON.stringify({ curseforge: Boolean(env.CURSEFORGE_API_KEY), steam: Boolean(env.STEAM_WEB_API_KEY) }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      });
    }

    const steamRoute = STEAM_ROUTES[url.pathname];
    if (steamRoute) return steam(request, env, url, steamRoute);

    const getRoute = request.method === "GET" && GET_ROUTES.find((route) => route.path.test(url.pathname));
    const postField = request.method === "POST" && POST_ROUTES[url.pathname];

    if (!getRoute && !postField) return reply(404, "Not something this proxy does.");

    if (!env.CURSEFORGE_API_KEY) {
      return reply(503, "This proxy has no CurseForge key yet.");
    }

    const caller = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!(await allow(env, caller))) return busy();

    const headers = {
      "x-api-key": env.CURSEFORGE_API_KEY,
      Accept: "application/json",
      "User-Agent": "UnityLauncher-proxy/1.0 (+https://github.com/harryforest2003/Launcher)",
    };

    let upstream;

    if (getRoute) {
      upstream = await fetch(`${UPSTREAM}${url.pathname}${url.search}`, {
        headers,
        // Popular searches and projects are answered from Cloudflare's cache.
        cf: { cacheTtl: getRoute.cache, cacheEverything: true },
      });
    } else {
      const body = await batchBody(request, postField);
      if (!body) return reply(400, `Send {"${postField}": [up to ${MAX_IDS} numbers]}.`);

      upstream = await fetch(`${UPSTREAM}${url.pathname}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body,
      });
    }

    if (upstream.status === 429) return busy();

    // Only the answer itself, never CurseForge's own headers.
    const out = new Headers({ "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" });
    if (getRoute && upstream.ok) out.set("Cache-Control", `public, max-age=${getRoute.cache}`);

    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
