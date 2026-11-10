const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { rulesAllow, buildClasspath } = require("./versionData.cjs");

/*
 * Launch argument construction.
 *
 * The previous implementation substituted a handful of placeholders,
 * ignored argument rules entirely, hardcoded the player name to "Steve"
 * and passed no access token — so modern Minecraft refused the session.
 */

const CLASSPATH_SEPARATOR = process.platform === "win32" ? ";" : ":";

function substitute(value, map) {
    return String(value).replace(
        /\$\{([^}]+)\}/g,
        (whole, key) => (key in map ? map[key] : whole)
    );
}

/*
 * Modern version JSONs hold arrays mixing plain strings with
 * rule-guarded objects: { rules: [...], value: "..." | [...] }.
 */
function resolveArgumentList(list, map, features) {
    const out = [];

    for (const item of list ?? []) {
        if (typeof item === "string") {
            out.push(substitute(item, map));
            continue;
        }

        if (!item || typeof item !== "object") continue;

        if (!rulesAllow(item.rules, features)) continue;

        const values = Array.isArray(item.value) ? item.value : [item.value];

        for (const value of values) {
            if (value == null) continue;
            out.push(substitute(value, map));
        }
    }

    return out;
}

function buildArguments(versionJson, context) {
    const {
        instanceFolder,
        gameDirectory,
        nativesDir,
        classpath,
        account,
        resolution,
    } = context;

    const map = {
        auth_player_name: account.name,
        auth_uuid: account.uuid,
        auth_access_token: account.accessToken,
        auth_session: `token:${account.accessToken}:${account.uuid}`,
        auth_xuid: account.xuid ?? "",
        clientid: account.clientId ?? "",
        user_type: account.type ?? "msa",
        user_properties: "{}",

        version_name: versionJson.id,
        version_type: versionJson.type ?? "release",

        game_directory: gameDirectory,
        assets_root: path.join(instanceFolder, "assets"),
        game_assets: path.join(instanceFolder, "assets", "virtual", "legacy"),
        assets_index_name: versionJson.assets ?? versionJson.assetIndex?.id ?? "legacy",

        natives_directory: nativesDir,
        launcher_name: "UnityLauncher",
        launcher_version: "1.0",

        classpath: classpath.join(CLASSPATH_SEPARATOR),
        classpath_separator: CLASSPATH_SEPARATOR,
        library_directory: path.join(instanceFolder, "libraries"),

        resolution_width: String(resolution?.width ?? 854),
        resolution_height: String(resolution?.height ?? 480),
    };

    const features = {
        is_demo_user: false,
        has_custom_resolution: !!resolution,
        has_quick_plays_support: false,
        is_quick_play_singleplayer: false,
        is_quick_play_multiplayer: false,
        is_quick_play_realms: false,
    };

    let jvm;
    let game;

    if (versionJson.arguments) {
        jvm = resolveArgumentList(versionJson.arguments.jvm, map, features);
        game = resolveArgumentList(versionJson.arguments.game, map, features);
    } else {
        // Pre-1.13 format: a single string of game arguments, and the JVM
        // side has to be supplied by the launcher.
        jvm = [
            `-Djava.library.path=${nativesDir}`,
            "-cp",
            classpath.join(CLASSPATH_SEPARATOR),
        ];

        game = substitute(versionJson.minecraftArguments ?? "", map)
            .split(" ")
            .filter(Boolean);
    }

    // Some profiles omit the classpath from their JVM args.
    if (!jvm.includes("-cp") && !jvm.includes("-classpath")) {
        jvm.push("-cp", classpath.join(CLASSPATH_SEPARATOR));
    }

    return { jvm, game };
}

function memoryArgs(ram) {
    const max = Number(ram) > 0 ? Number(ram) : 4;
    const min = Math.max(1, Math.floor(max / 2));

    return [`-Xmx${max}G`, `-Xms${min}G`];
}

/*
 * Launch. Returns the child process so callers can stream its output.
 */
function launch({
    versionJson,
    instanceFolder,
    gameDirectory,
    account,
    ram,
    javaPath = "java",
    extraJvmArgs = [],
    onLog,
    onExit,
}) {
    const classpath = buildClasspath(versionJson, instanceFolder);

    const missing = classpath.filter(p => !fs.existsSync(p));

    if (missing.length) {
        throw new Error(
            `Instance is incomplete — ${missing.length} file(s) missing, ` +
            `starting with ${path.basename(missing[0])}. Reinstall the instance.`
        );
    }

    const nativesDir = path.join(instanceFolder, "natives", versionJson.id);

    // Natives may have been extracted under the vanilla id when a loader
    // renamed the profile.
    const resolvedNatives = fs.existsSync(nativesDir)
        ? nativesDir
        : path.join(instanceFolder, "natives");

    const { jvm, game } = buildArguments(versionJson, {
        instanceFolder,
        gameDirectory,
        nativesDir: resolvedNatives,
        classpath,
        account,
    });

    fs.mkdirSync(gameDirectory, { recursive: true });

    const args = [
        ...memoryArgs(ram),
        `-Djava.library.path=${resolvedNatives}`,
        ...extraJvmArgs,
        ...jvm,
        versionJson.mainClass,
        ...game,
    ];

    const proc = spawn(javaPath, args, { cwd: gameDirectory });

    proc.stdout.on("data", d => onLog?.(d.toString()));
    proc.stderr.on("data", d => onLog?.(d.toString()));

    proc.on("error", err => onLog?.(`Launch error: ${err.message}`));
    proc.on("close", code => onExit?.(code));

    return proc;
}

module.exports = {
    launch,
    buildArguments,
};
