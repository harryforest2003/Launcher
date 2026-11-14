const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
// Unzipped by the same code as the game sections' mods, which never writes outside its folder.
const { unzip } = require("../games/archive.cjs");

const { readManifest, writeManifest } = require("./modLibrary.cjs");

/*
 * Installing a mod means getting the right files into the game's mod
 * folder, in the layout that game expects.
 *
 * Two entry points, both ending in the same place:
 *
 *   installFromUrl  - provider gave us a direct download
 *   installFromFile - user downloaded it themselves
 *
 * The second matters more than it sounds: only ~12% of The Sims 4 mods
 * on CurseForge permit third-party downloads, so for Sims CC the manual
 * path is the normal one, not the fallback.
 */

const ARCHIVE_EXTENSIONS = [".zip", ".ts4script"];

// A name for one file or folder: no separators, and never "." or ".." (or only dots),
// which would mean this folder or the one above it.
function sanitize(name) {
    const clean = String(name)
        .replace(/[\u0000-\u001f/\\:*?"<>|]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
    return /^\.*$/.test(clean) ? "mod" : clean;
}

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "unity-mod-"));
}

/* =========================================================
   DOWNLOAD
========================================================= */

async function downloadTo(url, destination, onProgress, { sha1 } = {}) {
    if (new URL(url).protocol !== "https:") throw new Error("That download isn't from a secure (https) address.");

    const res = await fetch(url, {
        headers: { "User-Agent": "UnityLauncher/1.0" },
        redirect: "follow",
    });

    if (!res.ok) {
        throw new Error(`Download failed (HTTP ${res.status}).`);
    }

    const total = Number(res.headers.get("content-length")) || 0;
    let received = 0;

    fs.mkdirSync(path.dirname(destination), { recursive: true });

    const chunks = [];

    for await (const chunk of res.body) {
        chunks.push(chunk);
        received += chunk.length;

        if (onProgress && total) {
            onProgress(Math.round((received / total) * 100));
        }
    }

    const data = Buffer.concat(chunks);

    // Checked against the site's own SHA-1 of the file, when it gives one.
    if (sha1 && crypto.createHash("sha1").update(data).digest("hex") !== String(sha1).toLowerCase()) {
        throw new Error("The download didn't match the file on the site. Try again.");
    }

    fs.writeFileSync(destination, data);

    return destination;
}

/* =========================================================
   EXTRACTION
========================================================= */

function isArchive(filePath) {
    // .ts4script is a zip, but Sims 4 loads it as-is — never unpack it.
    return path.extname(filePath).toLowerCase() === ".zip";
}

async function extractArchive(archivePath, outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });

    // Entries naming a path outside outputDir ("../", absolute paths) are skipped.
    await unzip(archivePath, outputDir);

    return outputDir;
}

// Every file under a directory, recursively.
function walkFiles(root) {
    const out = [];
    const stack = [root];

    while (stack.length) {
        const current = stack.pop();

        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            // __MACOSX and dotfiles are packaging noise.
            if (entry.name.startsWith(".") || entry.name === "__MACOSX") continue;

            const full = path.join(current, entry.name);

            if (entry.isDirectory()) stack.push(full);
            else out.push(full);
        }
    }

    return out;
}

/* =========================================================
   LAYOUT RULES
========================================================= */

/*
 * Decide where each extracted file belongs.
 *
 * Sims 4 is the fiddly one: .ts4script files stop working if they sit
 * more than one folder below Mods, while .package files can nest freely.
 */
function placeFile(game, modDir, modName, sourceFile, relativeInArchive) {
    const ext = path.extname(sourceFile).toLowerCase();
    const folder = sanitize(modName);

    if (game.id === "sims4" && ext === ".ts4script") {
        // Depth-sensitive: keep it directly inside Mods/.
        return path.join(modDir, path.basename(sourceFile));
    }

    if (game.loose) {
        // SMAPI-style: preserve the archive's folder structure.
        return path.join(modDir, relativeInArchive);
    }

    // Group the mod's files in their own folder so it can be removed
    // cleanly later.
    return path.join(modDir, folder, path.basename(sourceFile));
}

