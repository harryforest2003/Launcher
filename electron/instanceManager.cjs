const fs = require("fs");
const path = require("path");

const { installInstance } = require("./minecraft/install.cjs");
const { launch } = require("./minecraft/launch.cjs");
const { getLatestLoaderVersion } = require("./minecraft/loaders.cjs");
const launcherSettings = require("./minecraft/settings.cjs");

const { instancesDir } = require("./paths.cjs");

const INSTANCE_DIR = instancesDir();

/* ---------------- SAFETY ---------------- */

function ensureDirectory() {
    if (!fs.existsSync(INSTANCE_DIR)) {
        fs.mkdirSync(INSTANCE_DIR, { recursive: true });
    }
}

// Instance names become folder names.
function safeName(name) {
    const trimmed = String(name ?? "").trim();

    if (!trimmed) throw new Error("Instance name is required.");

    if (/[/\\:*?"<>|]/.test(trimmed)) {
        throw new Error('Instance name cannot contain / \\ : * ? " < > |');
    }

    if (trimmed === "." || trimmed === "..") {
        throw new Error("Invalid instance name.");
    }

    return trimmed;
}

function instanceFolder(name) {
    const folder = path.join(INSTANCE_DIR, safeName(name));

    if (!path.resolve(folder).startsWith(path.resolve(INSTANCE_DIR) + path.sep)) {
        throw new Error("Invalid instance name.");
    }

    return folder;
}

/* ---------------- READ ---------------- */

function readInstance(folderName) {
    const file = path.join(INSTANCE_DIR, folderName, "instance.json");

    if (!fs.existsSync(file)) return null;

    try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));

        return {
            ...parsed,
            folder: path.join(INSTANCE_DIR, folderName),
            installed: !!parsed.versionId,
        };
    } catch {
        console.warn(`Invalid instance.json in ${folderName}`);
        return null;
    }
}

function getInstances() {
    ensureDirectory();

    const instances = [];

    for (const folder of fs.readdirSync(INSTANCE_DIR)) {
        if (folder.startsWith(".")) continue;

        const full = path.join(INSTANCE_DIR, folder);

        try {
            if (!fs.statSync(full).isDirectory()) continue;
        } catch {
            continue;
        }

        const instance = readInstance(folder);
        if (instance) instances.push(instance);
    }

    return instances;
}

function getInstance(name) {
    const instance = readInstance(safeName(name));

    if (!instance) throw new Error(`Instance "${name}" not found.`);

    return instance;
}

/* ---------------- CREATE ---------------- */

async function createInstance(config, { onProgress } = {}) {
    ensureDirectory();

    const name = safeName(config.name);

    if (!config.version) {
        throw new Error("A Minecraft version is required.");
    }

    const folder = instanceFolder(name);

    if (fs.existsSync(path.join(folder, "instance.json"))) {
        throw new Error(`An instance called "${name}" already exists.`);
    }

    fs.mkdirSync(folder, { recursive: true });

    const loader = (config.loader || "vanilla").toLowerCase();

    // "Latest compatible" is resolved here so it gets recorded, rather
    // than silently re-resolving to something different on every launch.
    let loaderVersion = config.loaderVersion || "";

    if (loader !== "vanilla" && !loaderVersion) {
        loaderVersion = await getLatestLoaderVersion(loader, config.version);

        if (!loaderVersion) {
            throw new Error(
                `No ${config.loader} build is available for Minecraft ${config.version}.`
            );
        }
    }

    // Write a stub first so a failed install still leaves a visible,
    // deletable instance rather than an orphan folder.
    const stub = {
        name,
        version: config.version,
        loader,
        loaderVersion,
        ram: Number(config.ram) > 0
            ? Number(config.ram)
            : launcherSettings.readSettings().defaultRam,
        created: new Date().toISOString(),
        gameDirectory: path.join(folder, ".minecraft"),
        installed: false,
    };

    fs.writeFileSync(
        path.join(folder, "instance.json"),
        JSON.stringify(stub, null, 4)
    );

    try {
        const result = await installInstance(
            { ...stub, loaderVersion },
            folder,
            { onProgress }
        );

        const finished = {
            ...stub,
            versionId: result.versionId,
            vanillaId: result.vanillaId,
            loaderVersion: result.loaderVersion || loaderVersion,
            assetIndex: result.assetIndex,
            gameDirectory: result.gameDirectory,
            installed: true,
        };

        fs.writeFileSync(
            path.join(folder, "instance.json"),
            JSON.stringify(finished, null, 4)
        );

        return finished;

    } catch (err) {
        // Record the failure so the UI can show it and offer a repair.
        fs.writeFileSync(
            path.join(folder, "instance.json"),
            JSON.stringify({ ...stub, error: err.message }, null, 4)
        );

        throw err;
    }
}

