const fs = require("fs");
const os = require("os");
const path = require("path");
const unzipper = require("unzipper");

const { downloadFile, fetchJson, pool } = require("./net.cjs");
const { curseforgeFetch } = require("../curseforge.cjs");
const { curseForgePackPath } = require("./contentTypes.cjs");

/*
 * Modpack installation.
 *
 * Two formats exist and both are zips with a manifest at the root:
 *
 *   Modrinth (.mrpack)  modrinth.index.json + overrides/
 *   CurseForge (.zip)   manifest.json + overrides/
 *
 * Both name a Minecraft version and a loader, which is exactly what an
 * instance needs, so installing a pack means: read the manifest, create
 * the matching instance, download the pack's files, copy the overrides.
 */


/* =========================================================
   READING THE MANIFEST
========================================================= */

async function readZipEntry(zipPath, entryName) {
    const directory = await unzipper.Open.file(zipPath);

    const entry = directory.files.find(
        f => f.path === entryName || f.path.endsWith(`/${entryName}`)
    );

    if (!entry) return null;

    return (await entry.buffer()).toString("utf8");
}

/*
 * "neoforge-21.1.247" / "forge-47.4.10" / "fabric-0.16.9"
 */
function parseCurseLoaderId(id) {
    const raw = String(id ?? "");

    const match = raw.match(/^([a-zA-Z]+)-(.+)$/);

    if (!match) return { loader: "vanilla", loaderVersion: "" };

    const loader = match[1].toLowerCase();
    let loaderVersion = match[2];

    return { loader, loaderVersion };
}

/*
 * Modrinth states its loader in a dependencies map:
 *   { "minecraft": "1.21.1", "fabric-loader": "0.16.9" }
 */
function parseModrinthDependencies(dependencies = {}) {
    const mcVersion = dependencies.minecraft ?? null;

    const loaderKeys = {
        "fabric-loader": "fabric",
        "quilt-loader": "quilt",
        "forge": "forge",
        "neoforge": "neoforge",
    };

    for (const [key, loader] of Object.entries(loaderKeys)) {
        if (dependencies[key]) {
            return { mcVersion, loader, loaderVersion: dependencies[key] };
        }
    }

    return { mcVersion, loader: "vanilla", loaderVersion: "" };
}

/*
 * Identifies a zip and returns a normalised description of the pack.
 */
async function inspectModpack(zipPath) {
    const mrIndex = await readZipEntry(zipPath, "modrinth.index.json");

    if (mrIndex) {
        const index = JSON.parse(mrIndex);
        const deps = parseModrinthDependencies(index.dependencies);

        return {
            format: "modrinth",
            name: index.name ?? path.basename(zipPath, path.extname(zipPath)),
            packVersion: index.versionId ?? "",
            mcVersion: deps.mcVersion,
            loader: deps.loader,
            loaderVersion: deps.loaderVersion,
            fileCount: (index.files ?? []).length,
            recommendedRam: null,
            index,
        };
    }

    const cfManifest = await readZipEntry(zipPath, "manifest.json");

    if (cfManifest) {
        const manifest = JSON.parse(cfManifest);

        if (!manifest.minecraft?.version) {
            throw new Error("manifest.json is not a CurseForge modpack manifest.");
        }

        const primary =
            (manifest.minecraft.modLoaders ?? []).find(l => l.primary) ??
            (manifest.minecraft.modLoaders ?? [])[0];

        const { loader, loaderVersion } = parseCurseLoaderId(primary?.id);

        return {
            format: "curseforge",
            name: manifest.name ?? path.basename(zipPath, path.extname(zipPath)),
            packVersion: manifest.version ?? "",
            mcVersion: manifest.minecraft.version,
            loader,
            loaderVersion,
            fileCount: (manifest.files ?? []).length,
            // Packs advertise this in MB, nested under "minecraft".
            recommendedRam: (() => {
                const mb =
                    manifest.minecraft.recommendedRam ?? manifest.recommendedRam;

                return mb ? Math.max(2, Math.round(mb / 1024)) : null;
            })(),
            overridesDir: manifest.overrides ?? "overrides",
            manifest,
        };
    }

    throw new Error(
        "That zip is not a modpack — expected modrinth.index.json or manifest.json at its root."
    );
}

