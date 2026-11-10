const fs = require("fs");
const path = require("path");

/*
 * Local mod management. This works for every detected game, whether or
 * not an online provider exists for it.
 *
 * Disabling moves a mod OUT of the game's mod folder entirely, into a
 * sibling ".unity-disabled" directory. Renaming in place is not safe:
 * The Sims 4 and SMAPI both scan their Mods folder recursively, so a
 * "disabled" mod sitting inside it can still be picked up. Moving it
 * outside the scanned tree is the only reliably game-agnostic switch.
 */

const DISABLED_DIRNAME = ".unity-disabled";
const MANIFEST_NAME = ".unity-mods.json";

function disabledRoot(modDir) {
    // Sibling of the mod folder, so the game never scans it.
    return path.join(path.dirname(modDir), DISABLED_DIRNAME);
}

function manifestPath(modDir) {
    return path.join(disabledRoot(modDir), MANIFEST_NAME);
}

/* ---------------- install manifest ---------------- */

// Tracks which mods Unity installed, so the UI can show provenance and
// uninstall cleanly. Mods the user dropped in by hand simply won't appear.
function readManifest(modDir) {
    try {
        return JSON.parse(fs.readFileSync(manifestPath(modDir), "utf8"));
    } catch {
        return {};
    }
}

function writeManifest(modDir, data) {
    fs.mkdirSync(disabledRoot(modDir), { recursive: true });

    fs.writeFileSync(
        manifestPath(modDir),
        JSON.stringify(data, null, 2)
    );
}

/* ---------------- scanning ---------------- */

function dirSize(target) {
    let total = 0;

    const stack = [target];

    while (stack.length) {
        const current = stack.pop();

        let stat;
        try {
            stat = fs.statSync(current);
        } catch {
            continue;
        }

        if (stat.isDirectory()) {
            let entries = [];
            try {
                entries = fs.readdirSync(current);
            } catch {
                continue;
            }
            for (const e of entries) stack.push(path.join(current, e));
        } else {
            total += stat.size;
        }
    }

    return total;
}

/*
 * Walks a mod folder and returns one entry per mod.
 *
 * "loose" games (SMAPI, RimWorld) package each mod as a folder, so the
 * top-level folders are the mods. Everything else is file-based and
 * needs a bounded recursive walk.
 */
function scanTree(root, game, enabled) {
    if (!fs.existsSync(root)) return [];

    const mods = [];
    const extensions = game.modExtensions ?? [];
    const maxDepth = game.maxDepth ?? 4;

    if (game.loose) {
        let entries = [];
        try {
            entries = fs.readdirSync(root, { withFileTypes: true });
        } catch {
            return [];
        }

        for (const entry of entries) {
            if (entry.name.startsWith(".")) continue;
            if (!entry.isDirectory()) continue;

            const full = path.join(root, entry.name);

            mods.push({
                id: entry.name,
                name: entry.name,
                relativePath: entry.name,
                kind: "folder",
                size: dirSize(full),
                modified: safeMtime(full),
                enabled,
            });
        }

        return mods;
    }

    function walk(dir, depth, relBase) {
        if (depth > maxDepth) return;

        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (entry.name.startsWith(".")) continue;

            const full = path.join(dir, entry.name);
            const rel = relBase ? path.join(relBase, entry.name) : entry.name;

            if (entry.isDirectory()) {
                walk(full, depth + 1, rel);
                continue;
            }

            const ext = path.extname(entry.name).toLowerCase();
            if (extensions.length && !extensions.includes(ext)) continue;

            mods.push({
                id: rel,
                name: entry.name,
                relativePath: rel,
                kind: "file",
                size: safeSize(full),
                modified: safeMtime(full),
                enabled,
            });
        }
    }

    walk(root, 0, "");

    return mods;
}

function safeSize(p) {
    try { return fs.statSync(p).size; } catch { return 0; }
}

function safeMtime(p) {
    try { return fs.statSync(p).mtime.toISOString(); } catch { return null; }
}

/*
 * Full picture for one game: enabled mods from the live mod folder plus
 * disabled ones parked in .unity-disabled.
 */
function listMods(game, modDir) {
    if (!modDir) return [];

    const manifest = readManifest(modDir);

    const enabled = scanTree(modDir, game, true);
    const disabled = scanTree(
        path.join(disabledRoot(modDir), game.id),
        game,
        false
    );

    return [...enabled, ...disabled]
        .map(mod => ({
            ...mod,
            source: manifest[mod.relativePath]?.source ?? null,
            projectId: manifest[mod.relativePath]?.projectId ?? null,
            installedAt: manifest[mod.relativePath]?.installedAt ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------------- enable / disable ---------------- */

function movePath(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });

    try {
        fs.renameSync(from, to);
    } catch (err) {
        // rename fails across devices; fall back to copy + delete.
        if (err.code !== "EXDEV") throw err;

        fs.cpSync(from, to, { recursive: true });
        fs.rmSync(from, { recursive: true, force: true });
    }
}

// Guards against a crafted relativePath escaping the mod folder.
function safeJoin(root, relativePath) {
    const target = path.resolve(root, relativePath);
    const rootResolved = path.resolve(root);

    if (
        target !== rootResolved &&
        !target.startsWith(rootResolved + path.sep)
    ) {
        throw new Error("Refusing to touch a path outside the mod folder.");
    }

    return target;
}

function setModEnabled(game, modDir, relativePath, enabled) {
    if (!modDir) throw new Error("This game has no mod folder configured.");

    const parked = path.join(disabledRoot(modDir), game.id);

    const livePath = safeJoin(modDir, relativePath);
    const parkedPath = safeJoin(parked, relativePath);

    if (enabled) {
        if (!fs.existsSync(parkedPath)) {
            throw new Error(`"${relativePath}" is not in the disabled folder.`);
        }
        movePath(parkedPath, livePath);
    } else {
        if (!fs.existsSync(livePath)) {
            throw new Error(`"${relativePath}" was not found in the mod folder.`);
        }
        movePath(livePath, parkedPath);
    }

    return { relativePath, enabled };
}

/* ---------------- delete ---------------- */

function deleteMod(game, modDir, relativePath) {
    if (!modDir) throw new Error("This game has no mod folder configured.");

    const parked = path.join(disabledRoot(modDir), game.id);

    // The mod may be sitting in either location.
    for (const root of [modDir, parked]) {
        const target = safeJoin(root, relativePath);

        if (fs.existsSync(target)) {
            fs.rmSync(target, { recursive: true, force: true });

            const manifest = readManifest(modDir);
            delete manifest[relativePath];
            writeManifest(modDir, manifest);

            return { deleted: relativePath };
        }
    }

    throw new Error(`"${relativePath}" was not found.`);
}

module.exports = {
    listMods,
    setModEnabled,
    deleteMod,
    readManifest,
    writeManifest,
    disabledRoot,
};
