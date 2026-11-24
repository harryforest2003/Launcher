const fs = require("fs");
const os = require("os");
const path = require("path");
const yazl = require("yazl");
const instanceMods = require("./instanceMods.cjs");
const { identify } = require("./modUpdates.cjs");
const { modInfo } = require("./modInfo.cjs");
const { installerUrl } = require("./loaders.cjs");
const { requiredJava } = require("./javaRuntime.cjs");
const { downloadFile, fetchJson } = require("./net.cjs");
const { curseforgeFetch } = require("../curseforge.cjs");
const { writeZip, walk, toZipPath, CONFIG_FOLDERS, FOLDERS } = require("./modpackExport.cjs");

/*
 * Two more ways out for an instance, beside the .mrpack:
 *  - A CurseForge modpack (.zip), for the CurseForge app. Files CurseForge has are listed
 *    by their project and file IDs; anything else goes inside, with the config.
 *  - A server pack (.zip): the mods a server runs (client-only ones left out), the
 *    config, the loader's server installer, and start scripts.
 */

const MINECRAFT = 432; // CurseForge's ID for Minecraft.
const WHITESPACE = new Set([9, 10, 13, 32]);

/*
 * CurseForge's fingerprint of a file: 32-bit MurmurHash2, seed 1, over the bytes left
 * after taking out tabs, line breaks and spaces.
 */
function curseforgeFingerprint(buffer) {
    const bytes = Buffer.alloc(buffer.length);
    let length = 0;
    for (const byte of buffer) if (!WHITESPACE.has(byte)) bytes[length++] = byte;

    const m = 0x5bd1e995;
    let h = (1 ^ length) >>> 0;
    let i = 0;
    let left = length;
    while (left >= 4) {
        let k = bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);
        k = Math.imul(k, m);
        k ^= k >>> 24;
        k = Math.imul(k, m);
        h = Math.imul(h, m) ^ k;
        i += 4;
        left -= 4;
    }
    if (left === 3) h ^= bytes[i + 2] << 16;
    if (left >= 2) h ^= bytes[i + 1] << 8;
    if (left >= 1) {
        h ^= bytes[i];
        h = Math.imul(h, m);
    }
    h ^= h >>> 13;
    h = Math.imul(h, m);
    h ^= h >>> 15;
    return h >>> 0;
}

const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

async function curseforgePost(route, body) {
    const res = await curseforgeFetch(route, { method: "POST", body });
    if (!res.ok) throw new Error(`CurseForge HTTP ${res.status}`);
    return (await res.json())?.data;
}

/*
 * Which of these files CurseForge has: sha1 -> { projectID, fileID }. By fingerprint
 * first; files installed from CurseForge are also matched in their project's file list,
 * for while the fingerprint lookup isn't there. Anything CurseForge can't say is left out.
 */
async function curseforgeFiles(items, mcVersion) {
    const found = new Map();
    const byPrint = new Map();
    for (const item of items) {
        try {
            byPrint.set(curseforgeFingerprint(fs.readFileSync(item.file)), item);
        } catch {
            // Unreadable: it goes inside the pack instead.
        }
    }

    let printsWork = true;
    for (const chunk of chunks([...byPrint.keys()], 50)) {
        try {
            const data = await curseforgePost(`/fingerprints/${MINECRAFT}`, { fingerprints: chunk });
            for (const match of data?.exactMatches ?? []) {
                const item = byPrint.get(match.file?.fileFingerprint);
                if (item && match.file?.id && match.file?.modId) found.set(item.sha1, { projectID: match.file.modId, fileID: match.file.id });
            }
        } catch {
            printsWork = false;
            break;
        }
    }

    for (const item of items) {
        if (found.has(item.sha1) || item.source !== "curseforge" || !/^\d+$/.test(String(item.projectId ?? ""))) continue;
        try {
            const res = await curseforgeFetch(`/mods/${item.projectId}/files?gameVersion=${encodeURIComponent(mcVersion)}&pageSize=50`);
            const files = res.ok ? (await res.json())?.data ?? [] : [];
            const file = files.find((f) => f.hashes?.some((hash) => hash.algo === 1 && hash.value === item.sha1));
            if (file) found.set(item.sha1, { projectID: Number(item.projectId), fileID: file.id });
        } catch {
            // Not found this way either.
        }
    }
    return { found, printsWork };
}

