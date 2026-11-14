const EventEmitter = require("events");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { installInstance, switchLoader } = require("./minecraft/install.cjs");
const { launch } = require("./minecraft/launch.cjs");
const { getLatestLoaderVersion } = require("./minecraft/loaders.cjs");
const launcherSettings = require("./minecraft/settings.cjs");
const { analyzeCrash } = require("./minecraft/crashHelp.cjs");
const { ensureRuntime, requiredJava } = require("./minecraft/javaRuntime.cjs");
const { restoreVanillaLibraries } = require("./minecraft/versionData.cjs");

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
        if (instance) instances.push(withRunState(instance));
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
        // Only arguments the launcher passes on (settings.cjs checkJvmArgs says which).
        ...(typeof config.jvmArgs === "string" && config.jvmArgs.trim() ? { jvmArgs: launcherSettings.checkJvmArgs(config.jvmArgs) } : {}),
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

/* ---------------- LOADER ---------------- */

/* Writes just these fields into instance.json, leaving everything else as it is. */
function writeInstanceFields(name, fields) {
    const file = path.join(instanceFolder(name), "instance.json");
    const current = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...current, ...fields }, null, 4));
}

/*
 * Moves an instance to another build of its loader. Only the loader's files are fetched,
 * and only the loader's fields change: the game folder, settings and the rest stay put.
 * -> { from: { loaderVersion, versionId }, to: { loaderVersion, versionId } }
 */
async function changeLoaderVersion(name, loaderVersion, { onProgress } = {}) {
    const instance = getInstance(name);
    const folder = instanceFolder(name);
    if (!instance.loader || instance.loader === "vanilla") throw new Error(`"${name}" has no mod loader to change.`);
    if (isRunning(name) || starting.has(name)) throw new Error(`Close Minecraft before changing the loader of "${name}".`);

    const result = await switchLoader({ ...instance, loaderVersion }, folder, {
        onProgress,
        resolveJava: installerJava(instance, onProgress),
    });

    const to = { loaderVersion: result.loaderVersion || loaderVersion, versionId: result.versionId };
    writeInstanceFields(name, { ...to, vanillaId: result.vanillaId });
    return { from: { loaderVersion: instance.loaderVersion, versionId: instance.versionId }, to };
}

