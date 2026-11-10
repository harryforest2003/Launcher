const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");

const { downloadFile, fetchJson, pool } = require("./net.cjs");
const { downloadAssets } = require("./assets.cjs");
const { installLoader } = require("./loaders.cjs");
const {
    isLibraryAllowed,
    libraryArtifact,
    nativeArtifact,
    mergeVersions,
} = require("./versionData.cjs");

const VERSION_MANIFEST =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

/*
 * Full instance install: vanilla files, then the mod loader, then a
 * merged version JSON the launcher can run directly.
 */

/* ---------------- progress plumbing ---------------- */

function reporter(onProgress) {
    return (stage, percent, detail) => {
        if (onProgress) onProgress({ stage, percent, detail });
    };
}

/* ---------------- vanilla ---------------- */

async function getVersionMeta(mcVersion) {
    const manifest = await fetchJson(VERSION_MANIFEST);

    const entry = manifest.versions.find(v => v.id === mcVersion);

    if (!entry) {
        throw new Error(`Minecraft version "${mcVersion}" not found.`);
    }

    return fetchJson(entry.url);
}

async function downloadClient(versionJson, instanceFolder, report) {
    const client = versionJson.downloads?.client;

    if (!client?.url) {
        throw new Error(`Version ${versionJson.id} has no client download.`);
    }

    const target = path.join(
        instanceFolder, "versions", versionJson.id, `${versionJson.id}.jar`
    );

    report("client", 0, `Downloading Minecraft ${versionJson.id}`);

    await downloadFile(client.url, target, {
        sha1: client.sha1,
        size: client.size,
    });

    report("client", 100, `Minecraft ${versionJson.id} ready`);
}

async function downloadLibraries(versionJson, instanceFolder, report) {
    const libraries = (versionJson.libraries ?? []).filter(isLibraryAllowed);

    const jobs = [];

    for (const library of libraries) {
        const artifact = libraryArtifact(library);

        // A natives-only entry has no classpath jar of its own.
        if (artifact?.url && !(library.natives && !library.downloads?.artifact)) {
            jobs.push({
                url: artifact.url,
                dest: path.join(instanceFolder, "libraries", artifact.path),
                sha1: artifact.sha1,
                size: artifact.size,
            });
        }

        const native = nativeArtifact(library);

        if (native?.url) {
            jobs.push({
                url: native.url,
                dest: path.join(instanceFolder, "libraries", native.path),
                sha1: native.sha1,
                size: native.size,
                native: true,
            });
        }
    }

    report("libraries", 0, `Downloading ${jobs.length} libraries`);

    const { errors } = await pool(
        jobs,
        job => downloadFile(job.url, job.dest, {
            sha1: job.sha1, size: job.size,
        }),
        {
            concurrency: 12,
            onProgress: (done, total) =>
                report(
                    "libraries",
                    Math.round((done / total) * 100),
                    `Libraries ${done}/${total}`
                ),
        }
    );

    if (errors.length) {
        throw new Error(
            `${errors.length} librar${errors.length === 1 ? "y" : "ies"} failed ` +
            `to download. First error: ${errors[0].message}`
        );
    }

    return jobs.filter(j => j.native).map(j => j.dest);
}

async function extractNatives(nativeJars, versionJson, instanceFolder, report) {
    const nativesDir = path.join(instanceFolder, "natives", versionJson.id);

    fs.mkdirSync(nativesDir, { recursive: true });

    report("natives", 0, "Extracting natives");

    for (const jar of nativeJars) {
        if (!fs.existsSync(jar)) continue;

        try {
            const directory = await unzipper.Open.file(jar);

            for (const entry of directory.files) {
                if (entry.type !== "File") continue;

                // Skip signature files and metadata.
                if (entry.path.startsWith("META-INF/")) continue;

                const target = path.join(nativesDir, path.basename(entry.path));

                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, await entry.buffer());
            }
        } catch (err) {
            console.warn(`Could not extract natives from ${jar}:`, err.message);
        }
    }

    report("natives", 100, "Natives ready");

    return nativesDir;
}

