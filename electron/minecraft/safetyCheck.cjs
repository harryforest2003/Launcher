const fs = require("fs");
const os = require("os");
const path = require("path");
const fsp = require("fs/promises");
const zlib = require("zlib");
const instanceMods = require("./instanceMods.cjs");

/*
 * Looks through an instance's mods for signs of malware, and through this computer for
 * the files the fractureiser malware (June 2023) left behind.
 *
 * Every mod is looked up by its hash on Modrinth and CurseForge: a file neither site knows
 * came from somewhere else, which is where most malware comes from. Then the code inside
 * it (and inside the jars it bundles) is read for what malware does and mods rarely need:
 * loading code from the internet, running programs, reaching for browser logins and
 * Discord tokens, setting itself to start with the computer. Known malware addresses and
 * file names count as dangerous on their own; the rest only in combinations, and less for
 * a file a mod site knows.
 *
 * It is a check, not an antivirus: a clean result means nothing here looked wrong.
 */

// Strings from known malware: fractureiser's servers and files, and its later stages.
const KNOWN_BAD = [
    "85.217.144.130",
    "107.189.3.101",
    "files-8ie.pages.dev",
    "libWebGL64",
    "systemd-utility.service",
    "skyrage",
    "neko.run",
];

// Things a class can say, each a test over its bytes. Class files keep names and string
// constants as plain text, so a search finds them.
const SIGNS = {
    classLoader: ["java/net/URLClassLoader", "defineClass"],
    network: ["java/net/URL", "java/net/Socket", "java/net/http/HttpClient", "openConnection"],
    run: ["java/lang/ProcessBuilder", "java/lang/Runtime"],
    // The method name exactly, as the class keeps it (its length, then the name), not "execute".
    exec: ["\u0000\u0004exec"],
    hidden: ["java/util/Base64", "javax/crypto/Cipher"],
    reflect: ["java/lang/reflect/Method", "forName"],
    bytesToString: ["([B)V"],
    webhook: ["discord.com/api/webhooks", "discordapp.com/api/webhooks", "api.telegram.org/bot"],
    secrets: ["Local Storage/leveldb", "Local Storage\\leveldb", "Login Data", "launcher_accounts", "launcher_profiles.json", "wallet.dat", "Exodus"],
    startup: ["Start Menu\\Programs\\Startup", "Start Menu/Programs/Startup", "CurrentVersion\\Run", "LaunchAgents", "systemd/user", "crontab", "schtasks"],
};

function has(buffer, needles) {
    return needles.some((needle) => buffer.includes(needle));
}

/*
 * What one class file does that matters here: [{ level: "danger" | "warning", text }].
 */
function scanClass(buffer) {
    const found = [];
    const bad = KNOWN_BAD.find((needle) => buffer.includes(needle));
    if (bad) found.push({ level: "danger", text: `Contains "${bad}", from known Minecraft malware (fractureiser).` });

    const sign = Object.fromEntries(Object.entries(SIGNS).map(([key, needles]) => [key, has(buffer, needles)]));
    if (sign.webhook && sign.secrets) found.push({ level: "danger", text: "Reads saved logins or tokens and sends them to a chat webhook." });
    else if (sign.secrets && sign.network) found.push({ level: "warning", text: "Reads browser or launcher login files and goes online." });

    const loadsRemote = sign.classLoader && sign.network;
    if (loadsRemote && (sign.bytesToString || sign.hidden) && sign.reflect) {
        found.push({ level: "warning", text: "Downloads code and runs it, with hidden text (how fractureiser started)." });
    } else if (loadsRemote) {
        found.push({ level: "warning", text: "Loads code from the internet." });
    }
    if (sign.run && sign.exec && sign.network) found.push({ level: "warning", text: "Runs programs and goes online." });
    if (sign.startup && (sign.run || sign.network)) found.push({ level: "warning", text: "Sets something to start with the computer." });
    if (sign.webhook && !sign.secrets) found.push({ level: "warning", text: "Sends to a Discord or Telegram webhook." });
    return found;
}

const MAX_JAR = 512 * 1024 * 1024;
const MAX_ENTRY = 64 * 1024 * 1024;

/*
 * The files in a zip held in memory: [{ name, data() }]. Read straight from the central
 * directory with zlib, which is many times faster than streaming each entry for the
 * thousands of small classes a mod has. Zip64 and encrypted entries are skipped.
 */
function zipEntries(buffer) {
    let end = -1;
    for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 22 - 65535); at--) {
        if (buffer.readUInt32LE(at) === 0x06054b50) {
            end = at;
            break;
        }
    }
    if (end < 0) throw new Error("Not a zip.");
    const count = buffer.readUInt16LE(end + 10);
    let at = buffer.readUInt32LE(end + 16);
    const entries = [];
    for (let i = 0; i < count && at + 46 <= buffer.length; i++) {
        if (buffer.readUInt32LE(at) !== 0x02014b50) break;
        const flags = buffer.readUInt16LE(at + 8);
        const method = buffer.readUInt16LE(at + 10);
        const compressed = buffer.readUInt32LE(at + 20);
        const size = buffer.readUInt32LE(at + 24);
        const nameLength = buffer.readUInt16LE(at + 28);
        const extraLength = buffer.readUInt16LE(at + 30);
        const commentLength = buffer.readUInt16LE(at + 32);
        const local = buffer.readUInt32LE(at + 42);
        const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
        at += 46 + nameLength + extraLength + commentLength;
        if (name.endsWith("/") || flags & 1 || size > MAX_ENTRY || local + 30 > buffer.length) continue;
        entries.push({
            name,
            size,
            data() {
                const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
                const raw = buffer.subarray(start, start + compressed);
                if (method === 0) return raw;
                if (method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: MAX_ENTRY });
                throw new Error("Unknown compression.");
            },
        });
    }
    return entries;
}

