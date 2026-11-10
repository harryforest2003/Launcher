const fs = require("fs");
const os = require("os");
const path = require("path");

/*
 * Importing instances from other launchers.
 *
 * Each launcher stores its instances differently, so every one gets a
 * small reader that answers the same three questions: what is it called,
 * which Minecraft version, which loader. Everything else (mods, configs,
 * saves) is copied verbatim.
 */

const home = os.homedir();
const platform = process.platform;

function appSupport(...parts) {
    if (platform === "darwin") {
        return path.join(home, "Library", "Application Support", ...parts);
    }

    if (platform === "win32") {
        return path.join(
            process.env.APPDATA || path.join(home, "AppData", "Roaming"),
            ...parts
        );
    }

    return path.join(home, ".local", "share", ...parts);
}

function existing(paths) {
    return paths.filter(p => p && fs.existsSync(p));
}

/* =========================================================
   LAUNCHER LOCATIONS
========================================================= */

const LAUNCHERS = {
    vanilla: {
        label: "Minecraft Launcher",
        roots: () => existing([
            platform === "darwin"
                ? path.join(home, "Library", "Application Support", "minecraft")
                : appSupport(".minecraft"),
            path.join(home, ".minecraft"),
        ]),
    },

    prism: {
        label: "Prism Launcher",
        roots: () => existing([
            appSupport("PrismLauncher", "instances"),
            path.join(home, ".local", "share", "PrismLauncher", "instances"),
        ]),
    },

    multimc: {
        label: "MultiMC",
        roots: () => existing([
            appSupport("MultiMC", "instances"),
            path.join(home, "MultiMC", "instances"),
        ]),
    },

    curseforge: {
        label: "CurseForge",
        roots: () => existing([
            path.join(home, "curseforge", "minecraft", "Instances"),
            path.join(home, "Documents", "curseforge", "minecraft", "Instances"),
            appSupport("CurseForge", "Instances"),
        ]),
    },

    modrinth: {
        label: "Modrinth App",
        roots: () => existing([
            appSupport("com.modrinth.theseus", "profiles"),
            appSupport("ModrinthApp", "profiles"),
        ]),
    },

    atlauncher: {
        label: "ATLauncher",
        roots: () => existing([
            appSupport("ATLauncher", "instances"),
            path.join(home, "ATLauncher", "instances"),
        ]),
    },

    gdlauncher: {
        label: "GDLauncher",
        roots: () => existing([
            appSupport("gdlauncher_next", "instances"),
            appSupport("GDLauncher", "instances"),
        ]),
    },
};

/* =========================================================
   PER-LAUNCHER READERS
========================================================= */

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return null;
    }
}

/*
 * Prism / MultiMC: instance.cfg holds the display name, mmc-pack.json
 * holds the component list (Minecraft plus any loader).
 */
function readPrismInstance(dir) {
    const pack = readJson(path.join(dir, "mmc-pack.json"));
    if (!pack?.components) return null;

    const componentIds = {
        "net.minecraft": "minecraft",
        "net.fabricmc.fabric-loader": "fabric",
        "org.quiltmc.quilt-loader": "quilt",
        "net.minecraftforge": "forge",
        "net.neoforged": "neoforge",
    };

    let mcVersion = null;
    let loader = "vanilla";
    let loaderVersion = "";

    for (const component of pack.components) {
        const kind = componentIds[component.uid];

        if (kind === "minecraft") mcVersion = component.version;
        else if (kind) {
            loader = kind;
            loaderVersion = component.version;
        }
    }

    if (!mcVersion) return null;

    let name = path.basename(dir);

    const cfg = path.join(dir, "instance.cfg");

    if (fs.existsSync(cfg)) {
        const match = fs.readFileSync(cfg, "utf8").match(/^name=(.+)$/m);
        if (match) name = match[1].trim();
    }

    // Prism keeps the game files in .minecraft or minecraft.
    const gameDir = existing([
        path.join(dir, ".minecraft"),
        path.join(dir, "minecraft"),
    ])[0] ?? dir;

    return { name, mcVersion, loader, loaderVersion, gameDir };
}

/*
 * CurseForge: minecraftinstance.json, same loader id format as its
 * modpack manifests ("forge-47.4.10").
 */
