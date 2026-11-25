const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const { fetchJson, downloadFile, publishedSha1 } = require("./net.cjs");
const { parseVersion, compare } = require("./compat.cjs");
const liteLoader = require("./liteLoader.cjs");

/*
 * Mod loader installation.
 *
 * Fabric and Quilt publish a ready-made profile JSON, so installing them
 * is just "fetch JSON, download the libraries it names". Legacy Fabric (Minecraft
 * 1.13.2 and older) and Babric (Beta 1.7.3) are Fabric builds with the same metadata.
 * LiteLoader (1.5.2 to 1.12.2) has none, so liteLoader.cjs makes its profile.
 *
 * Forge and NeoForge do not. Their metadata lives inside an installer
 * jar that has to be executed (it runs binary-patching processors), so
 * those go through `java -jar ... --installClient`.
 */

const FABRIC_META = "https://meta.fabricmc.net/v2";
const QUILT_META = "https://meta.quiltmc.org/v3";
const LEGACY_FABRIC_META = "https://meta.legacyfabric.net/v2";
const BABRIC_META = "https://meta.babric.glass-launcher.net/v2";

// Loaders with Fabric's kind of metadata: a list of builds and a profile per build.
const FABRIC_LIKE = {
    fabric: FABRIC_META,
    quilt: QUILT_META,
    "legacy-fabric": LEGACY_FABRIC_META,
    babric: BABRIC_META,
};
const FORGE_PROMOS =
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const NEOFORGE_MAVEN =
    "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";

/* =========================================================
   LATEST COMPATIBLE VERSION
========================================================= */

async function latestFabric(mcVersion, base = FABRIC_META) {
    const list = await fetchJson(`${base}/versions/loader/${mcVersion}`);

    if (!list?.length) return null;

    // Prefer a stable loader; fall back to the newest available.
    const stable = list.find(entry => entry.loader?.stable);

    return (stable ?? list[0]).loader.version;
}

async function latestQuilt(mcVersion) {
    const list = await fetchJson(`${QUILT_META}/versions/loader/${mcVersion}`);

    if (!list?.length) return null;

    // Quilt marks betas in the version string rather than a flag.
    const stable = list.find(e => !/beta|pre|rc/i.test(e.loader?.version ?? ""));

    return (stable ?? list[0]).loader.version;
}

async function latestForge(mcVersion) {
    const promos = await fetchJson(FORGE_PROMOS);

    const recommended = promos?.promos?.[`${mcVersion}-recommended`];
    const latest = promos?.promos?.[`${mcVersion}-latest`];

    const build = recommended ?? latest;

    return build ? `${mcVersion}-${build}` : null;
}

/*
 * The start of every NeoForge build for a Minecraft version: 1.21.1 -> "21.1.", and since
 * Minecraft's year numbering, 26.2 -> "26.2.0.".
 */
function neoforgePrefix(mcVersion) {
    const parts = mcVersion.split(".");
    if (parts.length < 2) return null;
    if (parts[0] === "1") return `${parts[1]}.${parts[2] ?? "0"}.`;
    return `${parts[0]}.${parts[1]}.${parts[2] ?? "0"}.`;
}

async function latestNeoForge(mcVersion) {
    const meta = await fetchJson(NEOFORGE_MAVEN);
    const all = meta?.versions ?? [];

    const prefix = neoforgePrefix(mcVersion);
    if (!prefix) return null;

    const matching = all.filter(v => v.startsWith(prefix));
    if (matching.length === 0) return null;

    const stable = matching.filter(v => !/beta|alpha|rc/i.test(v));

    const pool = stable.length ? stable : matching;

    return pool[pool.length - 1];
}

async function getLatestLoaderVersion(loader, mcVersion) {
    switch ((loader || "").toLowerCase()) {
        case "fabric": return latestFabric(mcVersion);
        case "legacy-fabric": return latestFabric(mcVersion, LEGACY_FABRIC_META);
        case "babric": return latestFabric(mcVersion, BABRIC_META);
        case "liteloader": return liteLoader.latestVersion(mcVersion);
        case "quilt": return latestQuilt(mcVersion);
        case "forge": return latestForge(mcVersion);
        case "neoforge": return latestNeoForge(mcVersion);
        default: return null;
    }
}

/* =========================================================
   EVERY VERSION
========================================================= */

const FORGE_MAVEN_METADATA =
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";

const looksUnstable = (version) => /alpha|beta|pre|rc/i.test(version);

