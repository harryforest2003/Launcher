const fs = require("fs");
const path = require("path");

const { downloadFile } = require("./net.cjs");
const { CONTENT_FOLDERS } = require("./contentTypes.cjs");

/*
 * The content of a single Minecraft instance: mods, resource packs, shaders and
 * data packs, each in the folder the game reads it from.
 *
 * Toggling uses the ".disabled" suffix convention that Prism, MultiMC and
 * CurseForge all understand. The game and mod loaders only read .jar and .zip
 * files, so a renamed file is ignored, and other launchers reading this instance
 * see the same state. An unpacked folder can't be switched off that way, because
 * the game reads a pack folder whatever it is called.
 */

const MANIFEST = "unity-mods.json";

const FILE_PATTERNS = {
    mod: /\.jar(\.disabled)?$/i,
    resourcepack: /\.zip(\.disabled)?$/i,
    shader: /\.zip(\.disabled)?$/i,
    datapack: /\.zip(\.disabled)?$/i,
};

function gameDir(instanceFolder) {
    return path.join(instanceFolder, ".minecraft");
}

function modsDir(instanceFolder) {
    return path.join(gameDir(instanceFolder), CONTENT_FOLDERS.mod);
}

function assertWorld(instanceFolder, world) {
    const saves = path.join(gameDir(instanceFolder), "saves");
    const target = path.join(saves, String(world));

    // A world is one folder directly inside saves, never a path to somewhere else.
    if (path.basename(String(world)) !== world || !fs.existsSync(target)) {
        throw new Error(`There is no world called "${world}" in this instance.`);
    }

    return target;
}

function contentDir(instanceFolder, type, world) {
    if (!CONTENT_FOLDERS[type]) {
        throw new Error(`"${type}" is not something that can go in an instance.`);
    }

    if (type === "datapack" && world) {
        return path.join(assertWorld(instanceFolder, world), "datapacks");
    }

    return path.join(gameDir(instanceFolder), CONTENT_FOLDERS[type]);
}

function manifestPath(instanceFolder) {
    return path.join(instanceFolder, MANIFEST);
}

function readManifest(instanceFolder) {
    try {
        return JSON.parse(fs.readFileSync(manifestPath(instanceFolder), "utf8"));
    } catch {
        return {};
    }
}

function writeManifest(instanceFolder, data) {
    fs.writeFileSync(
        manifestPath(instanceFolder),
        JSON.stringify(data, null, 2)
    );
}

// Mods keep their plain filename as the key, which is what older manifests used.
function manifestKey(type, world, fileName) {
    return type === "mod" ? fileName : `${type}/${world ?? ""}/${fileName}`;
}

/* What the launcher recorded about one item (its name, source, version), or null. */
function manifestEntry(instanceFolder, { type, world, fileName }) {
    return readManifest(instanceFolder)[manifestKey(type, world ?? null, fileName)] ?? null;
}

/* Puts back (or, with null, removes) what was recorded about one item. */
function setManifestEntry(instanceFolder, { type, world, fileName }, entry) {
    const manifest = readManifest(instanceFolder);
    const key = manifestKey(type, world ?? null, fileName);
    if (entry) manifest[key] = entry;
    else delete manifest[key];
    writeManifest(instanceFolder, manifest);
}

/* ---------------- listing ---------------- */

function listFolder(instanceFolder, type, world, manifest) {
    const dir = contentDir(instanceFolder, type, world);

    if (!fs.existsSync(dir)) return [];

    const items = [];

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const isFolder = entry.isDirectory();

        if (entry.name.startsWith(".")) continue;
        if (isFolder ? type === "mod" : !FILE_PATTERNS[type].test(entry.name)) continue;
        if (!isFolder && !entry.isFile()) continue;

        const enabled = !entry.name.endsWith(".disabled");
        const fileName = enabled ? entry.name : entry.name.replace(/\.disabled$/, "");
        const meta = manifest[manifestKey(type, world, fileName)] ?? {};

        let size = 0;
        let modified = null;

        try {
            const stat = fs.statSync(path.join(dir, entry.name));
            size = isFolder ? 0 : stat.size;
            modified = stat.mtime.toISOString();
        } catch {
            // file vanished between readdir and stat
        }

        items.push({
            type,
            world: world ?? null,
            kind: isFolder ? "folder" : "file",
            fileName,
            actualFileName: entry.name,
            name: meta.name ?? fileName.replace(/\.(jar|zip)$/i, ""),
            enabled,
            size,
            modified,
            source: meta.source ?? null,
            projectId: meta.projectId ?? null,
            versionNumber: meta.versionNumber ?? null,
            installedAt: meta.installedAt ?? null,
            iconUrl: meta.iconUrl ?? null,
        });
    }

    return items;
}