function readCurseForgeInstance(dir) {
    const data = readJson(path.join(dir, "minecraftinstance.json"));
    if (!data?.gameVersion) return null;

    let loader = "vanilla";
    let loaderVersion = "";

    const modLoader =
        data.baseModLoader?.name ??
        data.installedModpack?.gameVersion ??
        "";

    const match = String(modLoader).match(/^([a-zA-Z]+)-(.+)$/);

    if (match) {
        loader = match[1].toLowerCase();
        loaderVersion = match[2];
    }

    return {
        name: data.name ?? path.basename(dir),
        mcVersion: data.gameVersion,
        loader,
        loaderVersion,
        gameDir: dir,
    };
}

/*
 * Modrinth App keeps no per-profile manifest — instance metadata lives
 * in a SQLite database (app.db), with the version and loader in
 * instance_content_sets joined to instances by instance_id.
 */
function modrinthDbPath(profilesRoot) {
    return path.join(path.dirname(profilesRoot), "app.db");
}

function readModrinthDb(profilesRoot) {
    const dbPath = modrinthDbPath(profilesRoot);

    if (!fs.existsSync(dbPath)) return null;

    let DatabaseSync;

    try {
        ({ DatabaseSync } = require("node:sqlite"));
    } catch {
        // Older Electron/Node without node:sqlite — fall back to folder names.
        return null;
    }

    // The app may hold a write lock; work on a copy.
    const temp = path.join(
        os.tmpdir(),
        `unity-modrinth-${Date.now()}.db`
    );

    try {
        fs.copyFileSync(dbPath, temp);

        const db = new DatabaseSync(temp, { readOnly: true });

        const rows = db.prepare(`
            SELECT i.path AS path,
                   i.name AS name,
                   c.game_version AS game_version,
                   c.loader AS loader,
                   c.loader_version AS loader_version
            FROM instances i
            LEFT JOIN instance_content_sets c
                   ON c.instance_id = i.id
        `).all();

        db.close();

        const out = new Map();

        for (const row of rows) {
            if (!row.path) continue;

            // One row per content set; keep the one that has a version.
            if (out.has(row.path) && !row.game_version) continue;

            out.set(row.path, {
                name: row.name || row.path,
                mcVersion: row.game_version ?? null,
                loader: (row.loader ?? "vanilla").toLowerCase(),
                loaderVersion: row.loader_version ?? "",
            });
        }

        return out;

    } catch (err) {
        console.warn("Could not read Modrinth database:", err.message);
        return null;
    } finally {
        fs.rmSync(temp, { force: true });
    }
}

/*
 * Fallback when the database cannot be read: folder names in the
 * Modrinth App are usually "Fabric 1.21.4", and a .fabric/.quilt marker
 * directory confirms the loader.
 */
function guessModrinthInstance(dir) {
    const base = path.basename(dir);

    const versionMatch = base.match(/(\d+\.\d+(?:\.\d+)?)/);

    let loader = "vanilla";

    for (const candidate of ["fabric", "quilt", "forge", "neoforge"]) {
        if (
            base.toLowerCase().includes(candidate) ||
            fs.existsSync(path.join(dir, `.${candidate}`))
        ) {
            loader = candidate;
            break;
        }
    }

    return {
        name: base,
        mcVersion: versionMatch ? versionMatch[1] : null,
        loader,
        loaderVersion: "",
        gameDir: dir,
        needsVersion: !versionMatch,
    };
}

/*
 * ATLauncher: instance.json.
 */
function readAtInstance(dir) {
    const data = readJson(path.join(dir, "instance.json"));

    const mcVersion = data?.id ?? data?.minecraftVersion;
    if (!mcVersion) return null;

    let loader = "vanilla";
    let loaderVersion = "";

    if (data?.launcher?.loaderVersion) {
        loader = String(data.launcher.loaderVersion.type ?? "").toLowerCase() || "vanilla";
        loaderVersion = data.launcher.loaderVersion.version ?? "";
    }

    return {
        name: data?.launcher?.name ?? path.basename(dir),
        mcVersion,
        loader,
        loaderVersion,
        gameDir: dir,
    };
}