/* ---------------- orchestration ---------------- */

/*
 * Installs everything an instance needs and writes the merged version
 * JSON to versions/<id>/<id>.json inside the instance.
 */
async function installInstance(instance, instanceFolder, { onProgress, javaPath = "java" } = {}) {
    const report = reporter(onProgress);

    fs.mkdirSync(instanceFolder, { recursive: true });

    /* 1. vanilla metadata */
    report("metadata", 0, `Fetching Minecraft ${instance.version} metadata`);

    const vanilla = await getVersionMeta(instance.version);

    fs.mkdirSync(
        path.join(instanceFolder, "versions", vanilla.id),
        { recursive: true }
    );

    fs.writeFileSync(
        path.join(instanceFolder, "versions", vanilla.id, `${vanilla.id}.json`),
        JSON.stringify(vanilla, null, 2)
    );

    /* 2. client jar */
    await downloadClient(vanilla, instanceFolder, report);

    /* 3. vanilla libraries + natives */
    const vanillaNatives = await downloadLibraries(vanilla, instanceFolder, report);
    await extractNatives(vanillaNatives, vanilla, instanceFolder, report);

    /* 4. assets */
    report("assets", 0, "Downloading assets");

    const assetResult = await downloadAssets(
        vanilla,
        instanceFolder,
        (done, total) =>
            report(
                "assets",
                Math.round((done / total) * 100),
                `Assets ${done}/${total}`
            )
    );

    report("assets", 100, `Assets ready (${assetResult.downloaded})`);

    /* 5. loader */
    let merged = vanilla;
    let loaderVersion = instance.loaderVersion || "";

    const loaderName = (instance.loader || "vanilla").toLowerCase();

    if (loaderName && loaderName !== "vanilla") {
        report("loader", 0, `Installing ${instance.loader}`);

        const result = await installLoader({
            loader: loaderName,
            mcVersion: instance.version,
            loaderVersion: instance.loaderVersion || null,
            instanceFolder,
            javaPath,
            onLog: (text) => report("loader", 50, text),
        });

        if (result) {
            loaderVersion = result.loaderVersion;
            merged = mergeVersions(vanilla, result.profile);

            // The loader brings its own libraries.
            report("loader", 60, "Downloading loader libraries");

            const loaderNatives = await downloadLibraries(
                { libraries: result.profile.libraries ?? [] },
                instanceFolder,
                report
            );

            if (loaderNatives.length) {
                await extractNatives(loaderNatives, vanilla, instanceFolder, report);
            }
        }

        report("loader", 100, `${instance.loader} ${loaderVersion} installed`);
    }

    /*
     * Persist the merged profile under its own id so launching never has
     * to redo the merge, and the client jar is reachable at the id the
     * classpath expects.
     */
    merged.id = merged.id || vanilla.id;

    const mergedDir = path.join(instanceFolder, "versions", merged.id);
    fs.mkdirSync(mergedDir, { recursive: true });

    fs.writeFileSync(
        path.join(mergedDir, `${merged.id}.json`),
        JSON.stringify(merged, null, 2)
    );

    // The classpath ends with versions/<merged.id>/<merged.id>.jar, so
    // when the loader renamed the profile, put the client jar there too.
    const vanillaJar = path.join(
        instanceFolder, "versions", vanilla.id, `${vanilla.id}.jar`
    );
    const mergedJar = path.join(mergedDir, `${merged.id}.jar`);

    if (merged.id !== vanilla.id && !fs.existsSync(mergedJar)) {
        fs.copyFileSync(vanillaJar, mergedJar);
    }

    /* 6. game directory + mods folder */
    const gameDir = path.join(instanceFolder, ".minecraft");

    fs.mkdirSync(path.join(gameDir, "mods"), { recursive: true });

    report("done", 100, "Instance ready");

    return {
        versionId: merged.id,
        vanillaId: vanilla.id,
        loaderVersion,
        assetIndex: vanilla.assetIndex?.id ?? "legacy",
        gameDirectory: gameDir,
    };
}

module.exports = {
    installInstance,
    getVersionMeta,
};