/*
 * For loose (folder-based) games, find the real mod root inside the
 * archive - the folder containing manifest.json - so we don't install a
 * redundant wrapper folder.
 */
function findLooseRoot(extractedDir) {
    const manifests = walkFiles(extractedDir).filter(
        f => path.basename(f).toLowerCase() === "manifest.json"
    );

    if (manifests.length === 0) return null;

    return manifests.map(m => path.dirname(m));
}

/* =========================================================
   CORE INSTALL
========================================================= */

function copyInto(sourceFile, destination) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(sourceFile, destination);
}

/*
 * Takes a already-downloaded file (archive or bare mod file) and puts
 * its contents into the game's mod folder.
 */
async function installLocalFile(game, modDir, filePath, meta = {}) {
    if (!modDir) throw new Error("This game has no mod folder configured.");

    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    fs.mkdirSync(modDir, { recursive: true });

    const extensions = game.modExtensions ?? [];
    const modName = meta.name || path.basename(filePath, path.extname(filePath));

    const installed = [];

    if (!isArchive(filePath)) {
        // A bare mod file.
        const ext = path.extname(filePath).toLowerCase();

        if (extensions.length && !extensions.includes(ext)) {
            throw new Error(
                `"${path.basename(filePath)}" is not a ${game.name} mod file ` +
                `(expected ${extensions.join(", ")}).`
            );
        }

        const dest = placeFile(game, modDir, modName, filePath, path.basename(filePath));
        copyInto(filePath, dest);
        installed.push(path.relative(modDir, dest));

    } else {
        const staging = tempDir();

        try {
            await extractArchive(filePath, staging);

            if (game.loose) {
                const roots = findLooseRoot(staging);

                if (!roots || roots.length === 0) {
                    throw new Error(
                        `No manifest.json found in the archive — ` +
                        `this does not look like a ${game.name} mod.`
                    );
                }

                for (const root of roots) {
                    const folderName = sanitize(path.basename(root));
                    const dest = path.join(modDir, folderName);

                    fs.mkdirSync(dest, { recursive: true });
                    fs.cpSync(root, dest, { recursive: true });

                    installed.push(folderName);
                }

            } else {
                const files = walkFiles(staging).filter(f => {
                    const ext = path.extname(f).toLowerCase();
                    return !extensions.length || extensions.includes(ext);
                });

                if (files.length === 0) {
                    throw new Error(
                        `The archive contained no ${game.name} mod files ` +
                        `(looked for ${extensions.join(", ") || "any"}).`
                    );
                }

                for (const file of files) {
                    const rel = path.relative(staging, file);
                    const dest = placeFile(game, modDir, modName, file, rel);

                    copyInto(file, dest);
                    installed.push(path.relative(modDir, dest));
                }
            }

        } finally {
            fs.rmSync(staging, { recursive: true, force: true });
        }
    }

    // Record provenance so the library view can show where it came from.
    const manifest = readManifest(modDir);

    for (const rel of installed) {
        manifest[rel] = {
            name: modName,
            source: meta.source ?? "file",
            projectId: meta.projectId ?? null,
            installedAt: new Date().toISOString(),
        };
    }

    writeManifest(modDir, manifest);

    return { installed, count: installed.length, name: modName };
}

/*
 * Download first, then hand off to the local installer.
 */
async function installFromUrl(game, modDir, url, meta = {}, onProgress) {
    const staging = tempDir();

    try {
        const fileName = sanitize(
            meta.fileName || path.basename(new URL(url).pathname) || "download.zip"
        );

        const downloaded = path.join(staging, fileName);

        await downloadTo(url, downloaded, onProgress, { sha1: meta.sha1 });

        return await installLocalFile(game, modDir, downloaded, meta);

    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
}

module.exports = {
    installLocalFile,
    installFromUrl,
    downloadTo,
};
