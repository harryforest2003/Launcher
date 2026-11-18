/*
 * Requests to the mod sites beyond Nexus Mods and CurseForge. Every one says it's the
 * launcher (never who's using it), gives up after a while, and says which site went
 * wrong. Answers that rarely change are kept in memory for a while, so browsing back
 * and forth doesn't ask the site again.
 */

const USER_AGENT = "UnityLauncher/1.0 (game mod manager)";

function failure(message, code, status) {
    const err = new Error(message);
    if (code) err.code = code;
    if (status) err.status = status;
    return err;
}

/*
 * A site's JSON answer. label names the site in errors; keyed says the request carried
 * the player's key, so a refusal means the key is wrong rather than the site being shut.
 */
async function getJson(url, { label, keyed = false, method = "GET", headers = {}, body, timeout = 20000 } = {}) {
    let res;
    try {
        res = await fetch(url, {
            method,
            headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
            body,
            signal: AbortSignal.timeout(timeout),
        });
    } catch (err) {
        throw failure(`${label} couldn't be reached (${err.name === "TimeoutError" ? "it took too long" : err.message}).`, "OFFLINE");
    }
    if (keyed && (res.status === 401 || res.status === 403)) throw failure(`${label} didn't accept your key. Check it in Settings → API keys.`, "BAD_KEY", res.status);
    if (res.status === 429) throw failure(`${label} is busy. Try again in a minute.`, "RATE_LIMITED", 429);
    if (!res.ok) throw failure(`${label} answered ${res.status}.`, null, res.status);
    try {
        return await res.json();
    } catch {
        throw failure(`${label} sent back something that isn't a mod list.`);
    }
}

const cache = new Map();

/* run()'s answer, kept for ttl milliseconds under key. A failure isn't kept. */
async function remembered(key, ttl, run) {
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = run();
    cache.set(key, { value, until: Date.now() + ttl });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    try {
        return await value;
    } catch (err) {
        if (cache.get(key)?.value === value) cache.delete(key);
        throw err;
    }
}

/* Forgets kept answers whose key starts with prefix (after a key changes, say). */
function forget(prefix) {
    for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}

/* A site's description given as plain text, as HTML the mod page can sanitise. */
function textHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\r?\n/g, "<br>");
}

/* Lower-case letters and digits only, for matching game names across sites. */
const plain = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

module.exports = { USER_AGENT, getJson, remembered, forget, failure, textHtml, plain };