/* Most recently played first, so the likeliest world is the default choice. */
function listWorlds(instanceFolder) {
    const saves = path.join(gameDir(instanceFolder), "saves");

    if (!fs.existsSync(saves)) return [];

    return fs.readdirSync(saves, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => {
            const levelDat = path.join(saves, entry.name, "level.dat");
            return fs.existsSync(levelDat)
                ? { name: entry.name, played: fs.statSync(levelDat).mtimeMs }
                : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.played - a.played)
        .map(world => world.name);
}

function byName(a, b) {
    return a.name.localeCompare(b.name);
}

function listContent(instanceFolder) {
    const manifest = readManifest(instanceFolder);
    const worlds = listWorlds(instanceFolder);

    const datapacks = [
        ...listFolder(instanceFolder, "datapack", null, manifest),
        ...worlds.flatMap(world => listFolder(instanceFolder, "datapack", world, manifest)),
    ];

    return {
        mod: listFolder(instanceFolder, "mod", null, manifest).sort(byName),
        resourcepack: listFolder(instanceFolder, "resourcepack", null, manifest).sort(byName),
        shader: listFolder(instanceFolder, "shader", null, manifest).sort(byName),
        datapack: datapacks.sort(byName),
        worlds,
    };
}

/* ---------------- changing ---------------- */

// Blocks a crafted fileName from escaping the content folder.
function resolveItem(instanceFolder, { type, world, fileName }) {
    const dir = contentDir(instanceFolder, type, world);
    const target = path.resolve(dir, String(fileName));

    if (!target.startsWith(path.resolve(dir) + path.sep)) {
        throw new Error("Refusing to touch a path outside the content folder.");
    }

    return target;
}

function setEnabled(instanceFolder, item, enabled) {
    const enabledPath = resolveItem(instanceFolder, item);
    const disabledPath = `${enabledPath}.disabled`;
    const { fileName } = item;

    if (fs.existsSync(enabledPath) && fs.statSync(enabledPath).isDirectory()) {
        throw new Error(`"${fileName}" is a folder, so it can't be switched off. Delete it instead.`);
    }

    if (enabled) {
        if (!fs.existsSync(disabledPath)) {
            if (fs.existsSync(enabledPath)) return { fileName, enabled: true };
            throw new Error(`"${fileName}" was not found.`);
        }

        fs.renameSync(disabledPath, enabledPath);

    } else {
        if (!fs.existsSync(enabledPath)) {
            if (fs.existsSync(disabledPath)) return { fileName, enabled: false };
            throw new Error(`"${fileName}" was not found.`);
        }

        fs.renameSync(enabledPath, disabledPath);
    }

    return { fileName, enabled };
}

function deleteItem(instanceFolder, item) {
    const enabledPath = resolveItem(instanceFolder, item);
    const disabledPath = `${enabledPath}.disabled`;

    let removed = false;

    for (const target of [enabledPath, disabledPath]) {
        if (fs.existsSync(target)) {
            fs.rmSync(target, { force: true, recursive: true });
            removed = true;
        }
    }

    if (!removed) throw new Error(`"${item.fileName}" was not found.`);

    const manifest = readManifest(instanceFolder);
    delete manifest[manifestKey(item.type, item.world ?? null, item.fileName)];
    writeManifest(instanceFolder, manifest);

    return { deleted: item.fileName };
}

/* Copies a data pack waiting in the instance's own folder into a world. */
function copyDatapackToWorld(instanceFolder, fileName, world) {
    const from = resolveItem(instanceFolder, { type: "datapack", world: null, fileName });
    const to = resolveItem(instanceFolder, { type: "datapack", world, fileName });

    if (!fs.existsSync(from)) throw new Error(`"${fileName}" was not found.`);

    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });

    const manifest = readManifest(instanceFolder);
    const meta = manifest[manifestKey("datapack", null, fileName)];
    if (meta) {
        manifest[manifestKey("datapack", world, fileName)] = meta;
        writeManifest(instanceFolder, manifest);
    }

    return { fileName, world };
}

/* ---------------- installing ---------------- */

async function installContent(
    instanceFolder,
    { type = "mod", world, url, localFile, fileName, name, source, projectId, versionNumber, iconUrl, sha1 },
    onProgress
) {
    const worldName = type === "datapack" && world ? world : null;
    const dir = contentDir(instanceFolder, type, worldName);

    fs.mkdirSync(dir, { recursive: true });

    const safeName = path.basename(fileName || "download");

    if (!FILE_PATTERNS[type].test(safeName) || safeName.endsWith(".disabled")) {
        throw new Error(`"${safeName}" is not a file that belongs in ${path.basename(dir)}.`);
    }

    const target = path.join(dir, safeName);

    // A file already downloaded and checked, as from GitHub, is copied in instead.
    if (localFile) fs.copyFileSync(localFile, target);
    else await downloadFile(url, target, { sha1 });

    if (onProgress) onProgress(100);

    const manifest = readManifest(instanceFolder);
    const key = manifestKey(type, worldName, safeName);

    manifest[key] = {
        name: name ?? safeName,
        source: source ?? "unknown",
        projectId: projectId ?? null,
        versionNumber: versionNumber ?? null,
        iconUrl: iconUrl ?? null,
        installedAt: new Date().toISOString(),
    };

    writeManifest(instanceFolder, manifest);

    // A previously disabled copy of the same file would shadow the new one.
    const stale = `${target}.disabled`;
    if (fs.existsSync(stale)) fs.rmSync(stale, { force: true });

    return {
        fileName: safeName,
        name: manifest[key].name,
        type,
        world: worldName,
        folder: path.relative(gameDir(instanceFolder), dir),
    };
}

module.exports = {
    listContent,
    setEnabled,
    deleteItem,
    copyDatapackToWorld,
    installContent,
    modsDir,
    resolveItem,
    manifestEntry,
    setManifestEntry,
};