/*
 * GDLauncher: config.json.
 */
function readGdInstance(dir) {
    const data = readJson(path.join(dir, "config.json"));

    const loaderInfo = data?.loader;
    const mcVersion = loaderInfo?.mcVersion;

    if (!mcVersion) return null;

    const loaderType = String(loaderInfo?.loaderType ?? "vanilla").toLowerCase();

    return {
        name: path.basename(dir),
        mcVersion,
        loader: loaderType === "vanilla" ? "vanilla" : loaderType,
        loaderVersion: loaderInfo?.loaderVersion ?? "",
        gameDir: dir,
    };
}

/*
 * The official launcher has no instances — it has profiles that all
 * share one .minecraft folder.
 */
function readVanillaProfiles(root) {
    const profiles = readJson(path.join(root, "launcher_profiles.json"));

    if (!profiles?.profiles) return [];

    const out = [];

    for (const [key, profile] of Object.entries(profiles.profiles)) {
        const versionId = profile.lastVersionId;

        if (!versionId) continue;

        // Loader profiles encode the loader in the version id.
        let loader = "vanilla";
        let loaderVersion = "";
        let mcVersion = versionId;

        /*
         * "latest-release" / "latest-snapshot" are not real versions.
         * Surface them anyway and let the import step resolve them
         * against the version manifest.
         */
        const isFloating = /^latest-(release|snapshot)$/i.test(versionId);

        const fabric = versionId.match(/^fabric-loader-([\d.]+)-(.+)$/);
        const quilt = versionId.match(/^quilt-loader-([\d.]+)-(.+)$/);
        const forge = versionId.match(/^(.+?)-forge-(.+)$/);
        const neo = versionId.match(/^neoforge-(.+)$/);

        if (fabric) {
            loader = "fabric"; loaderVersion = fabric[1]; mcVersion = fabric[2];
        } else if (quilt) {
            loader = "quilt"; loaderVersion = quilt[1]; mcVersion = quilt[2];
        } else if (forge) {
            loader = "forge"; mcVersion = forge[1]; loaderVersion = `${forge[1]}-${forge[2]}`;
        } else if (neo) {
            loader = "neoforge"; loaderVersion = neo[1];
        }

        out.push({
            id: `vanilla:${key}`,
            launcher: "vanilla",
            launcherLabel: LAUNCHERS.vanilla.label,
            name: profile.name || (isFloating ? versionId : mcVersion),
            mcVersion: isFloating ? null : mcVersion,
            floatingVersion: isFloating ? versionId : null,
            loader,
            loaderVersion,
            gameDir: profile.gameDir || root,
            sourcePath: root,
            modCount: countMods(profile.gameDir || root),
        });
    }

    return out;
}

const READERS = {
    prism: readPrismInstance,
    multimc: readPrismInstance,
    curseforge: readCurseForgeInstance,
    atlauncher: readAtInstance,
    gdlauncher: readGdInstance,
};

/* =========================================================
   SCANNING
========================================================= */