/* ---------------- REPAIR / DELETE ---------------- */

async function repairInstance(name, { onProgress } = {}) {
    const instance = getInstance(name);
    const folder = instanceFolder(name);

    const result = await installInstance(instance, folder, { onProgress });

    const finished = {
        ...instance,
        versionId: result.versionId,
        vanillaId: result.vanillaId,
        loaderVersion: result.loaderVersion || instance.loaderVersion,
        assetIndex: result.assetIndex,
        gameDirectory: result.gameDirectory,
        installed: true,
        error: undefined,
    };

    delete finished.folder;

    fs.writeFileSync(
        path.join(folder, "instance.json"),
        JSON.stringify(finished, null, 4)
    );

    return finished;
}

function deleteInstance(name) {
    const folder = instanceFolder(name);

    if (!fs.existsSync(folder)) {
        throw new Error(`Instance "${name}" not found.`);
    }

    fs.rmSync(folder, { recursive: true, force: true });

    return { deleted: name };
}

/* ---------------- UPDATE SETTINGS ---------------- */

// Fields the UI is allowed to change after creation.
const EDITABLE = ["ram", "jvmArgs", "javaPath", "notes"];

function updateInstance(name, patch) {
    const folder = instanceFolder(name);
    const instance = getInstance(name);

    const next = { ...instance };
    delete next.folder;
    delete next.installed;

    for (const key of EDITABLE) {
        if (!(key in patch)) continue;

        if (key === "ram") {
            const ram = Number(patch.ram);

            if (!Number.isFinite(ram) || ram < 1 || ram > 64) {
                throw new Error("RAM must be between 1 and 64 GB.");
            }

            next.ram = Math.floor(ram);
            continue;
        }

        next[key] = patch[key];
    }

    fs.writeFileSync(
        path.join(folder, "instance.json"),
        JSON.stringify(next, null, 4)
    );

    return { ...next, folder, installed: !!next.versionId };
}

/* ---------------- CREATE FROM AN EXISTING SOURCE ---------------- */

/*
 * Creates an instance whose game directory is populated by a caller
 * supplied step (a modpack, an import, a cloud restore) which runs after
 * the Minecraft/loader install.
 */
async function createInstanceFrom(config, populate, { onProgress } = {}) {
    const created = await createInstance(config, { onProgress });

    try {
        if (populate) {
            await populate({
                instance: created,
                folder: instanceFolder(created.name),
                gameDir: created.gameDirectory,
                onProgress,
            });
        }

        return created;

    } catch (err) {
        // The instance exists but its content step failed; keep it and
        // record why rather than leaving a half-populated mystery.
        try {
            const folder = instanceFolder(created.name);

            const current = JSON.parse(
                fs.readFileSync(path.join(folder, "instance.json"), "utf8")
            );

            fs.writeFileSync(
                path.join(folder, "instance.json"),
                JSON.stringify({ ...current, error: err.message }, null, 4)
            );
        } catch {
            // ignore bookkeeping failure
        }

        throw err;
    }
}

function instanceExists(name) {
    try {
        return fs.existsSync(path.join(instanceFolder(name), "instance.json"));
    } catch {
        return false;
    }
}

