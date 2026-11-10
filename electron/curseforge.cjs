const { getSecret } = require("./secrets.cjs");

/*
 * Every CurseForge request goes through here. CurseForge's key belongs to the launcher,
 * not a player, and anything inside a downloaded app can be read out of it, so the app
 * carries none. It asks the launcher's proxy (proxy/curseforge), which adds the key
 * on a server. A key set on this computer is used directly instead, as when developing.
 */

// The deployed proxy (proxy/curseforge/README.md says how it's set up and updated).
const PROXY_URL = "https://unity-launcher-curseforge.unity-launcher.workers.dev";

const API = "https://api.curseforge.com";
const USER_AGENT = "UnityLauncher/1.0 (+https://github.com/harryforest2003/Launcher)";

/*
 * Where requests go. CURSEFORGE_PROXY_URL tries a proxy (such as `wrangler dev`) even
 * on a computer with a key. Otherwise a key here wins, then the launcher's proxy.
 */
function target() {
    const testing = process.env.CURSEFORGE_PROXY_URL;
    if (testing) return { base: testing.replace(/\/+$/, ""), headers: {} };

    const key = getSecret("curseforge");
    if (key) return { base: API, headers: { "x-api-key": key } };

    if (PROXY_URL) return { base: PROXY_URL.replace(/\/+$/, ""), headers: {} };

    return null;
}

function available() {
    return target() !== null;
}

/*
 * When CurseForge says it's had too many requests, nothing is sent until this time, so
 * waiting doesn't make it worse. Each request until then fails straight away.
 */
let pausedUntil = 0;

function busyError(now = Date.now()) {
    const seconds = Math.max(1, Math.ceil((pausedUntil - now) / 1000));
    const err = new Error(`CurseForge is busy, so it's paused for ${seconds} seconds. Try again then.`);
    err.code = "CURSEFORGE_BUSY";
    err.retryAfter = seconds;
    return err;
}

/* A request to CurseForge's API, given its path from /v1 on. Resolves with the Response. */
async function curseforgeFetch(path, { method = "GET", body } = {}) {
    const where = target();

    if (!where) {
        const err = new Error("CurseForge isn't available in this copy of the launcher yet.");
        err.code = "NO_API_KEY";
        throw err;
    }

    if (Date.now() < pausedUntil) throw busyError();

    const res = await fetch(`${where.base}/v1${path}`, {
        method,
        headers: {
            ...where.headers,
            Accept: "application/json",
            "User-Agent": USER_AGENT,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30 * 1000),
    });

    if (res.status === 429) {
        const wait = Number(res.headers.get("retry-after"));
        pausedUntil = Date.now() + (Number.isFinite(wait) && wait > 0 ? Math.min(wait, 600) : 60) * 1000;
        throw busyError();
    }

    return res;
}

/* The same, for the JSON answer. Anything but success is an error. */
async function curseforgeJson(path, options) {
    const res = await curseforgeFetch(path, options);
    if (!res.ok) throw new Error(`CurseForge HTTP ${res.status}`);
    return res.json();
}

module.exports = { available, curseforgeFetch, curseforgeJson };
