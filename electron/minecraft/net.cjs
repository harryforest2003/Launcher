const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getSecret } = require("../secrets.cjs");

/*
 * Download helpers for the instance pipeline.
 *
 * The old downloader.cjs piped https.get straight to a file with no
 * status check and no redirect handling, so a 302 (which Maven hosts use
 * constantly) silently produced an empty or HTML-filled ".jar".
 */

const USER_AGENT = "UnityLauncher/1.0";

function sha1(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha1");
        const stream = fs.createReadStream(filePath);

        stream.on("data", d => hash.update(d));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
    });
}

/*
 * Skip a download when the file is already present and matches its
 * expected hash. Makes re-running an install cheap and resumable.
 */
async function isValid(destination, expectedSha1, expectedSize, expectedSha512) {
    if (!fs.existsSync(destination)) return false;

    const stat = fs.statSync(destination);

    if (stat.size === 0) return false;
    if (expectedSize && stat.size !== expectedSize) return false;

    try {
        if (expectedSha1 && (await sha1(destination)) !== String(expectedSha1).toLowerCase()) return false;
        if (expectedSha512 && crypto.createHash("sha512").update(fs.readFileSync(destination)).digest("hex") !== String(expectedSha512).toLowerCase()) return false;
    } catch {
        return false;
    }

    return true;
}

/*
 * Whether a download address is allowed: https always when hosts is given, and then only
 * those hosts (as a modpack's own list of files must be, by the .mrpack format's rules).
 */
function allowedSource(url, hosts) {
    if (!hosts) return true;
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" && hosts.includes(parsed.hostname.toLowerCase()) && !parsed.username && !parsed.password;
    } catch {
        return false;
    }
}

// A download that sends nothing for this long is given up on and tried again. Without
// it, one connection that went quiet held up a whole install forever.
const IDLE_TIMEOUT_MS = 30 * 1000;

async function fetchBuffer(url) {
    const controller = new AbortController();
    let timer;

    const stillAlive = () => {
        clearTimeout(timer);
        timer = setTimeout(
            () => controller.abort(new Error(`No data for 30 seconds from ${url}`)),
            IDLE_TIMEOUT_MS
        );
    };

    stillAlive();

    try {
        const res = await fetch(url, {
            headers: { "User-Agent": USER_AGENT },
            redirect: "follow",
            signal: controller.signal,
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status} for ${url}`);
        }

        const chunks = [];

        for await (const chunk of res.body) {
            chunks.push(chunk);
            stillAlive();
        }

        return Buffer.concat(chunks);
    } finally {
        clearTimeout(timer);
    }
}

/*
 * Downloads url to destination, checked against the SHA-1 and SHA-512 given (either, both
 * or neither). hosts, when given, limits where it may come from (https only), and
 * requireHash refuses a file with no hash to check it against.
 */
async function downloadFile(url, destination, { sha1: expected, sha512: expected512, size, retries = 3, hosts, requireHash = false } = {}) {
    if (!allowedSource(url, hosts)) {
        throw new Error(`Refusing to download ${path.basename(destination)} from ${url}: it isn't from a site this file may come from.`);
    }
    if (requireHash && !expected && !expected512) {
        throw new Error(`Refusing to download ${path.basename(destination)}: there's no hash to check it against.`);
    }

    if (await isValid(destination, expected, size, expected512)) {
        return { destination, skipped: true };
    }

    fs.mkdirSync(path.dirname(destination), { recursive: true });

    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const buffer = await fetchBuffer(url);

            if (buffer.length === 0) {
                throw new Error(`Empty response for ${url}`);
            }

            // Write to a temp name first so an interrupted download can
            // never be mistaken for a complete file.
            const temp = `${destination}.part`;
            fs.writeFileSync(temp, buffer);

            const sha512Ok = !expected512 || crypto.createHash("sha512").update(buffer).digest("hex") === String(expected512).toLowerCase();
            if (expected || !sha512Ok) {
                const actual = expected ? crypto.createHash("sha1").update(buffer).digest("hex") : null;

                if ((expected && actual !== String(expected).toLowerCase()) || !sha512Ok) {
                    fs.rmSync(temp, { force: true });
                    throw new Error(
                        `Checksum mismatch for ${path.basename(destination)}`
                    );
                }
            }

            fs.renameSync(temp, destination);

            return { destination, skipped: false, bytes: buffer.length };

        } catch (err) {
            lastError = err;

            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 300 * attempt));
            }
        }
    }

    throw lastError;
}

// A Modrinth token, if one is saved, lets Modrinth show your own unlisted and draft projects.
function modrinthToken(url) {
    return String(url).startsWith("https://api.modrinth.com/") ? getSecret("modrinth") : null;
}

async function fetchJson(url) {
    const get = (token) =>
        fetch(url, {
            headers: { "User-Agent": USER_AGENT, ...(token ? { Authorization: token } : {}) },
            redirect: "follow",
            signal: AbortSignal.timeout(60 * 1000),
        });

    const token = modrinthToken(url);
    let res = await get(token);

    // A token revoked since it was saved shouldn't stop everything else working.
    if (res.status === 401 && token) res = await get(null);

    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

    return res.json();
}

/*
 * Runs tasks with bounded concurrency. Minecraft asset objects number in
 * the thousands; doing them one at a time takes many minutes, and doing
 * them all at once exhausts sockets.
 */
async function pool(items, worker, { concurrency = 16, onProgress } = {}) {
    let index = 0;
    let done = 0;

    const total = items.length;
    const errors = [];

    async function runner() {
        while (index < total) {
            const current = index++;

            try {
                await worker(items[current], current);
            } catch (err) {
                errors.push(err);
            }

            done++;

            if (onProgress) onProgress(done, total);
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(concurrency, total || 1) },
            () => runner()
        )
    );

    return { errors };
}

/*
 * "group:artifact:version" (optionally ":classifier") to a Maven path.
 * Fabric and Forge list libraries this way instead of giving a URL.
 */
function mavenToPath(name) {
    const [coords, ...rest] = name.split("@");     // strip @jar / @zip
    const extension = rest[0] || "jar";

    const parts = coords.split(":");

    const [group, artifact, version] = parts;
    const classifier = parts[3];

    const file = classifier
        ? `${artifact}-${version}-${classifier}.${extension}`
        : `${artifact}-${version}.${extension}`;

    return path.join(
        ...group.split("."),
        artifact,
        version,
        file
    );
}

function mavenToUrl(baseUrl, name) {
    const relative = mavenToPath(name).split(path.sep).join("/");

    return `${baseUrl.replace(/\/$/, "")}/${relative}`;
}

/*
 * The SHA-1 a Maven repository publishes beside a file (<file>.sha1), so a download from
 * it can be checked. Throws if there isn't one.
 */
async function publishedSha1(url) {
    const res = await fetch(`${url}.sha1`, { headers: { "User-Agent": "UnityLauncher/1.0" }, signal: AbortSignal.timeout(30 * 1000) });
    if (!res.ok) throw new Error(`No published checksum for ${path.basename(new URL(url).pathname)} (HTTP ${res.status}).`);
    const hash = (await res.text()).trim().match(/^[0-9a-f]{40}\b/i)?.[0];
    if (!hash) throw new Error(`The published checksum for ${path.basename(new URL(url).pathname)} couldn't be read.`);
    return hash.toLowerCase();
}

module.exports = {
    publishedSha1,
    downloadFile,
    fetchJson,
    pool,
    mavenToPath,
    mavenToUrl,
    sha1,
    isValid,
};
