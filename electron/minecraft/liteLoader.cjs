/*
 * LiteLoader, for Minecraft 1.5.2 to 1.12.2. It stopped in 2017, and its files stay where
 * they were: an index of builds at dl.liteloader.com, release jars there, and snapshot
 * jars in a Maven repository under dated names. It has no profile to download, so one is
 * made here: Minecraft starts through launchwrapper, which runs LiteLoader's tweaker.
 */
const { fetchJson } = require("./net.cjs");

const INDEX = "https://dl.liteloader.com/versions/versions.json";
const LAUNCHWRAPPER = "net.minecraft.launchwrapper.Launch";
const MOJANG_LIBRARIES = "https://libraries.minecraft.net/";
const MAVEN_CENTRAL = "https://repo1.maven.org/maven2/";

let cached = null;
async function index() {
    if (!cached) cached = fetchJson(INDEX).catch((err) => {
        cached = null;
        throw err;
    });
    return cached;
}

const https = (url) => String(url ?? "").replace(/^http:\/\//, "https://").replace(/\/?$/, "/");

/*
 * The builds for a Minecraft version, releases first, newest first:
 * [{ version, stable, repo, entry, libraries }]. The index lists each build by its
 * checksum plus a "latest" copy; the copies are left out.
 */
function buildsFrom(data, mcVersion) {
    const forVersion = data?.versions?.[mcVersion];
    if (!forVersion) return [];
    const builds = [];
    for (const stream of ["artefacts", "snapshots"]) {
        const group = forVersion[stream];
        const entries = group?.["com.mumfrey:liteloader"] ?? {};
        for (const [key, entry] of Object.entries(entries)) {
            if (key === "latest" || !entry?.version) continue;
            builds.push({
                version: entry.version,
                stable: stream === "artefacts",
                repo: forVersion.repo,
                entry,
                libraries: group.libraries ?? [],
            });
        }
    }
    const order = (version) => version.split(/[._-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : 0));
    const newer = (a, b) => {
        const [x, y] = [order(a.version), order(b.version)];
        for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
        return 0;
    };
    const seen = new Set();
    return builds
        .sort((a, b) => Number(b.stable) - Number(a.stable) || newer(a, b))
        .filter((build) => !seen.has(build.version) && seen.add(build.version));
}

/* Minecraft versions LiteLoader has builds for. */
async function gameVersions() {
    return Object.keys((await index())?.versions ?? {});
}

async function listVersions(mcVersion) {
    return buildsFrom(await index(), mcVersion).map(({ version, stable }) => ({ version, stable }));
}

async function latestVersion(mcVersion) {
    return buildsFrom(await index(), mcVersion)[0]?.version ?? null;
}

/*
 * A snapshot in a Maven repository is stored under the date it was built, which its
 * maven-metadata.xml gives: mixin 0.7.4-SNAPSHOT is mixin-0.7.4-20171010.121826-8.jar.
 */
function snapshotFile(artifact, version, metadataXml) {
    const timestamp = /<timestamp>([^<]+)<\/timestamp>/.exec(metadataXml)?.[1];
    const build = /<buildNumber>([^<]+)<\/buildNumber>/.exec(metadataXml)?.[1];
    if (!timestamp || !build) return `${artifact}-${version}.jar`;
    return `${artifact}-${version.replace(/-SNAPSHOT$/, "")}-${timestamp}-${build}.jar`;
}

async function fetchText(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30 * 1000) });
    if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}.`);
    return res.text();
}

/* A library entry with its file's address worked out, for a coordinate and a repository. */
async function library(name, repo, { read = fetchText } = {}) {
    const [group, artifact, version] = name.split(":");
    const folder = `${group.replace(/\./g, "/")}/${artifact}/${version}`;
    const base = https(repo);
    const file = version.endsWith("-SNAPSHOT")
        ? snapshotFile(artifact, version, await read(`${base}${folder}/maven-metadata.xml`))
        : `${artifact}-${version}.jar`;
    // Stored under the plain name, as every other library is.
    return { name, downloads: { artifact: { path: `${folder}/${artifact}-${version}.jar`, url: `${base}${folder}/${file}` } } };
}

/* Where a library LiteLoader names without a repository comes from. */
const repoFor = (lib) => lib.url || (lib.name.startsWith("net.minecraft:") ? MOJANG_LIBRARIES : MAVEN_CENTRAL);

/*
 * The profile to put over Minecraft's own: LiteLoader and what it needs first on the
 * classpath, launchwrapper as the main class, and LiteLoader's tweaker added to the
 * game's arguments (see mergeVersions' tweakers).
 */
async function profile(mcVersion, loaderVersion, options = {}) {
    const build = buildsFrom(options.data ?? (await index()), mcVersion).find((b) => b.version === loaderVersion);
    if (!build) throw new Error(`LiteLoader has no build ${loaderVersion} for Minecraft ${mcVersion}.`);

    const needs = new Map();
    for (const lib of [...build.libraries, ...(build.entry.libraries ?? [])]) {
        if (lib?.name) needs.set(lib.name.split(":").slice(0, 2).join(":"), lib);
    }
    const libraries = [await library(`com.mumfrey:liteloader:${build.version}`, build.repo?.url, options)];
    for (const lib of needs.values()) libraries.push(await library(lib.name, repoFor(lib), options));

    return {
        id: `${mcVersion}-LiteLoader${mcVersion}`,
        mainClass: LAUNCHWRAPPER,
        tweakers: [build.entry.tweakClass || "com.mumfrey.liteloader.launch.LiteLoaderTweaker"],
        libraries,
    };
}

module.exports = { gameVersions, listVersions, latestVersion, profile, buildsFrom, snapshotFile, library };
