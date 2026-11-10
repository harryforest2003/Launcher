console.log("DOWNLOAD MANAGER LOADED");

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const unzipper = require("unzipper");

const { getManifest, fetch } = require("./manifest.cjs");
const { download } = require("./downloader.cjs");

const { instancesDir } = require("./paths.cjs");

const INSTANCES_DIR = instancesDir();

/* =========================
   JAVA DETECTION
========================= */

function getJavaExecutable() {
    return "java"; // replace later with version-based selection
}

/* =========================
   LIBRARY RULES
========================= */

function isAllowedLibrary(lib) {
    const rules = lib.rules;
    if (!rules) return true;

    let allowed = false;

    for (const rule of rules) {
        if (!rule.os) {
            allowed = rule.action === "allow";
        }

        if (rule.os?.name === "windows" && process.platform === "win32") {
            allowed = rule.action === "allow";
        }

        if (rule.os?.name === "osx" && process.platform === "darwin") {
            allowed = rule.action === "allow";
        }

        if (rule.os?.name === "linux" && process.platform === "linux") {
            allowed = rule.action === "allow";
        }
    }

    return allowed;
}

/* =========================
   ARG RESOLVER (REAL MC STYLE)
========================= */

function resolveArguments(versionJson, instanceFolder) {
    const gameArgs = versionJson.arguments?.game || [];
    const jvmArgs = versionJson.arguments?.jvm || [];

    const map = {
        "${auth_player_name}": "Steve",
        "${version_name}": versionJson.id,
        "${game_directory}": instanceFolder,
        "${assets_root}": path.join(instanceFolder, "assets"),
        "${assets_index_name}": versionJson.assetIndex?.id || "",
        "${user_type}": "mojang",
        "${version_type}": versionJson.type || ""
    };

    function apply(arr) {
        const out = [];

        for (const arg of arr) {
            if (typeof arg === "string") {
                let s = arg;

                for (const k in map) {
                    s = s.replaceAll(k, map[k]);
                }

                out.push(s);
            }
        }

        return out;
    }

    return {
        jvm: apply(jvmArgs),
        game: apply(gameArgs)
    };
}

/* =========================
   NATIVES EXTRACTION
========================= */

async function extractNativeJar(jarPath, outputDir) {
    await fs.createReadStream(jarPath)
        .pipe(unzipper.Extract({ path: outputDir }))
        .promise();
}

async function extractNatives(versionJson, instanceFolder) {
    const nativesFolder = path.join(instanceFolder, "natives");

    await fs.promises.mkdir(nativesFolder, { recursive: true });

    const libs = versionJson.libraries || [];

    for (const lib of libs) {
        const classifiers = lib.downloads?.classifiers;
        if (!classifiers) continue;

        const key =
            process.platform === "win32"
                ? "natives-windows"
                : process.platform === "darwin"
                ? "natives-osx"
                : "natives-linux";

        const native = classifiers[key];
        if (!native?.url) continue;

        const jarPath = path.join(
            nativesFolder,
            path.basename(native.path)
        );

        console.log("Downloading native:", native.path);

        await download(native.url, jarPath);

        console.log("Extracting native:", jarPath);

        await extractNativeJar(jarPath, nativesFolder);
    }

    console.log("Natives extracted");
}

/* =========================
   CLASSPATH
========================= */

function buildClassPath(versionJson, instanceFolder, version) {
    const libs = versionJson.libraries || [];

    const paths = [];

    for (const lib of libs) {
        const artifact = lib.downloads?.artifact;
        if (!artifact?.path) continue;

        paths.push(
            path.join(instanceFolder, "libraries", artifact.path)
        );
    }

    paths.push(
        path.join(instanceFolder, "versions", version, `${version}.jar`)
    );

    return paths.join(process.platform === "win32" ? ";" : ":");
}

/* =========================
   LAUNCH MINECRAFT
========================= */

