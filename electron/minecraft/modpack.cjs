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

/*
 * Where a .mrpack's files may be downloaded from, and how they're checked, as the format
 * itself requires (https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack):
 * https only, from these hosts, with a SHA-1 and a SHA-512 for every file. A file that
 * breaks those rules isn't downloaded; it's listed as one that couldn't be.
 */
const MRPACK_HOSTS = ["cdn.modrinth.com", "github.com", "raw.githubusercontent.com", "gitlab.com"];

function mrpackSource(url) {
    try {
        const parsed = new URL(String(url));
        return parsed.protocol === "https:" && MRPACK_HOSTS.includes(parsed.hostname.toLowerCase()) && !parsed.username && !parsed.password;
    } catch {
        return false;
    }
}

function resolveModrinthFiles(index) {
    const downloads = [];
    const blocked = [];

    for (const file of index.files ?? []) {
        // Skip server-only files when building a client instance.
        if (file.env?.client === "unsupported") continue;

        const name = path.basename(String(file.path ?? "file"));
        const url = (file.downloads ?? []).find(mrpackSource);
        const sha1 = /^[0-9a-f]{40}$/i.test(file.hashes?.sha1 ?? "") ? file.hashes.sha1 : null;
        const sha512 = /^[0-9a-f]{128}$/i.test(file.hashes?.sha512 ?? "") ? file.hashes.sha512 : null;

        if (!url) {
            blocked.push({ name, reason: "not from a site modpacks may download from" });
            continue;
        }
        if (!sha1 || !sha512) {
            blocked.push({ name, reason: "no hashes to check it against" });
            continue;
        }

        downloads.push({
            url,
            path: file.path,
            sha1,
            sha512,
            hosts: MRPACK_HOSTS,
            size: file.fileSize ?? null,
        });
    }

    return { downloads, blocked };
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
                sha512: item.sha512 ?? undefined,
                size: item.size ?? undefined,
                // A .mrpack's files: its hosts only, and only with their hashes.
                hosts: item.hosts,
                requireHash: Boolean(item.hosts),
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

        // A version picked by the user is that one or none: never quietly the newest instead.
        const version = fileId ? versions.find(v => v.id === fileId) : versions[0];

        if (!version) throw new Error("That version of the modpack isn't on Modrinth any more.");

        const file =
            version.files.find(f => f.primary) ?? version.files[0];

        if (!file?.url) throw new Error("That modpack version has no file.");

        // The site's name for it, as a name only: never a path out of the temporary folder.
        const target = path.join(tempDir, path.basename(String(file.filename || "modpack.mrpack")) || "modpack.mrpack");

        // The pack itself, from Modrinth's own file server, checked against both its hashes.
        await downloadFile(file.url, target, { sha1: file.hashes?.sha1, sha512: file.hashes?.sha512, hosts: MRPACK_HOSTS, requireHash: true });

        return { zipPath: target, tempDir, versionName: version.version_number };
    }

    if (source === "curseforge") {
        // A picked file is looked up by its id, as it may be far down the pack's list.
        const res = fileId
            ? await curseforgeFetch("/mods/files", { method: "POST", body: { fileIds: [Number(fileId)] } })
            : await curseforgeFetch(`/mods/${projectId}/files?pageSize=20`);

        if (!res.ok) throw new Error(`CurseForge lookup failed (HTTP ${res.status}).`);

        const files = (await res.json()).data ?? [];
        const file = files[0];

        if (!file) throw new Error(fileId ? "That version of the modpack isn't on CurseForge any more." : "That modpack has no files.");
        if (fileId && String(file.modId) !== String(projectId)) throw new Error("That file isn't part of this modpack.");

        if (!file.downloadUrl) {
            throw new Error(
                "This modpack's author disabled third-party downloads. " +
                "Download the zip from CurseForge, then use Import ZIP."
            );
        }

        // The site's name for it, as a name only: never a path out of the temporary folder.
        const target = path.join(tempDir, path.basename(String(file.fileName || "modpack.zip")) || "modpack.zip");

        await downloadFile(file.downloadUrl, target, { sha1: file.hashes?.find(h => h.algo === 1)?.value ?? undefined });

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
    resolveModrinthFiles,
};