/*
 * Every build of a loader for a Minecraft version, newest first:
 * [{ version, stable }]. Forge's are named "1.20.1-47.4.10", like the instance records them.
 */
async function listLoaderVersions(loader, mcVersion) {
    let list = [];

    switch ((loader || "").toLowerCase()) {
        case "fabric":
        case "quilt":
        case "legacy-fabric":
        case "babric": {
            const base = FABRIC_LIKE[loader.toLowerCase()];
            const entries = await fetchJson(`${base}/versions/loader/${mcVersion}`);
            // Fabric only flags its newest build as stable, so the name decides.
            list = (entries ?? []).map(entry => entry.loader?.version).filter(Boolean);
            break;
        }
        case "forge": {
            const res = await fetch(FORGE_MAVEN_METADATA, { signal: AbortSignal.timeout(30 * 1000) });
            if (!res.ok) throw new Error(`Forge's version list answered HTTP ${res.status}.`);
            const xml = await res.text();
            list = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
                .map(match => match[1])
                .filter(version => version.startsWith(`${mcVersion}-`));
            break;
        }
        case "liteloader":
            return liteLoader.listVersions(mcVersion);
        case "neoforge": {
            const prefix = neoforgePrefix(mcVersion);
            const meta = await fetchJson(NEOFORGE_MAVEN);
            list = prefix ? (meta?.versions ?? []).filter(v => v.startsWith(prefix)) : [];
            break;
        }
        default:
            return [];
    }

    const plain = (version) => version.replace(/^\d+(\.\d+)*-(?=\d)/, "");
    return [...new Set(list)]
        .map(version => ({ version, stable: !looksUnstable(version), parsed: parseVersion(plain(version)) }))
        .sort((a, b) => (a.parsed && b.parsed ? compare(b.parsed, a.parsed) : 0))
        .map(({ version, stable }) => ({ version, stable }));
}

/* =========================================================
   FABRIC / QUILT
========================================================= */

async function installJsonLoader(loader, mcVersion, loaderVersion) {
    const base = FABRIC_LIKE[loader];

    const profile = await fetchJson(
        `${base}/versions/loader/${mcVersion}/${loaderVersion}/profile/json`
    );

    if (!profile?.libraries) {
        throw new Error(
            `${loader} returned no profile for ${mcVersion} / ${loaderVersion}.`
        );
    }

    return profile;
}

/* =========================================================
   FORGE / NEOFORGE
========================================================= */