/* Puts an instance back on a loader build it had, reinstalling it if its files are gone. */
async function restoreLoader(name, { loaderVersion, versionId }, { onProgress } = {}) {
    const json = versionId && path.join(instanceFolder(name), "versions", versionId, `${versionId}.json`);
    if (json && fs.existsSync(json)) {
        writeInstanceFields(name, { loaderVersion, versionId });
        return { loaderVersion, versionId };
    }
    return (await changeLoaderVersion(name, loaderVersion, { onProgress })).to;
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
    if (!patch || typeof patch !== "object") throw new Error("Those settings couldn't be read.");
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

        // The Java it runs: "" (automatic) or a real java program (see settings.cjs).
        if (key === "javaPath") {
            next.javaPath = launcherSettings.checkJavaPath(patch.javaPath);
            continue;
        }

        // Pages are told which Java arguments aren't used (minecraft/ipc.cjs checks first);
        // anything else saved here keeps only the ones that are.
        if (key === "jvmArgs") {
            next.jvmArgs = launcherSettings.cleanJvmArgs(String(patch.jvmArgs ?? "").slice(0, 8000));
            continue;
        }

        if (key === "notes") {
            next.notes = String(patch.notes ?? "").slice(0, 8000);
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
    const cleaned = String(desired ?? "Instance")
        .replace(/[\u0000-\u001f/\\:*?"<>|]/g, "-")
        .trim();
    // "." and ".." (or only dots) would name the instances folder or the one above it.
    const base = /^\.*$/.test(cleaned) ? "Instance" : cleaned;

    if (!instanceExists(base)) return base;

    for (let i = 2; i < 500; i++) {
        const candidate = `${base} (${i})`;
        if (!instanceExists(candidate)) return candidate;
    }

    return `${base} ${Date.now()}`;
}

/* ---------------- LAUNCH ---------------- */

/*
 * Any number of instances can be open at once, each as its own account. One account
 * can't be in two games at once: Minecraft allows one online session per account, and
 * a second would end the first. Offline play (no account) has no such limit.
 */
const running = new Map();

// Who each open or starting game plays as: { id, name } of a signed-in account, or null
// offline. Set from pressing Play until the game is gone.
const players = new Map();

/*
 * Forgets an instance's game. Given proc, only if that is still its game: one stopped
 * earlier was forgotten then, and a newer one may be starting or running in its place.
 */
function forgetRun(name, proc) {
    if (proc && running.get(name) !== proc) return;
    running.delete(name);
    players.delete(name);
}

/*
 * A child process that died without emitting "close" (killed externally,
 * crashed hard) would otherwise leave a stale entry here and make the
 * instance permanently un-launchable. Verify liveness before trusting it.
 */
function pruneDead(name) {
    const proc = running.get(name);

    if (!proc) return false;

    if (proc.exitCode !== null || proc.signalCode !== null || proc.killed) {
        forgetRun(name);
        return false;
    }

    try {
        // Signal 0 checks existence without touching the process.
        process.kill(proc.pid, 0);
        return true;
    } catch {
        forgetRun(name);
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

function recordLog(name, text, run = runs.get(name)) {
    if (!run) return;
    const parts = (run.partial + text).split(/\r?\n/);
    run.partial = parts.pop();
    run.lines.push(...parts);
    if (run.lines.length > MAX_LOG_LINES) run.lines.splice(0, run.lines.length - MAX_LOG_LINES);
    // A stopped game's last words don't go into the log of the one started after it.
    if (runs.get(name) === run) instanceEvents.emit("log", { name, text });
}

/*
 * The Java to use: the instance's own, the one chosen in Settings, or automatic (need is
 * the Java this Minecraft version asks for). Used for launching and for Forge/NeoForge
 * installers.
 */
async function chooseJava(instance, need, { onProgress, note }) {
    // Only a real java program, even if something else was saved before these checks.
    const isJava = (javaPath) => {
        try {
            return Boolean(launcherSettings.checkJavaPath(javaPath));
        } catch {
            if (javaPath) note(`Not using ${javaPath}: it isn't a Java program.`);
            return false;
        }
    };

    if (instance.javaPath && isJava(instance.javaPath)) {
        note(`Using this instance's Java: ${instance.javaPath}`);
        return instance.javaPath;
    }

    const chosen = launcherSettings.readSettings().javaPath?.trim();
    if (chosen && isJava(chosen)) {
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

const isOpen = (name) => starting.has(name) || pruneDead(name);

/* The instance whose game is open or starting as this signed-in account, or null. */
function instanceUsing(accountId) {
    if (!accountId) return null;
    for (const [name, player] of players) {
        if (player?.id === accountId && isOpen(name)) return name;
    }
    return null;
}

/* Every open or starting game's player: { [instance]: { id, name } | null }. No tokens. */
function playing() {
    const result = {};
    for (const [name, player] of players) {
        if (isOpen(name)) result[name] = player ? { ...player } : null;
    }
    return result;
}

/* An instance as pages see it: whether its game is open, and as whom. */
function withRunState(instance) {
    const open = isOpen(instance.name);
    return { ...instance, running: open && !starting.has(instance.name), playingAs: open ? players.get(instance.name) ?? null : null };
}

/*
 * account is what accountForLaunch gives: id is the saved account's id (null offline).
 * Throws, saying which game has it, when that account is already in one.
 */
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

    const busy = account?.online ? instanceUsing(account.id) : null;
    if (busy) {
        throw new Error(
            `${account.name} is already playing "${busy}". Minecraft allows one game per account at a time, so play this one as another account, or close "${busy}" first.`
        );
    }

    const versionPath = path.join(
        folder, "versions", instance.versionId, `${instance.versionId}.json`
    );

    if (!fs.existsSync(versionPath)) {
        throw new Error(
            `"${name}" is missing its version data. Use Repair to reinstall.`
        );
    }

    let versionJson = JSON.parse(fs.readFileSync(versionPath, "utf8"));

    // Instances with a loader merged before libraryKey counted classifiers lack some
    // of Minecraft's own libraries (on 26.2, LWJGL's classes). Put them back, once.
    let restored = 0;
    if (instance.vanillaId && instance.vanillaId !== instance.versionId) {
        try {
            const vanilla = JSON.parse(fs.readFileSync(path.join(folder, "versions", instance.vanillaId, `${instance.vanillaId}.json`), "utf8"));
            ({ versionJson, restored } = restoreVanillaLibraries(versionJson, vanilla));
            if (restored) fs.writeFileSync(versionPath, JSON.stringify(versionJson, null, 2));
        } catch {
            // No vanilla file to compare with; launch as it is.
        }
    }

    const global = launcherSettings.readSettings();

    // Per-instance overrides win; otherwise the launcher-wide settings apply. The Minecraft
    // Launcher's garbage collection settings come first, unless they choose their own.
    // Only the arguments the launcher passes on: any saved before these checks that could
    // run a program or write a file are left out, and the log says so.
    const { args: ownJvmArgs, refused: refusedJvmArgs } = launcherSettings.safeJvmArgs(instance.jvmArgs || global.jvmArgs);
    const extraJvmArgs = launcherSettings.withDefaultGc(ownJvmArgs);

    // This run's own record, so a game stopped and started again keeps its two runs apart.
    const run = { id: crypto.randomUUID(), lines: [], partial: "", running: true, startedAt: Date.now(), endedAt: null, exitCode: null };
    runs.set(name, run);
    const player = account?.online && account.id ? { id: account.id, name: account.name } : null;
    const note = (text) => recordLog(name, `[Unity Launcher] ${text}\n`, run);
    if (refusedJvmArgs.length) {
        note(`Left out Java arguments the launcher doesn't use (they could run a program or write a file): ${refusedJvmArgs.map((entry) => entry.arg).join(" ")}. Remove them in Settings.`);
    }
    if (restored) note(`Put back ${restored} of Minecraft's own libraries that an earlier install left out.`);
    if (!launcherSettings.choosesGc(ownJvmArgs)) note("Using the Minecraft Launcher's garbage collection settings, for fewer stutters.");

    // Held from here, so a second Play with the same account waits its turn.
    starting.add(name);
    players.set(name, player);
    let proc;
    try {
        const progress = (update) => {
            instanceEvents.emit("progress", { name, ...update });
            onProgress?.(update);
        };
        const javaPath = await chooseJava(instance, requiredJava(folder, instance), { onProgress: progress, note });

        proc = launch({
            versionJson,
            instanceFolder: folder,
            gameDirectory: instance.gameDirectory ?? path.join(folder, ".minecraft"),
            account,
            ram: instance.ram,
            javaPath,
            extraJvmArgs,
            onLog: (text) => recordLog(name, text, run),
            onExit: (code) => {
                // A game stopped and started again: only the newest one is "running".
                const superseded = runs.get(name) !== run;
                forgetRun(name, proc);
                if (run.partial) run.lines.push(run.partial);
                Object.assign(run, { partial: "", running: false, endedAt: Date.now(), exitCode: code });
                instanceEvents.emit("exit", { name, code, session: run.id, superseded });
            },
        });
    } catch (err) {
        players.delete(name);
        Object.assign(run, { running: false, endedAt: Date.now() });
        throw err;
    } finally {
        starting.delete(name);
    }

    running.set(name, proc);
    instanceEvents.emit("started", { name, session: run.id, account: player, pid: proc.pid, at: run.startedAt });

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

    return { launched: true, name, pid: proc.pid, account: player };
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
        mcVersion: instance.version,
        loader: String(instance.loader || "vanilla").toLowerCase(),
        loaderVersion: instance.loaderVersion ?? null,
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
    forgetRun(name);

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
    changeLoaderVersion,
    restoreLoader,
    deleteInstance,
    launchInstance,
    getLog,
    crashHelp,
    instanceEvents,
    stopInstance,
    isRunning,
    instanceUsing,
    playing,
    withRunState,
    getInstancesStorage,
    instanceFolder,
    INSTANCE_DIR,
};
