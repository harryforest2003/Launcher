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
    javaTuning: "performance", // "performance" (tuned Java flags) or "standard" (the Minecraft Launcher's)
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
 * A Java to run Minecraft with, as chosen in Settings or for one instance: "" (automatic),
 * or the full path of an existing program called java (javaw.exe or java.exe on Windows).
 * The launcher runs whatever is here, so a page can't make it any other program.
 */
function checkJavaPath(value) {
    const javaPath = String(value ?? "").trim();
    if (!javaPath) return "";

    const looksLikeJava = path.isAbsolute(javaPath) && /^javaw?(\.exe)?$/i.test(path.basename(javaPath));
    if (!looksLikeJava) {
        throw new Error('That isn\'t a Java program. Choose the file called "java" (or "javaw.exe" on Windows) in a Java folder\'s "bin" folder.');
    }

    let isFile = false;
    try {
        isFile = fs.statSync(javaPath).isFile();
    } catch {
        isFile = false;
    }
    if (!isFile) throw new Error(`There's no Java at ${javaPath}.`);

    return javaPath;
}

/*
 * A folder chosen for backups: "" (the default), or one the launcher offered the page (a
 * cloud folder it found, see minecraft/ipc.cjs cloud:detect) that's still there. A folder
 * picked in the folder dialog is saved by the main process itself.
 */
function checkFolder(value) {
    const folder = String(value ?? "").trim();
    if (!folder) return "";
    if (!require("../security.cjs").isGranted("cloud-folder", folder)) throw new Error("Choose that folder again: the launcher didn't offer it as a cloud folder.");

    let isDirectory = false;
    try {
        isDirectory = path.isAbsolute(folder) && fs.statSync(folder).isDirectory();
    } catch {
        isDirectory = false;
    }
    if (!isDirectory) throw new Error(`That folder isn't there: ${folder}`);

    return folder;
}

// Settings the main process keeps for itself (from its own dialogs), never set by a page.
const MAIN_ONLY = new Set(["skinPackFolder"]);

/*
 * A change to the settings as a page sends it: only plain values, none of the main
 * process's own, and the ones it acts on (the Java it runs, the folder it writes to)
 * checked first.
 */
function settingsFromPage(patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Those settings couldn't be read.");

    const clean = {};
    for (const [key, value] of Object.entries(patch)) {
        if (MAIN_ONLY.has(key) || key === "__proto__" || key === "constructor" || key === "prototype") continue;
        clean[key] = value;
    }

    if ("javaPath" in clean) clean.javaPath = checkJavaPath(clean.javaPath);
    if ("cloudFolder" in clean) clean.cloudFolder = checkFolder(clean.cloudFolder);
    if ("jvmArgs" in clean) clean.jvmArgs = checkJvmArgs(clean.jvmArgs);
    if ("javaTuning" in clean) {
        clean.javaTuning = javaTuningOf(clean.javaTuning);
        // Picking a set clears the Java flags typed in Settings, or they'd override it.
        if (!("jvmArgs" in clean)) {
            const { text, removed } = withoutJavaFlags(readSettings().jvmArgs);
            if (removed.length) clean.jvmArgs = text;
        }
    }
    if ("downloadConcurrency" in clean) {
        clean.downloadConcurrency = Math.max(1, Math.min(64, Math.round(Number(clean.downloadConcurrency)) || DEFAULTS.downloadConcurrency));
    }

    return clean;
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
 * Which Java arguments the launcher passes on: a strict allowlist. Java also takes
 * arguments that run a program (-XX:OnError=), write a file anywhere (-Xlog:...:file=),
 * load code (-javaagent:, -XX:+UnlockDiagnosticVMOptions -XX:+PrintAssembly, a class or
 * library named by a property), or weaken the game's connections (-DsocksProxyHost=,
 * -Djavax.net.debug=all). Only these are used:
 *
 *   memory and stack    -Xmx4G, -Xms1G, -Xmn512M, -Xss2M
 *   -XX settings        the garbage collection and tuning flags named in XX_SWITCHES and
 *                       XX_SETTINGS (a number only), and nothing called Unlock*: where an
 *                       allowed flag is experimental (G1NewSizePercent and the like), the
 *                       launcher unlocks experimental flags itself, as its default
 *                       garbage collection settings do
 *   -D properties       the few in PROPERTIES, each with a plain value (letters, digits, . , + -)
 *
 * Anything else is refused when saved, with a message saying which, and left out at launch.
 */
