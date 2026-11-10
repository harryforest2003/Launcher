const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const unzipper = require("unzipper");
const { getSecret } = require("../secrets.cjs");

/*
 * Installing from a GitHub repository's releases. GitHub knows nothing about Minecraft,
 * so a mod's own description, inside its .jar, is read to check that it runs on the
 * instance. Packs carry no such description, so they can't be checked.
 */

const API = "https://api.github.com";
const MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024;

const FILES_BY_TYPE = {
    mod: /\.jar$/i,
    resourcepack: /\.zip$/i,
    shader: /\.zip$/i,
    datapack: /\.(zip|jar)$/i,
};

// Files releases often attach for developers, which are never what goes in an instance.
const FOR_DEVELOPERS = /-(sources|javadoc|dev|dev-shadow)\.jar$/i;

function parseRepo(input) {
    const text = String(input ?? "").trim().replace(/\.git$/i, "").replace(/\/+$/, "");
    const match =
        text.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/i) ??
        text.match(/^([\w.-]+)\/([\w.-]+)$/);

    if (!match) throw new Error('Enter a GitHub repository as "owner/name", or paste its link.');
    return `${match[1]}/${match[2]}`;
}

function headers() {
    const token = getSecret("github");
    return {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "UnityLauncher",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

async function github(route) {
    const res = await fetch(API + route, { headers: headers(), signal: AbortSignal.timeout(20 * 1000) });

    if (res.ok) return res.json();

    if (res.status === 404) throw new Error("GitHub has no public repository by that name.");

    if (res.status === 401) throw new Error("GitHub didn't accept the token in Settings. Check it, or remove it.");

    if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
        const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
        const when = reset
            ? new Date(reset).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "later";

        throw new Error(
            getSecret("github")
                ? `GitHub's hourly limit is used up. Try again after ${when}.`
                : `GitHub allows 60 requests an hour without a token, and they're used up until ${when}. ` +
                  "Adding a GitHub token in Settings raises the limit."
        );
    }

    throw new Error(`GitHub said no (HTTP ${res.status}).`);
}

async function listReleases(input, type = "mod") {
    const asked = parseRepo(input);
    const wanted = FILES_BY_TYPE[type] ?? FILES_BY_TYPE.mod;
    const releases = await github(`/repos/${asked}/releases?per_page=15`);

    // GitHub quietly follows a renamed or moved repository, so its current name is
    // taken from what came back. Install checks files against that name.
    const repo = releases[0]?.html_url?.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/releases\//)?.[1] ?? asked;

    const usable = releases
        .filter((release) => !release.draft)
        .map((release) => ({
            tag: release.tag_name,
            name: release.name || release.tag_name,
            published: release.published_at,
            prerelease: release.prerelease,
            assets: release.assets
                .filter((asset) => wanted.test(asset.name) && !FOR_DEVELOPERS.test(asset.name))
                .map((asset) => ({
                    name: asset.name,
                    size: asset.size,
                    url: asset.browser_download_url,
                    digest: asset.digest ?? null,
                })),
        }))
        .filter((release) => release.assets.length > 0)
        .slice(0, 6);

    return { repo, releases: usable };
}

/* ---------------- does a mod run on this instance? ---------------- */

function versionNumbers(version) {
    return String(version).trim().split(/[-+\s]/)[0].split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function compare(a, b) {
    const x = versionNumbers(a);
    const y = versionNumbers(b);

    for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
        const difference = (x[i] ?? 0) - (y[i] ?? 0);
        if (difference) return Math.sign(difference);
    }

    return 0;
}

/* One of Fabric's version terms, such as ">=1.21", "~1.21.1", "1.21.x" or "*". */
function matchesTerm(version, term) {
    if (!term || term === "*") return true;

    const operator = term.match(/^(>=|<=|>|<|=|~|\^)?(.*)$/);
    const op = operator[1] ?? "";
    const target = operator[2].trim();

    if (/[xX*]/.test(target)) {
        const prefix = target.split(/\.?[xX*]/)[0];
        return !prefix || String(version) === prefix || String(version).startsWith(`${prefix}.`);
    }

    const order = compare(version, target);
    const [major, minor] = versionNumbers(target);

    switch (op) {
        case ">=": return order >= 0;
        case "<=": return order <= 0;
        case ">": return order > 0;
        case "<": return order < 0;
        case "~": return order >= 0 && compare(version, `${major}.${(minor ?? 0) + 1}`) < 0;
        case "^": return order >= 0 && compare(version, `${major + 1}`) < 0;
        default: return order === 0;
    }
}

/* Fabric and Quilt: a list means any of them, spaces within one mean all of them. */
function matchesFabric(version, predicate) {
    if (predicate === undefined || predicate === null) return true;
    if (Array.isArray(predicate)) return predicate.some((entry) => matchesFabric(version, entry));
    return String(predicate).split(/\s+/).filter(Boolean).every((term) => matchesTerm(version, term));
}

/* Forge and NeoForge use Maven ranges, such as "[1.20.1,1.21)". */
function matchesMaven(version, range) {
    const text = String(range).trim();
    if (!text || text === "*") return true;

    const sets = text.match(/[[(][^\])]*[\])]/g);
    if (!sets) return compare(version, text) >= 0;

    return sets.some((set) => {
        const lowClosed = set[0] === "[";
        const highClosed = set[set.length - 1] === "]";
        const [low, high = low] = set.slice(1, -1).split(",").map((part) => part.trim());
        const single = !set.includes(",");

        if (single) return compare(version, low) === 0;
        if (low && (lowClosed ? compare(version, low) < 0 : compare(version, low) <= 0)) return false;
        if (high && (highClosed ? compare(version, high) > 0 : compare(version, high) >= 0)) return false;
        return true;
    });
}

