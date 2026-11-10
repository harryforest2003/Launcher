const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const { fetchJson, downloadFile } = require("./net.cjs");

/*
 * Mod loader installation.
 *
 * Fabric and Quilt publish a ready-made profile JSON, so installing them
 * is just "fetch JSON, download the libraries it names".
 *
 * Forge and NeoForge do not. Their metadata lives inside an installer
 * jar that has to be executed (it runs binary-patching processors), so
 * those go through `java -jar ... --installClient`.
 */

const FABRIC_META = "https://meta.fabricmc.net/v2";
const QUILT_META = "https://meta.quiltmc.org/v3";
const FORGE_PROMOS =
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const NEOFORGE_MAVEN =
    "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";

/* =========================================================
   LATEST COMPATIBLE VERSION
========================================================= */

async function latestFabric(mcVersion) {
    const list = await fetchJson(`${FABRIC_META}/versions/loader/${mcVersion}`);

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

async function latestNeoForge(mcVersion) {
    const meta = await fetchJson(NEOFORGE_MAVEN);
    const all = meta?.versions ?? [];

    // MC 1.21.1 -> NeoForge 21.1.x
    const parts = mcVersion.split(".");
    if (parts.length < 2) return null;

    const prefix = `${parts[1]}.${parts[2] ?? "0"}.`;

    const matching = all.filter(v => v.startsWith(prefix));
    if (matching.length === 0) return null;

    const stable = matching.filter(v => !/beta|alpha|rc/i.test(v));

    const pool = stable.length ? stable : matching;

    return pool[pool.length - 1];
}

async function getLatestLoaderVersion(loader, mcVersion) {
    switch ((loader || "").toLowerCase()) {
        case "fabric": return latestFabric(mcVersion);
        case "quilt": return latestQuilt(mcVersion);
        case "forge": return latestForge(mcVersion);
        case "neoforge": return latestNeoForge(mcVersion);
        default: return null;
    }
}

/* =========================================================
   FABRIC / QUILT
========================================================= */

async function installJsonLoader(loader, mcVersion, loaderVersion) {
    const base = loader === "quilt" ? QUILT_META : FABRIC_META;

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
        const proc = spawn(
            javaPath,
            ["-jar", jarPath, "--installClient", instanceFolder],
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

        proc.on("error", reject);

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
    javaPath,
    onLog
) {
    ensureLauncherProfiles(instanceFolder);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "unity-loader-"));
    const jarPath = path.join(tempDir, `${loader}-${loaderVersion}-installer.jar`);

    try {
        if (onLog) onLog(`Downloading ${loader} installer...`);

        await downloadFile(installerUrl(loader, loaderVersion), jarPath);

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
    javaPath = "java",
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

    if (kind === "fabric" || kind === "quilt") {
        if (onLog) onLog(`Fetching ${kind} ${loaderVersion} profile...`);
        return {
            profile: await installJsonLoader(kind, mcVersion, loaderVersion),
            loaderVersion,
        };
    }

    if (kind === "forge" || kind === "neoforge") {
        return {
            profile: await installJarLoader(
                kind, mcVersion, loaderVersion, instanceFolder, javaPath, onLog
            ),
            loaderVersion,
        };
    }

    throw new Error(`Unknown loader "${loader}".`);
}

module.exports = {
    installLoader,
    getLatestLoaderVersion,
};
