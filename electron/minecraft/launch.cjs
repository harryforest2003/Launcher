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
        quickPlay,
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

        quick_play_singleplayer: quickPlay?.world ?? "",
        quick_play_multiplayer: quickPlay?.server ?? "",
    };

    const features = {
        is_demo_user: false,
        has_custom_resolution: !!resolution,
        has_quick_plays_support: false,
        is_quick_play_singleplayer: Boolean(quickPlay?.world),
        is_quick_play_multiplayer: Boolean(quickPlay?.server),
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

/*
 * Whether this Minecraft can open a world or server straight away (Quick Play, 1.20 and
 * newer): its version file asks for it, or its version number is new enough.
 */
function supportsQuickPlay(versionJson, mcVersion) {
    if (JSON.stringify(versionJson.arguments?.game ?? []).includes("is_quick_play_")) return true;
    const version = String(mcVersion ?? versionJson.id ?? "");
    const snapshot = /^(\d\d)w(\d\d)/.exec(version);
    if (snapshot) return Number(snapshot[1]) > 23 || (Number(snapshot[1]) === 23 && Number(snapshot[2]) >= 14);
    const [major, minor] = version.split(/[.-]/).map(Number);
    return major >= 2 || (major === 1 && minor >= 20);
}

/*
 * The game arguments that open a world or join a server as the game starts, when the
 * version file didn't add them itself. Before 1.20 only a server can be joined this way.
 */
function quickPlayArgs(game, quickPlay, versionJson, mcVersion) {
    if (!quickPlay?.world && !quickPlay?.server) return [];
    if (game.includes("--quickPlaySingleplayer") || game.includes("--quickPlayMultiplayer")) return [];
    if (supportsQuickPlay(versionJson, mcVersion)) {
        return quickPlay.world ? ["--quickPlaySingleplayer", quickPlay.world] : ["--quickPlayMultiplayer", quickPlay.server];
    }
    if (quickPlay.world) throw new Error("Opening a world straight from the launcher needs Minecraft 1.20 or newer.");
    const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(quickPlay.server);
    const [host, port] = v6 ? [v6[1], v6[2]] : quickPlay.server.split(":");
    return ["--server", host, "--port", port || "25565"];
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
    mcVersion,
    resolution = null,
    fullscreen = false,
    quickPlay = null,
    env = {},
    wrapper = [],
    onLog,
    onExit,
}) {
    const classpath = buildClasspath(versionJson, instanceFolder);

    const missing = classpath.filter(p => !fs.existsSync(p));

    if (missing.length) {
        throw new Error(
            `This instance is missing ${missing.length} game file(s), ` +
            `starting with ${path.basename(missing[0])}. Use Repair on the instance's page to download them again.`
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
        resolution,
        quickPlay,
    });

    game.push(...quickPlayArgs(game, quickPlay, versionJson, mcVersion));
    // Old versions' arguments have no window size of their own.
    if (resolution && !game.includes("--width")) game.push("--width", String(resolution.width), "--height", String(resolution.height));
    if (fullscreen && !game.includes("--fullscreen")) game.push("--fullscreen");

    fs.mkdirSync(gameDirectory, { recursive: true });

    const args = [
        ...memoryArgs(ram),
        `-Djava.library.path=${resolvedNatives}`,
        ...extraJvmArgs,
        ...jvm,
        versionJson.mainClass,
        ...game,
    ];

    // A wrapper command (as in "prime-run" or "gamemoderun") runs Java itself.
    const [program, ...before] = wrapper.length ? [...wrapper, javaPath] : [javaPath];
    const proc = spawn(program, [...before, ...args], { cwd: gameDirectory, env: { ...process.env, ...env } });

    proc.stdout.on("data", d => onLog?.(d.toString()));
    proc.stderr.on("data", d => onLog?.(d.toString()));

    proc.on("error", err => onLog?.(`Launch error: ${err.message}`));
    proc.on("close", code => onExit?.(code));

    return proc;
}

module.exports = {
    launch,
    buildArguments,
    supportsQuickPlay,
};
