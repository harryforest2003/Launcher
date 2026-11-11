const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { pool } = require("./net.cjs");

/*
 * Automatic Java: each Minecraft version says which Java it needs (its version file's
 * javaVersion), and the launcher downloads that build from Mojang, as the official
 * launcher does, once per Java version. Every file is checked against Mojang's hash,
 * and a runtime is only used once all of it has arrived.
 */

const RUNTIMES = "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
const USER_AGENT = "UnityLauncher/1.0 (+https://github.com/harryforest2003/Launcher)";

// Mojang's names for this computer, best first. Apple Silicon has no Java 8 or 16 of
// its own, so the Intel build is used for those, through Rosetta.
function platformKeys() {
    const { platform, arch } = process;
    if (platform === "darwin") return arch === "arm64" ? ["mac-os-arm64", "mac-os"] : ["mac-os"];
    if (platform === "win32") return arch === "arm64" ? ["windows-arm64", "windows-x64"] : arch === "ia32" ? ["windows-x86"] : ["windows-x64"];
    return arch === "ia32" ? ["linux-i386"] : ["linux"];
}

const runtimesDir = () => path.join(app.getPath("userData"), "java");

function javaExecutable(home) {
    if (process.platform === "darwin") return path.join(home, "jre.bundle", "Contents", "Home", "bin", "java");
    if (process.platform === "win32") return path.join(home, "bin", "java.exe");
    return path.join(home, "bin", "java");
}

/* The Java an installed instance's Minecraft version needs. */
function requiredJava(folder, instance) {
    for (const id of [instance.versionId, instance.vanillaId, instance.version]) {
        if (!id) continue;
        try {
            const json = JSON.parse(fs.readFileSync(path.join(folder, "versions", id, `${id}.json`), "utf8"));
            if (json.javaVersion?.component) return { component: json.javaVersion.component, majorVersion: json.javaVersion.majorVersion };
        } catch {
            // Not this one.
        }
    }
    // Versions from before Mojang said, which all ran on Java 8.
    return { component: "jre-legacy", majorVersion: 8 };
}

async function getJson(url) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30 * 1000) });
    if (!res.ok) throw new Error(`Mojang's Java list didn't load (HTTP ${res.status}).`);
    return res.json();
}

async function download({ component, majorVersion }, home, onProgress) {
    const all = await getJson(RUNTIMES);
    const entry = platformKeys().map((key) => all[key]?.[component]?.[0]).find(Boolean);
    if (!entry) throw new Error(`Mojang has no Java ${majorVersion} for this computer.`);

    const manifest = await getJson(entry.manifest.url);
    const partial = `${home}.partial`;
    fs.rmSync(partial, { recursive: true, force: true });
    fs.mkdirSync(partial, { recursive: true });

    const items = Object.entries(manifest.files);
    for (const [rel, item] of items) if (item.type === "directory") fs.mkdirSync(path.join(partial, rel), { recursive: true });

    const files = items.filter(([, item]) => item.type === "file" && item.downloads?.raw);
    const total = files.reduce((sum, [, item]) => sum + item.downloads.raw.size, 0) || 1;
    let done = 0;

    const { errors } = await pool(
        files,
        async ([rel, item]) => {
            const target = path.join(partial, rel);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const res = await fetch(item.downloads.raw.url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(120 * 1000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = Buffer.from(await res.arrayBuffer());
            if (crypto.createHash("sha1").update(data).digest("hex") !== item.downloads.raw.sha1) throw new Error(`${rel} didn't download properly`);
            fs.writeFileSync(target, data);
            if (item.executable && process.platform !== "win32") fs.chmodSync(target, 0o755);

            done += item.downloads.raw.size;
            onProgress?.({ stage: "java", percent: Math.round((done / total) * 100), detail: `Downloading Java ${majorVersion}` });
        },
        { concurrency: 8 }
    );
    if (errors.length) {
        fs.rmSync(partial, { recursive: true, force: true });
        throw new Error(`Java ${majorVersion} didn't finish downloading: ${errors[0].message}. Try again.`);
    }

    if (process.platform !== "win32") {
        for (const [rel, item] of items) {
            if (item.type === "link") fs.symlinkSync(item.target, path.join(partial, rel));
        }
    }

    fs.writeFileSync(path.join(partial, ".installed"), JSON.stringify({ component, majorVersion, version: entry.version?.name ?? null }));
    fs.rmSync(home, { recursive: true, force: true });
    fs.renameSync(partial, home);
}

// One download per Java at a time, however many instances ask for it.
const downloading = new Map();

/* The path to a Java of this kind, downloading it first if it isn't here yet. */
async function ensureRuntime(java, { onProgress } = {}) {
    const home = path.join(runtimesDir(), java.component);
    const executable = javaExecutable(home);
    const ready = () => fs.existsSync(path.join(home, ".installed")) && fs.existsSync(executable);

    if (!ready()) {
        if (!downloading.has(java.component)) {
            downloading.set(java.component, download(java, home, onProgress).finally(() => downloading.delete(java.component)));
        }
        await downloading.get(java.component);
    }

    return executable;
}

/* The Java versions downloaded so far, for Settings. */
function installedRuntimes() {
    try {
        return fs.readdirSync(runtimesDir()).flatMap((component) => {
            try {
                const info = JSON.parse(fs.readFileSync(path.join(runtimesDir(), component, ".installed"), "utf8"));
                return [{ ...info, component }];
            } catch {
                return [];
            }
        });
    } catch {
        return [];
    }
}

module.exports = { requiredJava, ensureRuntime, installedRuntimes, javaExecutable, platformKeys };