const MEMORY_ARG = /^-X(mx|ms|mn|ss)\d+[kKmMgGtT]?$/;
const NUMBER = /^\d+(\.\d+)?[kKmMgGtT%]?$/;

// -XX:+Name / -XX:-Name switches for garbage collection, memory and the JIT compiler.
const XX_SWITCHES = new Set([
    "UseG1GC", "UseZGC", "ZGenerational", "UseShenandoahGC", "UseParallelGC", "UseSerialGC",
    "ParallelRefProcEnabled", "DisableExplicitGC", "ExplicitGCInvokesConcurrent", "AlwaysPreTouch",
    "PerfDisableSharedMem", "UseStringDeduplication", "UseNUMA", "UseCompressedOops",
    "UseCompressedClassPointers", "UseLargePages", "UseTransparentHugePages", "UseAdaptiveSizePolicy",
    "UseDynamicNumberOfGCThreads", "ClassUnloading", "ClassUnloadingWithConcurrentMark", "ScavengeBeforeFullGC",
    "UseTLAB", "ResizeTLAB", "OptimizeStringConcat", "DoEscapeAnalysis", "EliminateLocks", "UseLoopPredicate",
    "RangeCheckElimination", "TieredCompilation", "SegmentedCodeCache", "UseCodeCacheFlushing",
    "OmitStackTraceInFastThrow", "AlwaysActAsServerClassMachine", "UseFastUnorderedTimeStamps",
    "UseCriticalJavaThreadPriority", "UseVectorCmov", "UseFPUForSpilling", "UseXMMForArrayCopy",
    "UseThreadPriorities", "ExitOnOutOfMemoryError", "ZProactive", "ZUncommit", "ShenandoahUncommit",
    "G1UseAdaptiveIHOP", "UseGCOverheadLimit", "DontCompileHugeMethods",
]);

// -XX:Name=<number> settings for garbage collection, memory and the JIT compiler.
const XX_SETTINGS = new Set([
    "MaxGCPauseMillis", "G1HeapRegionSize", "G1NewSizePercent", "G1MaxNewSizePercent", "G1ReservePercent",
    "G1HeapWastePercent", "G1MixedGCCountTarget", "G1MixedGCLiveThresholdPercent", "G1RSetUpdatingPauseTimePercent",
    "G1SATBBufferEnqueueingThresholdPercent", "G1ConcMarkStepDurationMillis", "G1ConcRSHotCardLimit",
    "G1ConcRefinementServiceIntervalMillis", "G1PeriodicGCInterval", "InitiatingHeapOccupancyPercent",
    "SurvivorRatio", "MaxTenuringThreshold", "GCTimeRatio", "ParallelGCThreads", "ConcGCThreads",
    "MetaspaceSize", "MaxMetaspaceSize", "MaxDirectMemorySize", "ReservedCodeCacheSize", "NonNMethodCodeHeapSize",
    "ProfiledCodeHeapSize", "NonProfiledCodeHeapSize", "NmethodSweepActivity", "MaxNodeLimit",
    "NodeLimitFudgeFactor", "ThreadPriorityPolicy", "AllocatePrefetchStyle", "LargePageSizeInBytes",
    "SoftMaxHeapSize", "ZCollectionInterval", "ZUncommitDelay", "ZAllocationSpikeTolerance", "CICompilerCount",
    "MaxInlineLevel", "MaxInlineSize", "FreqInlineSize", "InlineSmallCode", "LoopStripMiningIter",
    "MinHeapFreeRatio", "MaxHeapFreeRatio", "NewRatio", "NewSize", "MaxNewSize", "TieredStopAtLevel",
]);

// -XX settings that take one of a few words.
const XX_WORDS = {
    ShenandoahGCMode: /^(satb|iu|passive|generational)$/,
    ShenandoahGCHeuristics: /^(adaptive|static|compact|aggressive)$/,
};

