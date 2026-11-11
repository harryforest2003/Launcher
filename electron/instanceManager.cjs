const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");

const { installInstance } = require("./minecraft/install.cjs");
const { launch } = require("./minecraft/launch.cjs");
const { getLatestLoaderVersion } = require("./minecraft/loaders.cjs");
const launcherSettings = require("./minecraft/settings.cjs");
const { analyzeCrash } = require("./minecraft/crashHelp.cjs");
const { ensureRuntime, requiredJava } = require("./minecraft/javaRuntime.cjs");

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
        // Extra Java arguments typed when creating it; the instance's settings can change them.
        ...(typeof config.jvmArgs === "string" && config.jvmArgs.trim() ? { jvmArgs: config.jvmArgs.trim() } : {}),
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
            { onProgress, resolveJava: installerJava(stub, onProgress) }
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

/* The Java a Forge/NeoForge installer runs on: the same choice as launching makes. */
function installerJava(instance, onProgress) {
    return (need) =>
        chooseJava(instance, need, {
            onProgress,
            note: (text) => onProgress?.({ stage: "loader", percent: 50, detail: text }),
        });
}

/* ---------------- REPAIR / DELETE ---------------- */

async function repairInstance(name, { onProgress } = {}) {
    const instance = getInstance(name);
    const folder = instanceFolder(name);

    const result = await installInstance(instance, folder, { onProgress, resolveJava: installerJava(instance, onProgress) });

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

/*
 * A copy of an instance under a new name: its mods, worlds, settings and the rest, but
 * not its logs or crash reports, and with a fresh play history.
 */
async function duplicateInstance(name, newName) {
    const source = getInstance(name);
    const copyName = safeName(newName);

    if (isRunning(name)) throw new Error(`Stop ${name} before copying it.`);
    if (instanceExists(copyName)) throw new Error(`An instance called "${copyName}" already exists.`);

    const from = instanceFolder(name);
    const to = instanceFolder(copyName);
    const gameDir = path.resolve(source.gameDirectory ?? path.join(from, ".minecraft"));
    const skipped = new Set(["logs", "crash-reports"].map((dir) => path.join(gameDir, dir)));

    try {
        await fs.promises.cp(from, to, {
            recursive: true,
            errorOnExist: true,
            force: false,
            filter: (src) => !skipped.has(path.resolve(src)),
        });

        // Its own name and game folder; a game folder kept elsewhere is shared as before.
        const insideOld = gameDir.startsWith(path.resolve(from) + path.sep);
        const copy = {
            ...JSON.parse(fs.readFileSync(path.join(to, "instance.json"), "utf8")),
            name: copyName,
            gameDirectory: insideOld ? path.join(to, path.relative(from, gameDir)) : source.gameDirectory,
            created: new Date().toISOString(),
        };
        delete copy.lastPlayed;
        delete copy.playTime;
        fs.writeFileSync(path.join(to, "instance.json"), JSON.stringify(copy, null, 4));
    } catch (err) {
        // Nothing half-copied is left behind.
        await fs.promises.rm(to, { recursive: true, force: true }).catch(() => {});
        throw err;
    }

    return getInstance(copyName);
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

/*
 * Each run's output, so the instance's Log tab shows it whichever button started the
 * game, and crash help can read it. Events go to every window as they happen.
 */
const instanceEvents = new EventEmitter();
const runs = new Map();
const MAX_LOG_LINES = 5000;

function recordLog(name, text) {
    const run = runs.get(name);
    if (!run) return;
    const parts = (run.partial + text).split(/\r?\n/);
    run.partial = parts.pop();
    run.lines.push(...parts);
    if (run.lines.length > MAX_LOG_LINES) run.lines.splice(0, run.lines.length - MAX_LOG_LINES);
    instanceEvents.emit("log", { name, text });
}

/*
 * The Java to use: the instance's own, the one chosen in Settings, or automatic (need is
 * the Java this Minecraft version asks for). Used for launching and for Forge/NeoForge
 * installers.
 */
async function chooseJava(instance, need, { onProgress, note }) {
    if (instance.javaPath && fs.existsSync(instance.javaPath)) {
        note(`Using this instance's Java: ${instance.javaPath}`);
        return instance.javaPath;
    }

    const chosen = launcherSettings.readSettings().javaPath?.trim();
    if (chosen && fs.existsSync(chosen)) {
        note(`Using the Java chosen in Settings: ${chosen}`);
        return chosen;
    }

    try {
        const javaPath = await ensureRuntime(need, { onProgress });
        note(`Using Java ${need.majorVersion}, downloaded automatically for Minecraft ${instance.version}.`);
        return javaPath;
    } catch (err) {
        note(`Couldn't get Java ${need.majorVersion} (${err.message}), so trying this computer's own java.`);
        return "java";
    }
}

// Instances between pressing Launch and Minecraft starting (Java may be downloading).
const starting = new Set();

async function launchInstance(name, account, { onProgress } = {}) {
    const instance = getInstance(name);
    const folder = instanceFolder(name);

    if (!instance.versionId) {
        throw new Error(
            `"${name}" is not fully installed yet. Use Repair to finish it.`
        );
    }

    if (pruneDead(name) || starting.has(name)) {
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

    // Per-instance overrides win; otherwise the launcher-wide settings apply.
    const extraJvmArgs = launcherSettings.parseJvmArgs(
        instance.jvmArgs || global.jvmArgs
    );

    runs.set(name, { lines: [], partial: "", running: true, startedAt: Date.now(), endedAt: null, exitCode: null });
    const note = (text) => recordLog(name, `[Unity Launcher] ${text}\n`);

    starting.add(name);
    let javaPath;
    try {
        const progress = (update) => {
            instanceEvents.emit("progress", { name, ...update });
            onProgress?.(update);
        };
        javaPath = await chooseJava(instance, requiredJava(folder, instance), { onProgress: progress, note });
    } finally {
        starting.delete(name);
    }

    const proc = launch({
        versionJson,
        instanceFolder: folder,
        gameDirectory: instance.gameDirectory ?? path.join(folder, ".minecraft"),
        account,
        ram: instance.ram,
        javaPath,
        extraJvmArgs,
        onLog: (text) => recordLog(name, text),
        onExit: (code) => {
            running.delete(name);
            const run = runs.get(name);
            if (run) {
                if (run.partial) run.lines.push(run.partial);
                Object.assign(run, { partial: "", running: false, endedAt: Date.now(), exitCode: code });
            }
            instanceEvents.emit("exit", { name, code });
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

/*
 * The latest run's output: this session's if the game was started since the launcher
 * opened, otherwise the log Minecraft wrote last time.
 */
function getLog(name) {
    const instance = getInstance(name);
    const run = runs.get(name);

    if (run) {
        return {
            source: "live",
            running: run.running,
            startedAt: run.startedAt,
            endedAt: run.endedAt,
            exitCode: run.exitCode,
            lines: run.partial ? [...run.lines, run.partial] : [...run.lines],
        };
    }

    const file = path.join(instance.gameDirectory ?? path.join(instanceFolder(name), ".minecraft"), "logs", "latest.log");
    try {
        const stat = fs.statSync(file);
        const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
        return { source: "file", running: false, startedAt: null, endedAt: stat.mtimeMs, exitCode: null, lines: lines.slice(-MAX_LOG_LINES) };
    } catch {
        return { source: "none", running: false, startedAt: null, endedAt: null, exitCode: null, lines: [] };
    }
}

/* Why the latest run crashed, and which mods may be to blame. */
async function crashHelp(name) {
    const instance = getInstance(name);
    const log = getLog(name);
    if (log.running) return { crashed: false };

    return analyzeCrash({
        gameDir: instance.gameDirectory ?? path.join(instanceFolder(name), ".minecraft"),
        ram: instance.ram,
        lines: log.lines,
        exitCode: log.exitCode,
        // Without this session's run, the crash files written around the last log.
        startedAt: log.startedAt ?? (log.endedAt ? log.endedAt - 10 * 60 * 1000 : 0),
    });
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
    duplicateInstance,
    updateInstance,
    instanceExists,
    uniqueName,
    repairInstance,
    deleteInstance,
    launchInstance,
    getLog,
    crashHelp,
    instanceEvents,
    stopInstance,
    isRunning,
    getInstancesStorage,
    instanceFolder,
    INSTANCE_DIR,
};
