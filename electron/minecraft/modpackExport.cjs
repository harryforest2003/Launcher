const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const yazl = require("yazl");
const { getSecret } = require("../secrets.cjs");
const { identify } = require("./modUpdates.cjs");

/*
 * Saves an instance as a Modrinth modpack (.mrpack), which the Modrinth App, Prism and
 * this launcher can all import. Files on Modrinth are listed by their download link and
 * hashes, so the pack stays small; anything else (CurseForge-only or added by hand)
 * goes inside it, with the instance's config. Worlds and game settings only if asked.
 */

const USER_AGENT = "UnityLauncher/1.0 (+https://github.com/harryforest2003/Launcher)";
const FOLDERS = { mod: "mods", resourcepack: "resourcepacks", shader: "shaderpacks" };
const LOADER_KEYS = { fabric: "fabric-loader", quilt: "quilt-loader", forge: "forge", neoforge: "neoforge" };
// Folders of the game's own that belong with a modpack's settings.
const CONFIG_FOLDERS = ["config", "defaultconfigs", "kubejs", "global_packs"];

async function versionFiles(sha1s) {
    if (!sha1s.length) return {};
    const send = (token) =>
        fetch("https://api.modrinth.com/v2/version_files", {
            method: "POST",
            headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
            body: JSON.stringify({ hashes: sha1s, algorithm: "sha1" }),
            signal: AbortSignal.timeout(60 * 1000),
        });
    const token = getSecret("modrinth");
    let res = await send(token);
    if (res.status === 401 && token) res = await send(null);
    if (!res.ok) throw new Error(`Modrinth didn't answer (HTTP ${res.status}), so the pack couldn't be made.`);
    return res.json();
}

function walk(dir, base = dir) {
    let out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out = out.concat(walk(full, base));
        else if (entry.isFile()) out.push(path.relative(base, full));
    }
    return out;
}

const toZipPath = (rel) => rel.split(path.sep).join("/");

/* Writes a yazl zip beside the target first, so a failed export leaves no half-file. */
async function writeZip(zip, target) {
    const partial = `${target}.partial-${crypto.randomUUID().slice(0, 8)}`;
    try {
        await new Promise((resolve, reject) => {
            const out = fs.createWriteStream(partial);
            out.on("close", resolve);
            out.on("error", reject);
            zip.outputStream.on("error", reject).pipe(out);
            zip.end();
        });
        fs.renameSync(partial, target);
    } catch (err) {
        fs.rmSync(partial, { force: true });
        throw err;
    }
}

/*
 * { name, version, worlds, options } -> writes target, and says what went in.
 */
async function exportModpack(instance, folder, target, { name, version = "1.0.0", worlds = false, options = false } = {}) {
    const gameDir = instance.gameDirectory ?? path.join(folder, ".minecraft");
    const items = (await identify(folder)).filter((item) => item.enabled);
    const found = await versionFiles(items.map((item) => item.sha1));

    const zip = new yazl.ZipFile();
    const files = [];
    const included = [];

    for (const item of items) {
        const rel = `${FOLDERS[item.type]}/${item.fileName}`;
        const file = found[item.sha1]?.files?.find((f) => f.hashes?.sha1 === item.sha1);
        if (file) {
            files.push({
                path: rel,
                hashes: { sha1: file.hashes.sha1, sha512: file.hashes.sha512 },
                env: { client: "required", server: item.type === "mod" ? "required" : "unsupported" },
                downloads: [file.url],
                fileSize: file.size,
            });
        } else {
            zip.addFile(path.join(gameDir, FOLDERS[item.type], item.fileName), `overrides/${rel}`);
            included.push(rel);
        }
    }

    // The instance's mod settings, and worlds or game settings if asked for.
    const extras = CONFIG_FOLDERS.concat(worlds ? ["saves"] : []);
    for (const dirName of extras) {
        const dir = path.join(gameDir, dirName);
        if (!fs.existsSync(dir)) continue;
        for (const rel of walk(dir)) {
            if (/(^|[/\\])(session\.lock|\.DS_Store)$/.test(rel)) continue;
            zip.addFile(path.join(dir, rel), `overrides/${dirName}/${toZipPath(rel)}`);
            included.push(`${dirName}/${toZipPath(rel)}`);
        }
    }
    if (options && fs.existsSync(path.join(gameDir, "options.txt"))) {
        zip.addFile(path.join(gameDir, "options.txt"), "overrides/options.txt");
        included.push("options.txt");
    }

    const loader = String(instance.loader || "vanilla").toLowerCase();
    const dependencies = { minecraft: instance.version };
    if (LOADER_KEYS[loader]) dependencies[LOADER_KEYS[loader]] = instance.loaderVersion;

    const index = {
        formatVersion: 1,
        game: "minecraft",
        versionId: String(version),
        name: String(name || instance.name),
        summary: `Exported from Unity Launcher: Minecraft ${instance.version}${LOADER_KEYS[loader] ? `, ${loader} ${instance.loaderVersion}` : ""}.`,
        files,
        dependencies,
    };
    zip.addBuffer(Buffer.from(JSON.stringify(index, null, 2)), "modrinth.index.json");

    await writeZip(zip, target);

    return {
        file: target,
        bytes: fs.statSync(target).size,
        linked: files.length,
        included: included.filter((rel) => /^(mods|resourcepacks|shaderpacks)\//.test(rel)),
        configFiles: included.filter((rel) => !/^(mods|resourcepacks|shaderpacks)\//.test(rel)).length,
    };
}

module.exports = { exportModpack, writeZip, walk, toZipPath, CONFIG_FOLDERS, FOLDERS, LOADER_KEYS };
