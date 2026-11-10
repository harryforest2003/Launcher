const path = require("path");
const { mavenToPath } = require("./net.cjs");

/*
 * Everything about interpreting a Minecraft version JSON: which
 * libraries apply on this OS, where they land on disk, and how a loader
 * profile combines with the vanilla profile.
 */

const OS_NAME =
    process.platform === "win32" ? "windows" :
    process.platform === "darwin" ? "osx" :
    "linux";

const OS_ARCH = process.arch === "x64" ? "x86_64" : process.arch;

/* ---------------- rules ---------------- */

function matchesOs(osRule) {
    if (!osRule) return true;

    if (osRule.name && osRule.name !== OS_NAME) return false;

    if (osRule.arch) {
        const arch = process.arch === "x64" ? "x86_64" : process.arch;
        if (osRule.arch !== arch && osRule.arch !== process.arch) return false;
    }

    return true;
}

/*
 * Mojang's rule lists are evaluated in order, last match wins, default
 * deny. The previous implementation defaulted `allowed` to false and
 * only handled three OS names, so it dropped libraries with arch rules.
 */
function rulesAllow(rules, features = {}) {
    if (!rules || rules.length === 0) return true;

    let allowed = false;

    for (const rule of rules) {
        let applies = true;

        if (rule.os && !matchesOs(rule.os)) applies = false;

        if (rule.features) {
            for (const [key, wanted] of Object.entries(rule.features)) {
                if (Boolean(features[key]) !== Boolean(wanted)) applies = false;
            }
        }

        if (applies) allowed = rule.action === "allow";
    }

    return allowed;
}

function isLibraryAllowed(library) {
    return rulesAllow(library.rules);
}

/* ---------------- natives ---------------- */

function nativeClassifier(library) {
    if (!library.natives) return null;

    const key = library.natives[OS_NAME];
    if (!key) return null;

    return key.replace("${arch}", process.arch.includes("64") ? "64" : "32");
}

/* ---------------- library paths ---------------- */

/*
 * Returns { path, url, sha1, size } for a library artifact, covering
 * both Mojang-style (downloads.artifact) and loader-style (name + url)
 * declarations.
 */
function libraryArtifact(library) {
    const artifact = library.downloads?.artifact;

    if (artifact?.path) {
        return {
            path: artifact.path,
            url: artifact.url,
            sha1: artifact.sha1,
            size: artifact.size,
        };
    }

    if (!library.name) return null;

    // Fabric/Quilt/Forge give a Maven coordinate plus a repository base.
    const relative = mavenToPath(library.name).split(path.sep).join("/");

    const base = library.url || "https://libraries.minecraft.net/";

    return {
        path: relative,
        url: `${base.replace(/\/$/, "")}/${relative}`,
        sha1: library.downloads?.artifact?.sha1 ?? null,
        size: library.downloads?.artifact?.size ?? null,
    };
}

function nativeArtifact(library) {
    const classifier = nativeClassifier(library);
    if (!classifier) return null;

    const native = library.downloads?.classifiers?.[classifier];
    if (!native?.url) return null;

    return {
        path: native.path,
        url: native.url,
        sha1: native.sha1,
        size: native.size,
    };
}

/* ---------------- merging ---------------- */

/*
 * A loader profile (Fabric, Quilt, Forge) is a partial version JSON that
 * inherits from the vanilla one. Loader libraries must come FIRST on the
 * classpath so their patched classes win over vanilla's.
 */
function mergeVersions(vanilla, loader) {
    if (!loader) return vanilla;

    const merged = {
        ...vanilla,
        id: loader.id || vanilla.id,
        mainClass: loader.mainClass || vanilla.mainClass,
        libraries: [
            ...(loader.libraries ?? []),
            ...(vanilla.libraries ?? []),
        ],
    };

    // Modern format: arguments.game / arguments.jvm
    if (vanilla.arguments || loader.arguments) {
        merged.arguments = {
            game: [
                ...(vanilla.arguments?.game ?? []),
                ...(loader.arguments?.game ?? []),
            ],
            jvm: [
                ...(vanilla.arguments?.jvm ?? []),
                ...(loader.arguments?.jvm ?? []),
            ],
        };
    }

    // Legacy format used by older Forge builds.
    if (loader.minecraftArguments) {
        merged.minecraftArguments = loader.minecraftArguments;
    }

    // Keep the first occurrence of each group:artifact, so a loader's
    // newer version of a shared library replaces vanilla's.
    const seen = new Set();

    merged.libraries = merged.libraries.filter(lib => {
        if (!lib?.name) return true;

        const key = lib.name.split(":").slice(0, 2).join(":");

        if (seen.has(key)) return false;
        seen.add(key);

        return true;
    });

    return merged;
}

/* ---------------- classpath ---------------- */

function buildClasspath(versionJson, instanceFolder) {
    const entries = [];

    for (const library of versionJson.libraries ?? []) {
        if (!isLibraryAllowed(library)) continue;

        // Pure-natives entries contribute no classpath jar.
        if (library.natives && !library.downloads?.artifact && !library.url) {
            continue;
        }

        const artifact = libraryArtifact(library);
        if (!artifact) continue;

        entries.push(path.join(instanceFolder, "libraries", artifact.path));
    }

    entries.push(
        path.join(
            instanceFolder,
            "versions",
            versionJson.id,
            `${versionJson.id}.jar`
        )
    );

    // Dedupe while preserving loader-first ordering.
    return [...new Set(entries)];
}

module.exports = {
    rulesAllow,
    isLibraryAllowed,
    libraryArtifact,
    nativeArtifact,
    nativeClassifier,
    mergeVersions,
    buildClasspath,
    OS_NAME,
    OS_ARCH,
};