// Turns "Fabric 1.21.4" into a name not already taken.
function uniqueName(desired) {
    const base = String(desired ?? "Instance")
        .replace(/[/\\:*?"<>|]/g, "-")
        .trim() || "Instance";

    if (!instanceExists(base)) return base;

    for (let i = 2; i < 500; i++) {
        const candidate = `${base} (${i})`;
        if (!instanceExists(candidate)) return candidate;
    }

    return `${base} ${Date.now()}`;
}

/* ---------------- LAUNCH ---------------- */

const running = new Map();

/*
 * A child process that died without emitting "close" (killed externally,
 * crashed hard) would otherwise leave a stale entry here and make the
 * instance permanently un-launchable. Verify liveness before trusting it.
 */
function pruneDead(name) {
    const proc = running.get(name);

    if (!proc) return false;

    if (proc.exitCode !== null || proc.signalCode !== null || proc.killed) {
        running.delete(name);
        return false;
    }

    try {
        // Signal 0 checks existence without touching the process.
        process.kill(proc.pid, 0);
        return true;
    } catch {
        running.delete(name);
        return false;
    }
}

function launchInstance(name, account, { onLog, onExit } = {}) {
    const instance = getInstance(name);
    const folder = instanceFolder(name);

    if (!instance.versionId) {
        throw new Error(
            `"${name}" is not fully installed yet. Use Repair to finish it.`
        );
    }

    if (pruneDead(name)) {
        throw new Error(`"${name}" is already running.`);
    }

    const versionPath = path.join(
        folder, "versions", instance.versionId, `${instance.versionId}.json`
    );

    if (!fs.existsSync(versionPath)) {
        throw new Error(
            `"${name}" is missing its version data. Use Repair to reinstall.`
        );
    }

    const versionJson = JSON.parse(fs.readFileSync(versionPath, "utf8"));

    const global = launcherSettings.readSettings();

    /*
     * Per-instance overrides win; otherwise the launcher-wide settings
     * apply. Both are now actually consumed at launch — previously the
     * Settings page wrote to React state that nothing ever read.
     */
    const extraJvmArgs = launcherSettings.parseJvmArgs(
        instance.jvmArgs || global.jvmArgs
    );

    const javaPath =
        (instance.javaPath && fs.existsSync(instance.javaPath))
            ? instance.javaPath
            : launcherSettings.resolveJavaPath();

    const proc = launch({
        versionJson,
        instanceFolder: folder,
        gameDirectory: instance.gameDirectory ?? path.join(folder, ".minecraft"),
        account,
        ram: instance.ram,
        javaPath,
        extraJvmArgs,
        onLog,
        onExit: (code) => {
            running.delete(name);
            onExit?.(code);
        },
    });

    running.set(name, proc);

    // Record last played for the library view.
    try {
        const updated = { ...instance, lastPlayed: new Date().toISOString() };
        delete updated.folder;
        delete updated.installed;

        fs.writeFileSync(
            path.join(folder, "instance.json"),
            JSON.stringify(updated, null, 4)
        );
    } catch {
        // non-fatal
    }

    return { launched: true, name, pid: proc.pid };
}

function isRunning(name) {
    return pruneDead(name);
}

function stopInstance(name) {
    if (!pruneDead(name)) {
        throw new Error(`"${name}" is not running.`);
    }

    const proc = running.get(name);

    proc.kill();
    running.delete(name);

    return { stopped: name };
}

/* ---------------- STORAGE ---------------- */

function getFolderSize(dir) {
    let total = 0;

    if (!fs.existsSync(dir)) return 0;

    for (const file of fs.readdirSync(dir)) {
        const full = path.join(dir, file);

        try {
            const stat = fs.statSync(full);
            total += stat.isDirectory() ? getFolderSize(full) : stat.size;
        } catch {
            // skip unreadable entries
        }
    }

    return total;
}

function getInstancesStorage() {
    return getFolderSize(INSTANCE_DIR);
}

module.exports = {
    getInstances,
    getInstance,
    createInstance,
    createInstanceFrom,
    updateInstance,
    instanceExists,
    uniqueName,
    repairInstance,
    deleteInstance,
    launchInstance,
    stopInstance,
    isRunning,
    getInstancesStorage,
    instanceFolder,
    INSTANCE_DIR,
};