/* =========================================================
   FILE RESOLUTION
========================================================= */

/*
 * CurseForge packs reference files by (projectID, fileID) and give no
 * URLs. The bulk endpoint resolves 50 at a time, turning a 485-file pack
 * from 485 requests into 10.
 */
async function resolveCurseForgeFiles(files, onProgress) {
    const ids = files.map(f => f.fileID);
    const resolved = new Map();

    const BATCH = 50;

    for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);

        const res = await curseforgeFetch("/mods/files", { method: "POST", body: { fileIds: batch } });

        if (!res.ok) {
            throw new Error(`CurseForge file lookup failed (HTTP ${res.status}).`);
        }

        const json = await res.json();

        for (const file of json.data ?? []) {
            resolved.set(file.id, file);
        }

        if (onProgress) {
            onProgress(Math.min(i + BATCH, ids.length), ids.length);
        }
    }

    const classes = await curseForgeClasses(files.map(f => f.projectID));

    const downloads = [];
    const blocked = [];

    for (const entry of files) {
        const file = resolved.get(entry.fileID);

        if (!file) {
            blocked.push({ projectID: entry.projectID, reason: "not found" });
            continue;
        }

        if (!file.downloadUrl) {
            // The author disabled third-party downloads for this file.
            blocked.push({
                projectID: entry.projectID,
                name: file.fileName,
                reason: "third-party downloads disabled",
            });
            continue;
        }

        downloads.push({
            url: file.downloadUrl,
            path: curseForgePackPath(classes.get(entry.projectID), file.fileName),
            sha1: file.hashes?.find(h => h.algo === 1)?.value ?? null,
            required: entry.required !== false,
        });
    }

    return { downloads, blocked };
}

/*
 * What kind of project each file comes from, so a pack's resource packs and shaders
 * don't all land in mods/. If this lookup fails, the files still install: a .jar
 * goes to mods/ either way, and only other file types would be misplaced.
 */
async function curseForgeClasses(projectIds) {
    const ids = [...new Set(projectIds)];
    const classes = new Map();
    const BATCH = 50;

    for (let i = 0; i < ids.length; i += BATCH) {
        try {
            const res = await curseforgeFetch("/mods", { method: "POST", body: { modIds: ids.slice(i, i + BATCH) } });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            for (const project of (await res.json()).data ?? []) {
                classes.set(project.id, project.classId);
            }
        } catch (err) {
            console.warn("CurseForge project lookup failed:", err.message);
        }
    }

    return classes;
}

function resolveModrinthFiles(index) {
    const downloads = [];

    for (const file of index.files ?? []) {
        // Skip server-only files when building a client instance.
        if (file.env?.client === "unsupported") continue;

        const url = file.downloads?.[0];
        if (!url) continue;

        downloads.push({
            url,
            path: file.path,
            sha1: file.hashes?.sha1 ?? null,
            size: file.fileSize ?? null,
        });
    }

    return { downloads, blocked: [] };
}

/* =========================================================
   OVERRIDES
========================================================= */

/*
 * Overrides are the pack's configs, scripts and resources. They are
 * copied over the game directory after the mods are downloaded.
 */
async function extractOverrides(zipPath, gameDir, overridesDir = "overrides") {
    const directory = await unzipper.Open.file(zipPath);

    // client-overrides wins over plain overrides for client installs.
    const prefixes = [`${overridesDir}/`, "client-overrides/"];

    let written = 0;

    for (const entry of directory.files) {
        if (entry.type !== "File") continue;

        const prefix = prefixes.find(p => entry.path.startsWith(p));
        if (!prefix) continue;

        const relative = entry.path.slice(prefix.length);
        if (!relative || relative.endsWith("/")) continue;

        // Never let a crafted zip escape the game directory.
        const target = path.resolve(gameDir, relative);

        if (!target.startsWith(path.resolve(gameDir) + path.sep)) {
            console.warn(`Skipping override outside game dir: ${entry.path}`);
            continue;
        }

        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, await entry.buffer());

        written++;
    }

    return written;
}

