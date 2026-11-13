const fs = require("fs");
const os = require("os");
const path = require("path");
const { app } = require("electron");

/*
 * Launcher-wide settings.
 *
 * The Settings page used to be local React state that vanished on
 * navigation, and nothing read it. These values are persisted in
 * userData and actually consumed: defaultRam seeds new instances,
 * javaPath and jvmArgs are applied at launch.
 */

const DEFAULTS = {
    defaultRam: 4,
    javaPath: "",              // "" means automatic: the right Java for each version
    jvmArgs: "",
    closeOnLaunch: false,
    showSnapshots: false,
    cloudFolder: "",           // a synced folder (OneDrive, Dropbox, iCloud...)
    downloadConcurrency: 16,
    instanceGroups: {},        // the Library's groups: { name: [instance names] }
};

function settingsPath() {
    return path.join(app.getPath("userData"), "launcher-settings.json");
}

function readSettings() {
    try {
        const stored = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
        return { ...DEFAULTS, ...stored };
    } catch {
        return { ...DEFAULTS };
    }
}

function writeSettings(patch) {
    const next = { ...readSettings(), ...patch };

    // Keep RAM inside something a JVM will accept.
    if (next.defaultRam != null) {
        next.defaultRam = Math.max(1, Math.min(64, Number(next.defaultRam) || 4));
    }

    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));

    return next;
}

/*
 * How much RAM the machine actually has, so the UI can cap the slider
 * instead of letting someone allocate more than exists.
 */
function systemInfo() {
    const totalGb = Math.round(os.totalmem() / 1024 / 1024 / 1024);

    return {
        totalRamGb: totalGb,
        // Leave headroom for the OS and the launcher itself.
        maxRecommendedGb: Math.max(2, Math.floor(totalGb * 0.75)),
        platform: process.platform,
        arch: process.arch,
    };
}

/*
 * Split a user-entered JVM argument string into argv entries, keeping
 * quoted values together.
 *
 * spawn() passes arguments straight to the process with no shell, so the
 * quotes themselves must be removed — -Dname="my value" has to arrive as
 * the single argument -Dname=my value.
 */
function parseJvmArgs(raw) {
    if (!raw || !raw.trim()) return [];

    return (raw.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [])
        .map(a => a.replace(/"/g, ""))
        .filter(Boolean);
}

/*
 * The Minecraft Launcher's own garbage collection settings, used for every launch unless
 * the instance (or Settings) chooses a garbage collector itself. Java's pauses are kept
 * short (50 ms, rather than its usual 200), so fewer stutters. Java 8 to 25 all take them.
 */
const DEFAULT_GC_ARGS = [
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+UseG1GC",
    "-XX:G1NewSizePercent=20",
    "-XX:G1ReservePercent=20",
    "-XX:MaxGCPauseMillis=50",
    "-XX:G1HeapRegionSize=32M",
];

/* Whether these Java arguments pick a garbage collector (-XX:+UseZGC and the like). */
const choosesGc = (args) => args.some((arg) => /^-XX:[+-]Use\w*GC$/.test(arg));

/* A launch's Java arguments: the default garbage collection first, so any of the person's own come after and win. */
const withDefaultGc = (args) => (choosesGc(args) ? args : [...DEFAULT_GC_ARGS, ...args]);

module.exports = {
    readSettings,
    writeSettings,
    systemInfo,
    parseJvmArgs,
    choosesGc,
    withDefaultGc,
    DEFAULT_GC_ARGS,
    DEFAULTS,
};
