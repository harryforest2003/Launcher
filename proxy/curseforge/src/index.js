/*
 * Unity Launcher's CurseForge proxy, a Cloudflare Worker.
 *
 * CurseForge gives API keys to apps, not players, and anything inside a downloaded app
 * can be read out of it. So the launcher carries no key: it asks this Worker, which adds
 * the key on Cloudflare's side and passes the answer back. The key lives only in the
 * Worker's secret store (wrangler secret put CURSEFORGE_API_KEY).
 *
 * Only the requests the launcher makes get through, at a limited rate, so the key
 * can't be borrowed for anything else.
 */

const UPSTREAM = "https://api.curseforge.com";

// Requests the launcher makes, and how long (in seconds) an answer may be reused.
const GET_ROUTES = [
  { path: /^\/v1\/mods\/search$/, cache: 300 },
  { path: /^\/v1\/mods\/\d+$/, cache: 600 },
  { path: /^\/v1\/mods\/\d+\/files$/, cache: 600 },
  { path: /^\/v1\/mods\/\d+\/description$/, cache: 3600 },
];

// Batch lookups, used when installing a modpack. Each takes one list of numbers.
const POST_ROUTES = {
  "/v1/mods": "modIds",
  "/v1/mods/files": "fileIds",
};

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!env.CURSEFORGE_API_KEY) {
      return reply(503, "This proxy has no CurseForge key yet.");
    }

    const getRoute = request.method === "GET" && GET_ROUTES.find((route) => route.path.test(url.pathname));
    const postField = request.method === "POST" && POST_ROUTES[url.pathname];

    if (!getRoute && !postField) return reply(404, "Not something this proxy does.");

    // Counted per address. Many players can share one (a school network, say), so the
    // limit is generous; it's there to stop someone using the key for something else.
    const caller = request.headers.get("cf-connecting-ip") ?? "unknown";
    const allowed = env.LIMITER ? (await env.LIMITER.limit({ key: caller })).success : fallbackLimit(caller);
    if (!allowed) return busy();

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