// Of those, the experimental ones: they need -XX:+UnlockExperimentalVMOptions, which the launcher adds.
const XX_EXPERIMENTAL = new Set([
    "G1NewSizePercent", "G1MaxNewSizePercent", "G1MixedGCLiveThresholdPercent", "G1RSetUpdatingPauseTimePercent",
    "G1SATBBufferEnqueueingThresholdPercent", "G1ConcRSHotCardLimit", "G1ConcRefinementServiceIntervalMillis",
    "UseFastUnorderedTimeStamps", "UseCriticalJavaThreadPriority", "UseVectorCmov", "AlwaysActAsServerClassMachine",
    "ShenandoahGCMode", "NmethodSweepActivity", "ZProactive",
]);

// Written by people as part of well-known flag sets; the launcher adds it itself where needed.
const UNLOCK_EXPERIMENTAL = "-XX:+UnlockExperimentalVMOptions";

// The -D properties passed on: text encoding, graphics, network address family, log4j's
// lookup switch, locale, and Forge's own documented switches. None names a file, class,
// host or library.
const PROPERTIES = new Set([
    "file.encoding", "sun.jnu.encoding", "stdout.encoding", "stderr.encoding", "java.awt.headless",
    "java.net.preferIPv4Stack", "java.net.preferIPv6Addresses", "sun.java2d.opengl", "sun.java2d.d3d",
    "sun.java2d.noddraw", "sun.java2d.uiScale", "log4j2.formatMsgNoLookups", "user.language", "user.country",
    "fml.ignoreInvalidMinecraftCertificates", "fml.ignorePatchDiscrepancies", "fml.earlyprogresswindow",
    "fml.readTimeout", "fml.loginTimeout", "forge.logging.console.level", "java.util.Arrays.useLegacyMergeSort",
]);
const PROPERTY = /^-D([A-Za-z][\w.-]*)(?:=(.*))?$/s;
const PROPERTY_VALUE = /^[\w.,+-]{0,64}$/;

/* The -XX flag's name, if it's an allowed one. */
function allowedXX(arg) {
    const toggle = arg.match(/^-XX:[+-]([A-Za-z][A-Za-z0-9]*)$/);
    if (toggle) return XX_SWITCHES.has(toggle[1]) ? toggle[1] : null;
    const setting = arg.match(/^-XX:([A-Za-z][A-Za-z0-9]*)=(.+)$/);
    if (!setting) return null;
    if (XX_SETTINGS.has(setting[1]) && NUMBER.test(setting[2])) return setting[1];
    if (XX_WORDS[setting[1]]?.test(setting[2])) return setting[1];
    return null;
}

/* Why the launcher won't pass one Java argument on, or null if it will. */
function jvmArgProblem(arg) {
    if (MEMORY_ARG.test(arg) || arg === UNLOCK_EXPERIMENTAL) return null;
    if (arg.startsWith("-XX:")) return allowedXX(arg) ? null : "isn't one of the garbage collection or tuning settings the launcher allows";
    const property = arg.match(PROPERTY);
    if (property) {
        if (!PROPERTIES.has(property[1])) return "isn't one of the few -D settings the launcher allows";
        return PROPERTY_VALUE.test(property[2] ?? "") ? null : "has a value that isn't a plain word or number";
    }
    return "isn't a memory, garbage collection or tuning setting";
}

/*
 * The launcher's own Java arguments from a typed string: { args, refused }, refused being
 * [{ arg, why }]. -XX:+UnlockExperimentalVMOptions is never passed as typed: it goes first,
 * once, exactly when an allowed experimental flag needs it.
 */
function safeJvmArgs(raw) {
    const args = [];
    const refused = [];
    let experimental = false;
    for (const arg of parseJvmArgs(String(raw ?? ""))) {
        const why = jvmArgProblem(arg);
        if (why) refused.push({ arg, why });
        else if (arg !== UNLOCK_EXPERIMENTAL) {
            args.push(arg);
            if (XX_EXPERIMENTAL.has(allowedXX(arg))) experimental = true;
        }
    }
    return { args: experimental ? [UNLOCK_EXPERIMENTAL, ...args] : args, refused };
}

/*
 * Java arguments as typed in Settings or an instance's settings, checked before they're
 * saved. -> the string to save; throws, saying which and why, if any wouldn't be used.
 */