/* The names and pages of these CurseForge projects, for modlist.html. */
async function curseforgeNames(ids) {
    const out = new Map();
    for (const chunk of chunks(ids, 50)) {
        const data = await curseforgePost("/mods", { modIds: chunk }).catch(() => []);
        for (const mod of data ?? []) out.set(mod.id, { name: mod.name, url: mod.links?.websiteUrl, author: mod.authors?.[0]?.name });
    }
    return out;
}

const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// CurseForge names a loader with its version: "forge-47.3.0", "fabric-0.16.9".
function curseforgeLoader(instance) {
    const loader = String(instance.loader || "vanilla").toLowerCase();
    if (loader === "vanilla" || !instance.loaderVersion) return [];
    const version = String(instance.loaderVersion).replace(new RegExp(`^${instance.version.replace(/\./g, "\\.")}-`), "");
    return [{ id: `${loader}-${version}`, primary: true }];
}

/* The instance's enabled mods, resource packs and shaders, with their files. */
async function contentFiles(folder) {
    const items = (await identify(folder)).filter((item) => item.enabled);
    for (const item of items) item.file = instanceMods.resolveItem(folder, item);
    return items.filter((item) => item.file && fs.existsSync(item.file));
}

function addConfig(zip, gameDir, prefix, included, extra = []) {
    for (const dirName of CONFIG_FOLDERS.concat(extra)) {
        const dir = path.join(gameDir, dirName);
        if (!fs.existsSync(dir)) continue;
        for (const rel of walk(dir)) {
            if (/(^|[/\\])(session\.lock|\.DS_Store)$/.test(rel)) continue;
            zip.addFile(path.join(dir, rel), `${prefix}${dirName}/${toZipPath(rel)}`);
            included.push(`${dirName}/${toZipPath(rel)}`);
        }
    }
}

/*
 * { name, version, worlds, options } -> writes a CurseForge modpack zip to target.
 */
async function exportCurseForge(instance, folder, target, { name, version = "1.0.0", worlds = false, options = false } = {}) {
    const gameDir = instance.gameDirectory ?? path.join(folder, ".minecraft");
    const items = await contentFiles(folder);
    const { found, printsWork } = await curseforgeFiles(items, instance.version);

    const zip = new yazl.ZipFile();
    const files = [];
    const inside = [];
    for (const item of items) {
        const ids = found.get(item.sha1);
        if (ids) files.push({ ...ids, required: true });
        else {
            zip.addFile(item.file, `overrides/${FOLDERS[item.type]}/${item.fileName}`);
            inside.push(`${FOLDERS[item.type]}/${item.fileName}`);
        }
    }

    const config = [];
    addConfig(zip, gameDir, "overrides/", config, worlds ? ["saves"] : []);
    if (options && fs.existsSync(path.join(gameDir, "options.txt"))) {
        zip.addFile(path.join(gameDir, "options.txt"), "overrides/options.txt");
        config.push("options.txt");
    }

    const manifest = {
        minecraft: { version: instance.version, modLoaders: curseforgeLoader(instance) },
        manifestType: "minecraftModpack",
        manifestVersion: 1,
        name: String(name || instance.name),
        version: String(version),
        author: "",
        files,
        overrides: "overrides",
    };
    zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), "manifest.json");

    const names = await curseforgeNames([...new Set(files.map((f) => f.projectID))]);
    const list = files
        .map((f) => names.get(f.projectID) ?? { name: `Project ${f.projectID}`, url: `https://www.curseforge.com/projects/${f.projectID}` })
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((mod) => `<li><a href="${escapeHtml(mod.url ?? "")}">${escapeHtml(mod.name)}${mod.author ? ` (by ${escapeHtml(mod.author)})` : ""}</a></li>`);
    zip.addBuffer(Buffer.from(`<ul>\n${list.join("\n")}\n</ul>\n`), "modlist.html");

    await writeZip(zip, target);
    return {
        file: target,
        bytes: fs.statSync(target).size,
        linked: files.length,
        included: inside,
        configFiles: config.length,
        // CurseForge's file lookup goes through the launcher's proxy; without it, only
        // files installed from CurseForge could be matched.
        partial: !printsWork,
    };
}