function launchMinecraft(instance, versionJson, classPath, instanceFolder) {
    const java = getJavaExecutable();

    const nativesPath = path.join(instanceFolder, "natives");

    const args = resolveArguments(versionJson, instanceFolder);

    // Honour the RAM the instance was created with instead of a fixed 2G.
    const maxRam = Number(instance?.ram) > 0 ? Number(instance.ram) : 2;

    const jvmArgs = [
        `-Djava.library.path=${nativesPath}`,
        `-Xmx${maxRam}G`,
        `-Xms${Math.max(1, Math.floor(maxRam / 2))}G`,
        ...args.jvm
    ];

    const finalArgs = [
        ...jvmArgs,
        "-cp",
        classPath,
        versionJson.mainClass,
        ...args.game
    ];

    console.log("Launching Minecraft...");

    const proc = spawn(java, finalArgs, {
        stdio: "inherit",
        cwd: instanceFolder
    });

    proc.on("exit", code => {
        console.log("Minecraft exited:", code);
    });

    proc.on("error", err => {
        console.error("Java launch error:", err);
    });
}

/* =========================
   MAIN PIPELINE
========================= */

async function downloadMinecraft(instance) {
    try {
        console.log("DOWNLOAD INSTANCE:", instance);

        const manifest = await getManifest();

        const versionMeta = manifest.versions.find(
            v => v.id === instance.version
        );

        if (!versionMeta) {
            throw new Error("Version not found");
        }

        const versionJson = await fetch(versionMeta.url);

        const instanceFolder = path.join(
            INSTANCES_DIR,
            instance.name
        );

        const versionsFolder = path.join(
            instanceFolder,
            "versions",
            instance.version
        );

        await fs.promises.mkdir(versionsFolder, {
            recursive: true
        });

        await fs.promises.writeFile(
            path.join(versionsFolder, `${instance.version}.json`),
            JSON.stringify(versionJson, null, 4)
        );

        console.log("Saved version JSON");

        // CLIENT
        const client = versionJson?.downloads?.client;

        if (!client?.url) {
            throw new Error("Missing client download");
        }

        console.log("Downloading client...");

        await download(
            client.url,
            path.join(versionsFolder, `${instance.version}.jar`)
        );

        console.log("Client downloaded");

        // LIBRARIES
        console.log("Downloading libraries...");

        const libsFolder = path.join(instanceFolder, "libraries");
        await fs.promises.mkdir(libsFolder, { recursive: true });

        for (const lib of versionJson.libraries || []) {
            if (!isAllowedLibrary(lib)) continue;

            const artifact = lib.downloads?.artifact;
            if (!artifact?.url) continue;

            const filePath = path.join(libsFolder, artifact.path);

            await fs.promises.mkdir(path.dirname(filePath), {
                recursive: true
            });

            await download(artifact.url, filePath);
        }

        console.log("Libraries downloaded");

        // STEP 6 CORE
        await extractNatives(versionJson, instanceFolder);

        // Note: creating an instance no longer auto-launches the game.
        // Use the Launch button (minecraft:launch) instead.
        console.log("Instance ready:", instance.name);

    } catch (err) {
        console.error("Minecraft download failed:", err);
        throw err;
    }
}

/* =========================
   LAUNCH AN EXISTING INSTANCE
========================= */

// Backs the "minecraft:launch" IPC channel, which the Launch button calls.
// That channel previously had no handler at all, so the button threw
// "No handler registered for 'minecraft:launch'".
async function launchInstanceByName(name) {
    if (!name || typeof name !== "string") {
        throw new Error("Instance name is required.");
    }

    const instanceFolder = path.join(INSTANCES_DIR, name);
    const configPath = path.join(instanceFolder, "instance.json");

    if (!fs.existsSync(configPath)) {
        throw new Error(`Instance "${name}" not found.`);
    }

    const instance = JSON.parse(
        await fs.promises.readFile(configPath, "utf8")
    );

    const versionJsonPath = path.join(
        instanceFolder,
        "versions",
        instance.version,
        `${instance.version}.json`
    );

    if (!fs.existsSync(versionJsonPath)) {
        throw new Error(
            `Instance "${name}" is not fully downloaded ` +
            `(missing ${instance.version}.json). Re-create it.`
        );
    }

    const versionJson = JSON.parse(
        await fs.promises.readFile(versionJsonPath, "utf8")
    );

    const classPath = buildClassPath(
        versionJson,
        instanceFolder,
        instance.version
    );

    launchMinecraft(instance, versionJson, classPath, instanceFolder);

    return { launched: true, name };
}

module.exports = {
    downloadMinecraft,
    buildClassPath,
    launchInstanceByName
};