function checkJvmArgs(raw) {
    const text = String(raw ?? "").trim();
    if (text.length > 8000) throw new Error("Those Java arguments are too long.");
    const { refused } = safeJvmArgs(text);
    if (refused.length) {
        const list = refused.map(({ arg, why }) => `${arg} (it ${why})`).join("; ");
        throw new Error(
            `The launcher doesn't use ${refused.length === 1 ? "this Java argument" : "these Java arguments"}: ${list}. ` +
            "Memory (-Xmx4G), the usual garbage collection and tuning flags (-XX:+UseG1GC, -XX:MaxGCPauseMillis=50 ...) " +
            "and a few -D settings (such as -Dfile.encoding=UTF-8) are fine, because none of them can run a program or reach a file."
        );
    }
    return text;
}

/* The same string with only the arguments the launcher uses (for values saved before these checks). */
const cleanJvmArgs = (raw) => safeJvmArgs(raw).args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ");

/*
 * Java arguments without their -XX: flags (garbage collection, memory tuning and the JIT
 * compiler: what the Performance and Standard sets are made of), for when one of those sets
 * is picked, so it's the one used rather than flags typed earlier. Memory (-Xmx) and -D
 * settings stay. -> { text, removed: the flags taken out }
 */
function withoutJavaFlags(raw) {
    const args = parseJvmArgs(String(raw ?? ""));
    const removed = args.filter((arg) => arg.startsWith("-XX:"));
    if (!removed.length) return { text: String(raw ?? "").trim(), removed };
    const text = args.filter((arg) => !arg.startsWith("-XX:")).map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ");
    return { text, removed };
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

/*
 * The "Performance" Java settings: the Minecraft Launcher's own (above), plus three that
 * can't make a game slower. They change only how Java runs the game, never what it draws.
 *  - A mod calling System.gc() starts a background clean-up instead of freezing the game
 *    while Java clears all its memory at once (often a second or more in a modpack).
 *  - Java stops writing its statistics to a file on disk, which can hold up a clean-up
 *    while the disk is busy.
 *  - Room for 400 MB of compiled code rather than 240 MB, for very big modpacks: when it
 *    fills, Java stops compiling and the game crawls. Only what's used takes memory.
 * Heavier tuning (brucethemoose's flags, the heap at full size from the start) was dropped:
 * on a 4-core, 16 GB laptop it ran worse than the Minecraft Launcher's. The full-size heap
 * holds all its memory even when the game needs half, pushing the Mac into swap, and
 * starting clean-up when memory is 10% full keeps it running nearly all the time.
 * All of these run on Java 8 to 25.
 */
const PERFORMANCE_GC_ARGS = [
    ...DEFAULT_GC_ARGS,
    "-XX:+ExplicitGCInvokesConcurrent",
    "-XX:+PerfDisableSharedMem",
    "-XX:ReservedCodeCacheSize=400M",
];

const JAVA_TUNINGS = new Set(["standard", "performance"]);

/* "standard" or "performance" from a saved value; anything else is the default. */
const javaTuningOf = (value) => (JAVA_TUNINGS.has(value) ? value : DEFAULTS.javaTuning);

/* Whether these Java arguments pick a garbage collector (-XX:+UseZGC and the like). */
const choosesGc = (args) => args.some((arg) => /^-XX:[+-]Use\w*GC$/.test(arg));

/* A launch's Java arguments: the default garbage collection first, so any of the person's own come after and win. */
const withDefaultGc = (args) => (choosesGc(args) ? args : [...DEFAULT_GC_ARGS, ...args]);

/*
 * A launch's Java arguments for a tuning ("standard" or "performance"). The person's own
 * arguments come last and win; if they pick a garbage collector, neither set is used.
 */
function launchJvmArgs(own, { tuning } = {}) {
    if (choosesGc(own)) return own;
    return [...(javaTuningOf(tuning) === "performance" ? PERFORMANCE_GC_ARGS : DEFAULT_GC_ARGS), ...own];
}

module.exports = {
    readSettings,
    writeSettings,
    checkJvmArgs,
    safeJvmArgs,
    cleanJvmArgs,
    withoutJavaFlags,
    jvmArgProblem,
    checkJavaPath,
    checkFolder,
    settingsFromPage,
    systemInfo,
    parseJvmArgs,
    choosesGc,
    withDefaultGc,
    launchJvmArgs,
    javaTuningOf,
    DEFAULT_GC_ARGS,
    PERFORMANCE_GC_ARGS,
    DEFAULTS,
};