function installerUrl(loader, loaderVersion) {
    // A version as the loaders name them ("1.20.1-47.3.0", "21.1.77"), never a path.
    if (!/^[\w.+-]{1,64}$/.test(String(loaderVersion))) throw new Error(`"${loaderVersion}" isn't a ${loader} version.`);

    if (loader === "neoforge") {
        return `https://maven.neoforged.net/releases/net/neoforged/neoforge/` +
            `${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
    }

    return `https://maven.minecraftforge.net/net/minecraftforge/forge/` +
        `${loaderVersion}/forge-${loaderVersion}-installer.jar`;
}

/*
 * The Forge/NeoForge installer expects to be pointed at something that
 * looks like a vanilla .minecraft directory: a launcher_profiles.json
 * plus versions/<mc>/<mc>.jar. We already lay the instance out that way,
 * so it only needs the profiles stub.
 */
function ensureLauncherProfiles(instanceFolder) {
    const file = path.join(instanceFolder, "launcher_profiles.json");

    if (fs.existsSync(file)) return;

    fs.writeFileSync(
        file,
        JSON.stringify(
            {
                profiles: {},
                settings: {},
                version: 3,
            },
            null,
            2
        )
    );
}

function runInstaller(javaPath, jarPath, instanceFolder, onLog) {
    return new Promise((resolve, reject) => {
        // Headless, so the installer never puts a Java icon in the Dock.
        const proc = spawn(
            javaPath,
            ["-Djava.awt.headless=true", "-jar", jarPath, "--installClient", instanceFolder],
            { cwd: instanceFolder }
        );

        let output = "";

        const capture = (data) => {
            const text = data.toString();
            output += text;
            if (onLog) onLog(text.trim());
        };

        proc.stdout.on("data", capture);
        proc.stderr.on("data", capture);

        proc.on("error", (err) => {
            if (err.code !== "ENOENT") return reject(err);
            reject(new Error(
                `Java couldn't be started to run ${path.basename(jarPath)}. ` +
                "Check your internet connection and use Repair, or choose a Java in Settings."
            ));
        });

        proc.on("close", (code) => {
            if (code === 0) return resolve(output);

            reject(
                new Error(
                    `${path.basename(jarPath)} exited with code ${code}.\n` +
                    output.slice(-1500)
                )
            );
        });
    });
}

/*
 * Finds the version JSON the installer produced. Forge names it
 * "1.20.1-forge-47.4.10"; NeoForge uses "neoforge-21.1.248".
 */
function findInstalledProfile(instanceFolder, loader, loaderVersion) {
    const versionsDir = path.join(instanceFolder, "versions");

    if (!fs.existsSync(versionsDir)) return null;

    const candidates = fs.readdirSync(versionsDir).filter(name => {
        const lower = name.toLowerCase();

        if (loader === "neoforge") return lower.includes("neoforge");

        return lower.includes("forge") && !lower.includes("neoforge");
    });

    if (candidates.length === 0) return null;

    // Prefer the one naming this exact loader build.
    const exact = candidates.find(c => c.includes(loaderVersion)) ?? candidates[0];

    const jsonPath = path.join(versionsDir, exact, `${exact}.json`);

    if (!fs.existsSync(jsonPath)) return null;

    return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
}

async function installJarLoader(
    loader,
    mcVersion,
    loaderVersion,
    instanceFolder,
    getJava,
    onLog
) {
    ensureLauncherProfiles(instanceFolder);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "unity-loader-"));
    const jarPath = path.join(tempDir, `${loader}-${loaderVersion}-installer.jar`);

    try {
        if (onLog) onLog(`Downloading ${loader} installer...`);

        // The installer runs as a program, so it's checked against the checksum its Maven
        // repository publishes beside it before it does.
        const url = installerUrl(loader, loaderVersion);
        await downloadFile(url, jarPath, { sha1: await publishedSha1(url), requireHash: true });

        // The Java this Minecraft version needs, downloaded first if it isn't here yet.
        const javaPath = await getJava();

        if (onLog) onLog(`Running ${loader} installer...`);

        await runInstaller(javaPath, jarPath, instanceFolder, onLog);

        const profile = findInstalledProfile(instanceFolder, loader, loaderVersion);

        if (!profile) {
            throw new Error(
                `${loader} installer finished but produced no version JSON.`
            );
        }

        return profile;

    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

/* =========================================================
   PUBLIC
========================================================= */

/*
 * Returns the loader's version profile, ready to be merged over the
 * vanilla one. Returns null for vanilla.
 */
async function installLoader({
    loader,
    mcVersion,
    loaderVersion,
    instanceFolder,
    getJava = async () => "java",
    onLog,
}) {
    const kind = (loader || "vanilla").toLowerCase();

    if (!kind || kind === "vanilla") return null;

    if (!loaderVersion) {
        loaderVersion = await getLatestLoaderVersion(kind, mcVersion);

        if (!loaderVersion) {
            throw new Error(
                `No ${loader} build is available for Minecraft ${mcVersion}.`
            );
        }

        if (onLog) onLog(`Using latest ${loader} ${loaderVersion}`);
    }

    if (FABRIC_LIKE[kind]) {
        if (onLog) onLog(`Fetching ${kind} ${loaderVersion} profile...`);
        return {
            profile: await installJsonLoader(kind, mcVersion, loaderVersion),
            loaderVersion,
        };
    }

    if (kind === "liteloader") {
        if (onLog) onLog(`Putting together LiteLoader ${loaderVersion}...`);
        return {
            profile: await liteLoader.profile(mcVersion, loaderVersion),
            loaderVersion,
        };
    }

    if (kind === "forge" || kind === "neoforge") {
        return {
            profile: await installJarLoader(
                kind, mcVersion, loaderVersion, instanceFolder, getJava, onLog
            ),
            loaderVersion,
        };
    }

    throw new Error(`Unknown loader "${loader}".`);
}

/*
 * The Minecraft versions a loader works with, newest first, for loaders made for old
 * versions only; null for the others, which follow every release.
 */
async function loaderGameVersions(loader) {
    switch ((loader || "").toLowerCase()) {
        case "legacy-fabric":
        case "babric": {
            const list = await fetchJson(`${FABRIC_LIKE[loader.toLowerCase()]}/versions/game`);
            return (list ?? []).map(entry => entry.version).filter(Boolean);
        }
        case "liteloader":
            return liteLoader.gameVersions();
        default:
            return null;
    }
}

module.exports = {
    loaderGameVersions,
    installerUrl,
    installLoader,
    getLatestLoaderVersion,
    listLoaderVersions,
};