/* =========================================================
   INSTALL
========================================================= */

/*
 * Downloads every file the pack lists into the instance's game
 * directory, then lays the overrides on top.
 */
async function applyModpack(zipPath, info, gameDir, onProgress) {
    const report = (stage, percent, detail) =>
        onProgress?.({ stage, percent, detail });

    report("pack", 0, `Resolving ${info.fileCount} pack files`);

    const { downloads, blocked } =
        info.format === "modrinth"
            ? resolveModrinthFiles(info.index)
            : await resolveCurseForgeFiles(
                info.manifest.files ?? [],
                (done, total) =>
                    report(
                        "pack",
                        Math.round((done / total) * 30),
                        `Resolving files ${done}/${total}`
                    )
            );

    report("pack", 30, `Downloading ${downloads.length} pack files`);

    const { errors } = await pool(
        downloads,
        async (item) => {
            const target = path.resolve(gameDir, item.path);

            if (!target.startsWith(path.resolve(gameDir) + path.sep)) {
                throw new Error(`Pack file escapes game dir: ${item.path}`);
            }

            await downloadFile(item.url, target, {
                sha1: item.sha1 ?? undefined,
                size: item.size ?? undefined,
            });
        },
        {
            concurrency: 12,
            onProgress: (done, total) =>
                report(
                    "pack",
                    30 + Math.round((done / total) * 60),
                    `Pack files ${done}/${total}`
                ),
        }
    );

    report("pack", 92, "Applying pack configuration");

    const overrides = await extractOverrides(
        zipPath, gameDir, info.overridesDir ?? "overrides"
    );

    report("pack", 100, "Modpack applied");

    return {
        downloaded: downloads.length - errors.length,
        total: downloads.length,
        failed: errors.length,
        blocked,
        overrides,
        firstError: errors[0]?.message ?? null,
    };
}

/* =========================================================
   FETCHING A PACK FROM A PROVIDER
========================================================= */

async function downloadPackFile(source, projectId, fileId) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "unity-pack-"));

    if (source === "modrinth") {
        const versions = await fetchJson(
            `https://api.modrinth.com/v2/project/${projectId}/version`
        );

        if (!versions?.length) throw new Error("That modpack has no released versions.");

        const version = fileId
            ? versions.find(v => v.id === fileId) ?? versions[0]
            : versions[0];

        const file =
            version.files.find(f => f.primary) ?? version.files[0];

        if (!file?.url) throw new Error("That modpack version has no file.");

        const target = path.join(tempDir, file.filename);

        await downloadFile(file.url, target, { sha1: file.hashes?.sha1 });

        return { zipPath: target, tempDir, versionName: version.version_number };
    }

    if (source === "curseforge") {
        const res = await curseforgeFetch(`/mods/${projectId}/files?pageSize=20`);

        if (!res.ok) throw new Error(`CurseForge lookup failed (HTTP ${res.status}).`);

        const files = (await res.json()).data ?? [];

        const file = fileId
            ? files.find(f => String(f.id) === String(fileId)) ?? files[0]
            : files[0];

        if (!file) throw new Error("That modpack has no files.");

        if (!file.downloadUrl) {
            throw new Error(
                "This modpack's author disabled third-party downloads. " +
                "Download the zip from CurseForge, then use Import ZIP."
            );
        }

        const target = path.join(tempDir, file.fileName);

        await downloadFile(file.downloadUrl, target);

        return { zipPath: target, tempDir, versionName: file.displayName };
    }

    throw new Error(`Unknown modpack source "${source}".`);
}

module.exports = {
    inspectModpack,
    applyModpack,
    downloadPackFile,
    extractOverrides,
    resolveCurseForgeFiles,
};