function tomlMinecraftRange(toml) {
    for (const block of toml.split(/\[\[\s*dependencies\.[^\]]+\]\]/).slice(1)) {
        if (!/modId\s*=\s*["']minecraft["']/.test(block)) continue;
        return block.match(/versionRange\s*=\s*["']([^"']*)["']/)?.[1] ?? null;
    }
    return null;
}

async function readModInfo(buffer) {
    const archive = await unzipper.Open.buffer(buffer);
    const read = async (name) => {
        const entry = archive.files.find((file) => file.path === name);
        return entry ? (await entry.buffer()).toString("utf8") : null;
    };

    const fabric = await read("fabric.mod.json");
    if (fabric) {
        const info = JSON.parse(fabric);
        return { loaders: ["fabric"], minecraft: info.depends?.minecraft ?? null, kind: "fabric", name: info.name, version: info.version };
    }

    const quilt = await read("quilt.mod.json");
    if (quilt) {
        const loader = JSON.parse(quilt).quilt_loader ?? {};
        const minecraft = (loader.depends ?? []).find((entry) => entry === "minecraft" || entry?.id === "minecraft");
        return { loaders: ["quilt"], minecraft: minecraft?.versions ?? null, kind: "fabric", name: loader.metadata?.name, version: loader.version };
    }

    const neoforge = await read("META-INF/neoforge.mods.toml");
    if (neoforge) return { loaders: ["neoforge"], minecraft: tomlMinecraftRange(neoforge), kind: "maven" };

    const forge = await read("META-INF/mods.toml");
    if (forge) return { loaders: ["forge"], minecraft: tomlMinecraftRange(forge), kind: "maven" };

    return null;
}

/*
 * Many mods don't list their Minecraft versions, but name the one they're built for,
 * as in "appleskin-fabric-mc26.2-3.0.10.jar" or "3.0.10+mc26.2".
 */
function namedMinecraftVersion(...texts) {
    for (const text of texts) {
        const match = String(text ?? "").match(/(?:^|[-_+])mc[-_]?(\d+(?:\.\d+){1,2})(?=$|[-_+]|\.(?!\d))/i);
        if (match) return match[1];
    }
    return null;
}

const LOADER_NAMES = { fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge", vanilla: "Vanilla" };

/* Whether a mod file runs on the instance: true, false, or null if it can't tell. */
async function checkMod(buffer, instance, fileName = "") {
    let info;

    try {
        info = await readModInfo(buffer);
    } catch {
        return { fits: null, reason: "This file couldn't be read as a mod." };
    }

    if (!info) {
        return { fits: null, reason: "This file doesn't say which Minecraft version or loader it's for." };
    }

    const about = { name: info.name ?? null, version: info.version ?? null };

    const loader = String(instance.loader || "vanilla").toLowerCase();
    // Quilt runs Fabric mods too.
    const loaderFits = info.loaders.includes(loader) || (loader === "quilt" && info.loaders.includes("fabric"));
    const madeFor = info.loaders.map((name) => LOADER_NAMES[name]).join(" or ");

    if (!loaderFits) {
        return { ...about, fits: false, reason: `This is a ${madeFor} mod, and this instance uses ${LOADER_NAMES[loader] ?? loader}.` };
    }

    if (!info.minecraft || /\$\{/.test(info.minecraft)) {
        const named = namedMinecraftVersion(fileName, info.version);

        if (!named) {
            return { ...about, fits: null, reason: `This ${madeFor} mod doesn't say which Minecraft versions it supports.` };
        }

        return named === String(instance.version)
            ? { ...about, fits: true, reason: null }
            : { ...about, fits: false, reason: `This mod's name says it's for Minecraft ${named}, and this instance is ${instance.version}.` };
    }

    const fits = info.kind === "maven"
        ? matchesMaven(instance.version, info.minecraft)
        : matchesFabric(instance.version, info.minecraft);

    const range = Array.isArray(info.minecraft) ? info.minecraft.join(" or ") : info.minecraft;

    return fits
        ? { ...about, fits: true, reason: null }
        : { ...about, fits: false, reason: `This mod is for Minecraft ${range}, and this instance is ${instance.version}.` };
}

/* ---------------- installing ---------------- */

async function download(url, digest) {
    const res = await fetch(url, { headers: { "User-Agent": "UnityLauncher" }, signal: AbortSignal.timeout(120 * 1000) });
    if (!res.ok) throw new Error(`The download failed (HTTP ${res.status}).`);

    const size = Number(res.headers.get("content-length") || 0);
    if (size > MAX_DOWNLOAD_BYTES) throw new Error("That file is too large to be a mod or pack.");

    const buffer = Buffer.from(await res.arrayBuffer());

    // GitHub lists a SHA-256 for newer release files.
    if (/^sha256:/i.test(digest ?? "")) {
        const actual = crypto.createHash("sha256").update(buffer).digest("hex");
        if (actual !== digest.slice(7).toLowerCase()) throw new Error("The download was damaged on the way. Try again.");
    }

    return buffer;
}

/*
 * Downloads one release file and installs it, unless it's for a different version or
 * loader, or can't be checked. Then it says why and waits for force to be set.
 */
async function installAsset(instance, instanceFolder, installContent, request) {
    const { repo, tag, asset, type = "mod", world, force } = request;
    const fullRepo = parseRepo(repo);

    // Only files from this repository's own releases.
    if (!String(asset?.url).startsWith(`https://github.com/${fullRepo}/releases/download/`)) {
        throw new Error("That isn't a file from this repository's releases.");
    }

    const buffer = await download(asset.url, asset.digest);

    let about = {};

    if (type === "mod" && /\.jar$/i.test(asset.name)) {
        const check = await checkMod(buffer, instance, asset.name);
        if (check.fits !== true && !force) return { needsConfirm: true, reason: check.reason };
        about = check;
    }

    const temporary = path.join(os.tmpdir(), `unity-github-${crypto.randomUUID()}`);
    fs.writeFileSync(temporary, buffer);

    try {
        const result = await installContent(instanceFolder, {
            type: /\.jar$/i.test(asset.name) ? "mod" : type,
            world,
            localFile: temporary,
            fileName: asset.name,
            // The mod's own name and version where it gives them, since one release can
            // hold several versions.
            name: about.name || `${fullRepo.split("/")[1]} ${tag}`,
            source: "github",
            projectId: fullRepo,
            versionNumber: about.version || tag,
        });

        return { installed: result };
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}

module.exports = {
    parseRepo,
    listReleases,
    checkMod,
    installAsset,
    matchesFabric,
    matchesMaven,
    namedMinecraftVersion,
};