/*
 * Every finding in a jar and the jars it bundles (Fabric's META-INF/jars, Forge's jarjar),
 * with the class it came from.
 */
function scanEntries(buffer, where, found, depth) {
    for (const entry of zipEntries(buffer)) {
        const name = entry.name;
        if (name.endsWith(".class")) {
            let data;
            try {
                data = entry.data();
            } catch {
                continue;
            }
            for (const finding of scanClass(data)) found.push({ ...finding, where: where + name });
        } else if (depth < 2 && name.endsWith(".jar")) {
            if (depth === 0 && /(^|\/)libWebGL64\.jar$/.test(name)) found.push({ level: "danger", text: "Carries fractureiser's jar.", where: where + name });
            try {
                scanEntries(entry.data(), `${where}${name}!/`, found, depth + 1);
            } catch {
                // A bundled jar that won't open can't run either.
            }
        }
    }
}

async function scanJar(file) {
    const found = [];
    try {
        const { size } = await fsp.stat(file);
        if (size > MAX_JAR) return [{ level: "warning", text: "Too big to check.", where: "" }];
        scanEntries(await fsp.readFile(file), "", found, 0);
    } catch {
        return [{ level: "warning", text: "Couldn't be opened as a jar.", where: "" }];
    }
    const seen = new Set();
    return found.filter((finding) => {
        const key = finding.level + finding.text;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/* ---------------- this computer ---------------- */

function systemFiles(home = os.homedir(), env = process.env, platform = process.platform) {
    if (platform === "win32") {
        const local = env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
        const roaming = env.APPDATA ?? path.join(home, "AppData", "Roaming");
        return [
            path.join(local, "Microsoft Edge", "libWebGL64.jar"),
            path.join(roaming, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "run.bat"),
        ];
    }
    if (platform === "linux") {
        return [
            path.join(home, ".config", ".data", "lib.jar"),
            path.join(home, ".config", "systemd", "user", "systemd-utility.service"),
            "/etc/systemd/system/systemd-utility.service",
        ];
    }
    return [];
}

/*
 * fractureiser's leftovers on this computer. Windows' Startup run.bat is common, so it
 * only counts when it starts libWebGL64.
 */
function checkSystem(options = {}) {
    const found = [];
    for (const file of systemFiles(options.home, options.env, options.platform)) {
        if (!fs.existsSync(file)) continue;
        if (file.endsWith("run.bat")) {
            let text = "";
            try {
                text = fs.readFileSync(file, "utf8");
            } catch {
                // Unreadable: leave it.
            }
            if (!/libWebGL64|Microsoft Edge/i.test(text)) continue;
        }
        found.push({ level: "danger", text: "A file fractureiser leaves behind. Delete it and change your passwords from another device.", path: file });
    }
    return found;
}

/* ---------------- an instance ---------------- */

/*
 * { files: [{ name, type, enabled, source, level, findings }], system, counts, sitesChecked }
 * for an instance's mods. files limits it to those file names (say, just added).
 */
async function checkInstance(folder, { version, only } = {}) {
    const { identify } = require("./modUpdates.cjs");
    const { curseforgeFiles } = require("./packExports.cjs");
    const { pool } = require("./net.cjs");

    let items = (await identify(folder)).filter((item) => item.type === "mod");
    if (Array.isArray(only) && only.length) {
        const wanted = new Set(only.map((name) => String(name).replace(/\.disabled$/, "")));
        items = items.filter((item) => wanted.has(item.fileName ?? item.name));
    }
    for (const item of items) item.file = instanceMods.resolveItem(folder, item) + (item.enabled ? "" : ".disabled");
    items = items.filter((item) => item.file && fs.existsSync(item.file));

    let cfFound = new Map();
    let sitesChecked = true;
    const unknownToModrinth = items.filter((item) => !item.modrinthVersion);
    if (unknownToModrinth.length) {
        const result = await curseforgeFiles(unknownToModrinth, version).catch(() => ({ found: new Map(), printsWork: false }));
        cfFound = result.found;
        sitesChecked = result.printsWork;
    }

    const files = [];
    await pool(
        items,
        async (item) => {
            const source = item.modrinthVersion ? "modrinth" : cfFound.has(item.sha1) ? "curseforge" : "unknown";
            let findings = await scanJar(item.file);
            // A file a mod site hosts has been looked at; a lone warning there is most likely what the mod is for.
            if (source !== "unknown") findings = findings.map((finding) => (finding.level === "warning" ? { ...finding, level: "note" } : finding));
            const level = findings.some((f) => f.level === "danger") ? "danger" : findings.some((f) => f.level === "warning") ? "warning" : source === "unknown" ? "unknown" : "ok";
            files.push({ name: item.fileName ?? path.basename(item.file), title: item.title ?? item.name ?? null, type: item.type, enabled: item.enabled, source, level, findings });
        },
        { concurrency: 3 }
    );

    const order = { danger: 0, warning: 1, unknown: 2, ok: 3 };
    files.sort((a, b) => order[a.level] - order[b.level] || a.name.localeCompare(b.name));
    const system = checkSystem();
    const counts = { danger: 0, warning: 0, unknown: 0, ok: 0 };
    for (const file of files) counts[file.level] += 1;
    return { files, system, counts, sitesChecked, checkedAt: new Date().toISOString() };
}

module.exports = { checkInstance, checkSystem, scanClass, scanJar, systemFiles, zipEntries, KNOWN_BAD };