function scanLaunchers() {
    const found = [];

    for (const [key, launcher] of Object.entries(LAUNCHERS)) {
        for (const root of launcher.roots()) {

            if (key === "vanilla") {
                found.push(...readVanillaProfiles(root));
                continue;
            }

            // Modrinth stores metadata centrally, not per folder.
            if (key === "modrinth") {
                const db = readModrinthDb(root);

                let entries = [];
                try {
                    entries = fs.readdirSync(root, { withFileTypes: true });
                } catch {
                    continue;
                }

                for (const entry of entries) {
                    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

                    const dir = path.join(root, entry.name);

                    const meta =
                        db?.get(entry.name) ?? guessModrinthInstance(dir);

                    if (!meta?.mcVersion) continue;

                    found.push({
                        id: `modrinth:${entry.name}`,
                        launcher: "modrinth",
                        launcherLabel: launcher.label,
                        name: meta.name ?? entry.name,
                        mcVersion: meta.mcVersion,
                        loader: meta.loader ?? "vanilla",
                        loaderVersion: meta.loaderVersion ?? "",
                        gameDir: dir,
                        sourcePath: dir,
                        modCount: countMods(dir),
                    });
                }

                continue;
            }

            const reader = READERS[key];
            if (!reader) continue;

            let entries = [];
            try {
                entries = fs.readdirSync(root, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const entry of entries) {
                if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

                const dir = path.join(root, entry.name);

                let parsed;
                try {
                    parsed = reader(dir);
                } catch {
                    parsed = null;
                }

                if (!parsed) continue;

                found.push({
                    id: `${key}:${entry.name}`,
                    launcher: key,
                    launcherLabel: launcher.label,
                    name: parsed.name,
                    mcVersion: parsed.mcVersion,
                    loader: parsed.loader,
                    loaderVersion: parsed.loaderVersion,
                    gameDir: parsed.gameDir,
                    sourcePath: dir,
                    modCount: countMods(parsed.gameDir),
                });
            }
        }
    }

    return found;
}

function countMods(gameDir) {
    try {
        return fs.readdirSync(path.join(gameDir, "mods"))
            .filter(f => /\.jar(\.disabled)?$/i.test(f))
            .length;
    } catch {
        return 0;
    }
}

/* =========================================================
   IMPORTING GAME CONTENT
========================================================= */

// What is worth carrying across; everything else is re-downloadable.
const IMPORT_DIRS = [
    "mods",
    "config",
    "saves",
    "resourcepacks",
    "shaderpacks",
    "screenshots",
    "schematics",
    "scripts",
    "kubejs",
    "defaultconfigs",
];

const IMPORT_FILES = ["options.txt", "servers.dat", "optionsof.txt"];

function copyGameContent(sourceDir, targetGameDir, onProgress) {
    fs.mkdirSync(targetGameDir, { recursive: true });

    let copied = 0;

    for (const name of IMPORT_DIRS) {
        const from = path.join(sourceDir, name);

        if (!fs.existsSync(from)) continue;

        const to = path.join(targetGameDir, name);

        onProgress?.(`Copying ${name}`);

        fs.cpSync(from, to, { recursive: true });
        copied++;
    }

    for (const name of IMPORT_FILES) {
        const from = path.join(sourceDir, name);

        if (!fs.existsSync(from)) continue;

        fs.copyFileSync(from, path.join(targetGameDir, name));
        copied++;
    }

    return copied;
}

/*
 * A plain folder the user pointed at. Works out whether it is a launcher
 * instance or a bare .minecraft-style game folder.
 */
function inspectFolder(dir) {
    if (!fs.existsSync(dir)) {
        throw new Error(`Folder not found: ${dir}`);
    }

    for (const [key, reader] of Object.entries(READERS)) {
        let parsed;
        try {
            parsed = reader(dir);
        } catch {
            parsed = null;
        }

        if (parsed) {
            return {
                ...parsed,
                launcher: key,
                launcherLabel: LAUNCHERS[key]?.label ?? key,
                sourcePath: dir,
                modCount: countMods(parsed.gameDir),
            };
        }
    }

    // A bare game folder: mods/ or versions/ present but no manifest we
    // recognise. The version cannot be inferred, so the caller must ask.
    const looksLikeGameDir =
        fs.existsSync(path.join(dir, "mods")) ||
        fs.existsSync(path.join(dir, "versions")) ||
        fs.existsSync(path.join(dir, "options.txt"));

    if (looksLikeGameDir) {
        return {
            name: path.basename(dir),
            mcVersion: null,
            loader: "vanilla",
            loaderVersion: "",
            gameDir: dir,
            launcher: "folder",
            launcherLabel: "Game folder",
            sourcePath: dir,
            modCount: countMods(dir),
            needsVersion: true,
        };
    }

    throw new Error(
        "That folder does not look like a Minecraft instance " +
        "(no mods/, versions/ or launcher config found)."
    );
}

/*
 * Turns "latest-release"/"latest-snapshot" into a concrete version id.
 */
async function resolveFloatingVersion(floating) {
    const { fetchJson } = require("./net.cjs");

    const manifest = await fetchJson(
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
    );

    return /snapshot/i.test(floating)
        ? manifest.latest.snapshot
        : manifest.latest.release;
}

module.exports = {
    scanLaunchers,
    resolveFloatingVersion,
    inspectFolder,
    copyGameContent,
    countMods,
    LAUNCHERS,
};