/* ---------------- server pack ---------------- */

const FABRIC_META = "https://meta.fabricmc.net/v2";
const QUILT_INSTALLER = "https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer";

/* Modrinth's word on whether each of these projects runs on a server: id -> server_side. */
async function serverSides(ids) {
    const out = new Map();
    for (const chunk of chunks(ids, 80)) {
        const projects = await fetchJson(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`).catch(() => []);
        for (const project of projects ?? []) out.set(project.id, project.server_side);
    }
    return out;
}

async function latestQuiltInstaller() {
    const res = await fetch(`${QUILT_INSTALLER}/maven-metadata.xml`, { signal: AbortSignal.timeout(30 * 1000), headers: { "User-Agent": "UnityLauncher/1.0" } });
    const version = res.ok ? /<release>([^<]+)<\/release>/.exec(await res.text())?.[1] : null;
    if (!version || !/^[\w.+-]{1,40}$/.test(version)) throw new Error("Quilt's installer couldn't be found.");
    return `${QUILT_INSTALLER}/${version}/quilt-installer-${version}.jar`;
}

/* The loader's server file for the pack, downloaded to dir: { file, zipName }. */
async function loaderServerFile(instance, dir) {
    const loader = String(instance.loader).toLowerCase();
    if (loader === "fabric") {
        const installers = await fetchJson(`${FABRIC_META}/versions/installer`);
        const installer = (installers ?? []).find((entry) => entry.stable) ?? installers?.[0];
        if (!installer?.version) throw new Error("Fabric's server launcher couldn't be found.");
        const url = `${FABRIC_META}/versions/loader/${encodeURIComponent(instance.version)}/${encodeURIComponent(instance.loaderVersion)}/${encodeURIComponent(installer.version)}/server/jar`;
        const file = path.join(dir, "fabric-server-launch.jar");
        await downloadFile(url, file);
        return { file, zipName: "fabric-server-launch.jar" };
    }
    const url = loader === "quilt" ? await latestQuiltInstaller() : installerUrl(loader, instance.loaderVersion);
    const file = path.join(dir, "loader-installer.jar");
    await downloadFile(url, file);
    return { file, zipName: "loader-installer.jar" };
}

function startScripts(instance, ram) {
    const loader = String(instance.loader).toLowerCase();
    const memory = `-Xmx${ram}G`;
    const sh = ["#!/bin/sh", "# Starts the server. The first start downloads Minecraft's own server files.", 'cd "$(dirname "$0")" || exit 1'];
    const bat = ["@echo off", "rem Starts the server. The first start downloads Minecraft's own server files.", 'cd /d "%~dp0"'];

    if (loader === "fabric") {
        sh.push(`java ${memory} -jar fabric-server-launch.jar nogui`);
        bat.push(`java ${memory} -jar fabric-server-launch.jar nogui`);
    } else if (loader === "quilt") {
        const install = `java -jar loader-installer.jar install server ${instance.version} ${instance.loaderVersion} --download-server --install-dir=.`;
        sh.push(`if [ ! -f quilt-server-launch.jar ]; then`, `  ${install} || exit 1`, "fi", `java ${memory} -jar quilt-server-launch.jar nogui`);
        bat.push(`if not exist quilt-server-launch.jar ${install}`, `java ${memory} -jar quilt-server-launch.jar nogui`);
    } else {
        // Forge and NeoForge: the installer sets the server up once. Newer versions make
        // run.sh/run.bat, which read the memory from user_jvm_args.txt; older ones a jar.
        sh.push(
            "if [ ! -f run.sh ] && ! ls forge-*.jar >/dev/null 2>&1; then",
            "  java -jar loader-installer.jar --installServer || exit 1",
            "fi",
            "if [ -f run.sh ]; then",
            `  grep -q '^-Xmx' user_jvm_args.txt 2>/dev/null || echo "${memory}" >> user_jvm_args.txt`,
            "  sh run.sh nogui",
            "else",
            `  java ${memory} -jar "$(ls forge-*.jar | head -n 1)" nogui`,
            "fi"
        );
        bat.push(
            "if not exist run.bat if not exist forge-*.jar java -jar loader-installer.jar --installServer",
            "if exist run.bat (",
            `  findstr /b /c:"-Xmx" user_jvm_args.txt >nul 2>&1 || echo ${memory}>> user_jvm_args.txt`,
            "  call run.bat nogui",
            ") else (",
            `  for %%f in (forge-*.jar) do java ${memory} -jar "%%f" nogui`,
            ")"
        );
    }
    bat.push("pause");
    return { sh: sh.join("\n") + "\n", bat: bat.join("\r\n") + "\r\n" };
}

/*
 * Writes a server pack zip to target: { file, bytes, mods, skipped, configFiles }.
 */
async function exportServerPack(instance, folder, target) {
    const loader = String(instance.loader || "vanilla").toLowerCase();
    if (loader === "vanilla") throw new Error("A vanilla instance needs no server pack: Minecraft's own server runs it.");
    if (!instance.loaderVersion) throw new Error("This instance's loader version isn't known, so its server can't be set up.");

    const gameDir = instance.gameDirectory ?? path.join(folder, ".minecraft");
    const mods = (await contentFiles(folder)).filter((item) => item.type === "mod");
    const sides = await serverSides([...new Set(mods.filter((item) => item.source === "modrinth" && item.projectId).map((item) => item.projectId))]);

    const zip = new yazl.ZipFile();
    const kept = [];
    const skipped = [];
    for (const item of mods) {
        const info = await modInfo(item.file);
        const clientOnly = info?.environment === "client" || (item.source === "modrinth" && sides.get(item.projectId) === "unsupported");
        if (clientOnly) skipped.push(item.name || item.fileName);
        else {
            zip.addFile(item.file, `mods/${item.fileName}`);
            kept.push(item.fileName);
        }
    }

    const config = [];
    addConfig(zip, gameDir, "", config);

    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "unity-serverpack-"));
    try {
        const server = await loaderServerFile(instance, temp);
        zip.addFile(server.file, server.zipName);

        const ram = Math.max(1, Math.round(Number(instance.ram) || 4));
        const scripts = startScripts(instance, ram);
        zip.addBuffer(Buffer.from(scripts.sh), "start.sh", { mode: 0o100755 });
        zip.addBuffer(Buffer.from(scripts.bat), "start.bat");

        const java = requiredJava(folder, instance).majorVersion;
        const readme = [
            `${instance.name}: server pack`,
            "",
            `Minecraft ${instance.version}, ${loader} ${instance.loaderVersion}. Needs Java ${java} or newer.`,
            "",
            "To start it, run start.sh (macOS or Linux) or start.bat (Windows). The first start downloads",
            "Minecraft's own server files, then stops to ask you to accept Minecraft's EULA",
            "(https://aka.ms/MinecraftEULA): open eula.txt, change eula=false to eula=true if you",
            "accept it, and start the server again.",
            "",
            `Memory: ${ram} GB. Change -Xmx${ram}G in the start scripts${loader === "forge" || loader === "neoforge" ? " (or in user_jvm_args.txt, once made)" : ""}.`,
            "",
            skipped.length ? `Left out, as they only run in the game itself:\n${skipped.map((name) => `  - ${name}`).join("\n")}` : "Every mod is in.",
            "",
        ].join("\n");
        zip.addBuffer(Buffer.from(readme), "README.txt");

        await writeZip(zip, target);
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }

    return { file: target, bytes: fs.statSync(target).size, mods: kept.length, skipped, configFiles: config.length };
}

module.exports = { exportCurseForge, exportServerPack, curseforgeFingerprint, curseforgeFiles, curseforgePost, contentFiles, chunks };
