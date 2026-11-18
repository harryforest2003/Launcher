const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");
const { Readable, Transform } = require("stream");
const { withZip } = require("./zipFile.cjs");
const nbt = require("./nbt.cjs");
const { curseforgeJson } = require("../curseforge.cjs");

/*
 * Adding worlds to an instance: from a .zip or a folder on this computer, from a download
 * link, or from CurseForge's Worlds section (the only map site with an API; Modrinth
 * doesn't host worlds). Every world is unpacked into a hidden folder in saves first and
 * renamed into place once it's complete, so a failed import never leaves half a world.
 */

const USER_AGENT = "UnityLauncher/1.0 (game mod manager)";

// Big adventure maps run to a few GB. Anything past this is a mistake or a zip bomb.
const MAX_WORLD_BYTES = 8 * 1024 ** 3;
const MAX_DOWNLOAD_BYTES = 4 * 1024 ** 3;
const IDLE_TIMEOUT_MS = 30 * 1000;
const PAGE_SIZE = 20;

// CurseForge's class for Minecraft worlds, and its categories within it.
const CF_WORLDS_CLASS = 17;
const CATEGORIES = [
    { id: 248, name: "Adventure" },
    { id: 249, name: "Creation" },
    { id: 250, name: "Game Map" },
    { id: 251, name: "Parkour" },
    { id: 252, name: "Puzzle" },
    { id: 253, name: "Survival" },
    { id: 4464, name: "Modded World" },
];
const SORTS = { popular: 2, downloads: 6, updated: 3, newest: 11 };

// CurseForge serves files from its own CDN; a world from it may only come from there.
const CURSEFORGE_HOSTS = /(^|\.)forgecdn\.net$/i;

const savesOf = (instance) => path.join(instance.gameDirectory ?? path.join(instance.folder, ".minecraft"), "saves");

/* ---------------- finding the worlds in a zip or folder ---------------- */

const posix = (p) => String(p).replace(/\\/g, "/").replace(/^\/+/, "");
const skipped = (p) => p.split("/").some((part) => part === "__MACOSX" || part === ".DS_Store");

/*
 * The folders, among these file paths, that hold a world: the ones with a level.dat.
 * "" is the top of the zip. A world inside another (a backup in a subfolder) stays part
 * of the outer one.
 */
function worldRoots(paths) {
    const roots = paths
        .map(posix)
        .filter((p) => !skipped(p) && (p === "level.dat" || p.endsWith("/level.dat")))
        .map((p) => p.slice(0, -"level.dat".length).replace(/\/$/, ""))
        .sort((a, b) => a.length - b.length);

    const kept = [];
    for (const root of roots) {
        if (!kept.some((outer) => outer === "" || root.startsWith(`${outer}/`))) kept.push(root);
    }
    return kept;
}

/* A folder name that works on every system: no path characters, nothing reserved. */
function safeName(text) {
    let name = String(text ?? "")
        .replace(/§./g, "")
        // A § saved in the wrong text encoding comes out as U+FFFD; drop it and its colour code too.
        .replace(/\uFFFD[0-9a-fk-or]?/g, "")
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[. ]+$/, "")
        .slice(0, 80)
        .trim();
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name = `${name} world`;
    if (!name || name.startsWith(".")) name = `World${name}`;
    return name;
}

/* The name, or "name (2)" and so on if it's taken. */
function freeFolder(saves, name) {
    let candidate = name;
    for (let n = 2; fs.existsSync(path.join(saves, candidate)); n++) candidate = `${name} (${n})`;
    return path.join(saves, candidate);
}

/* Release numbers compared: 1 if a is newer, -1 if older, 0 if equal or not comparable. */
function compareVersions(a, b) {
    const parse = (v) => (/^\d+(\.\d+)*$/.test(String(v ?? "")) ? String(v).split(".").map(Number) : null);
    const x = parse(a);
    const y = parse(b);
    if (!x || !y) return 0;
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] ?? 0) - (y[i] ?? 0);
        if (d) return Math.sign(d);
    }
    return 0;
}

/* What the launcher says about a world just added. */
function describe(dir, instanceVersion) {
    let data = {};
    try {
        data = nbt.parse(fs.readFileSync(path.join(dir, "level.dat"))).Data ?? {};
    } catch {
        // A damaged level.dat: it's still a world, named by its folder.
    }
    const version = data.Version?.Name ?? null;
    return {
        folder: path.basename(dir),
        name: typeof data.LevelName === "string" && data.LevelName.trim() ? data.LevelName.replace(/§./g, "") : path.basename(dir),
        version,
        newer: compareVersions(version, instanceVersion) > 0,
    };
}

/* A hidden folder in saves to build a world in, removed if anything goes wrong. */
async function intoPlace(saves, name, build) {
    fs.mkdirSync(saves, { recursive: true });
    const temp = path.join(saves, `.importing-${crypto.randomBytes(6).toString("hex")}`);
    fs.mkdirSync(temp);
    try {
        await build(temp);
        const final = freeFolder(saves, safeName(name));
        fs.renameSync(temp, final);
        return final;
    } catch (err) {
        fs.rmSync(temp, { recursive: true, force: true });
        throw err;
    }
}

function refuseOtherFormats(file) {
    if (/\.mcworld$/i.test(file)) {
        throw new Error("That's a Bedrock Edition world (.mcworld). Java Edition, which these instances run, can't open it.");
    }
    if (/\.(rar|7z|tar|gz|tgz)$/i.test(file)) {
        throw new Error("Only .zip files can be imported. Unpack it first, then import the world's folder.");
    }
}

/* ---------------- importing ---------------- */

/*
 * Every world in a .zip, each into its own folder in saves. label names a world that sits
 * at the top of the zip (the zip's own name, or the CurseForge project's).
 */
async function importZip(instance, zipPath, { label, onProgress } = {}) {
    refuseOtherFormats(zipPath);
    const saves = savesOf(instance);

    return withZip(zipPath, async (directory) => {
        const files = directory.files.filter((entry) => entry.type === "File");
        const roots = worldRoots(files.map((entry) => entry.path));
        if (!roots.length) {
            throw new Error("There's no Minecraft world in that zip: no folder in it has a level.dat file.");
        }

        const inRoot = (root) => files.filter((entry) => {
            const p = posix(entry.path);
            return !skipped(p) && (root === "" || p.startsWith(`${root}/`));
        });

        const total = roots.reduce((sum, root) => sum + inRoot(root).reduce((n, entry) => n + (entry.uncompressedSize || 0), 0), 0);
        if (total > MAX_WORLD_BYTES) throw new Error("That zip unpacks to more than 8 GB, far bigger than any world, so it wasn't imported.");

        let written = 0;
        const added = [];

        for (const root of roots) {
            const name = root ? root.split("/").pop() : label ?? path.basename(zipPath).replace(/\.zip$/i, "");

            const dir = await intoPlace(saves, name, async (temp) => {
                const base = path.resolve(temp);
                for (const entry of inRoot(root)) {
                    const relative = root ? posix(entry.path).slice(root.length + 1) : posix(entry.path);
                    const target = path.resolve(base, relative);
                    // Never let a crafted zip write outside the world's folder.
                    if (!relative || !target.startsWith(base + path.sep)) continue;

                    fs.mkdirSync(path.dirname(target), { recursive: true });
                    const counter = new Transform({
                        transform(chunk, _enc, done) {
                            written += chunk.length;
                            if (written > MAX_WORLD_BYTES) return done(new Error("That zip unpacks to more than 8 GB, so it wasn't imported."));
                            onProgress?.(total ? written / total : null, "Unpacking");
                            done(null, chunk);
                        },
                    });
                    await pipeline(entry.stream(), counter, fs.createWriteStream(target));
                }
            });

            added.push(describe(dir, instance.version));
        }

        return added;
    });
}

/* The world folders in a folder: the folder itself, or worlds up to two levels inside it (a saves folder). */
function worldsInFolder(dir, depth = 2) {
    if (fs.existsSync(path.join(dir, "level.dat"))) return [dir];
    if (!depth) return [];
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "__MACOSX")
        .flatMap((entry) => worldsInFolder(path.join(dir, entry.name), depth - 1));
}

/* A world folder, or a folder of worlds, copied in. The originals are left as they are. */
async function importFolder(instance, dir, { onProgress } = {}) {
    const saves = path.resolve(savesOf(instance));
    const source = path.resolve(dir);
    if (source === saves || source.startsWith(saves + path.sep)) throw new Error("That world is already in this instance.");

    const found = worldsInFolder(source);
    if (!found.length) throw new Error("There's no Minecraft world in that folder: it has no level.dat file, nor do the folders in it.");

    const added = [];
    for (const [index, world] of found.entries()) {
        onProgress?.(index / found.length, "Copying");
        const dirOut = await intoPlace(saves, path.basename(world), (temp) =>
            fsp.cp(world, temp, {
                recursive: true,
                // The lock belongs to whichever game had it open.
                filter: (src) => path.basename(src) !== "session.lock",
            })
        );
        added.push(describe(dirOut, instance.version));
    }
    onProgress?.(1, "Copying");
    return added;
}

/* ---------------- downloading ---------------- */

/*
 * A file from the web into a new temporary folder, streamed (worlds are big), checked
 * against its SHA-1 when there is one. Resolves with { file, tempDir }.
 */
async function download(url, { fileName, sha1, hosts, onProgress } = {}) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error("That isn't a web address.");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Only https:// download links can be used.");
    if (hosts && !hosts.test(parsed.hostname)) throw new Error("That download isn't from CurseForge's own file server, so it wasn't used.");

    const controller = new AbortController();
    let timer;
    const alive = () => {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(new Error("The download stopped sending anything for 30 seconds.")), IDLE_TIMEOUT_MS);
    };
    alive();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "unity-world-"));
    try {
        const res = await fetch(parsed, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: controller.signal });
        if (!res.ok) throw new Error(`The download failed (HTTP ${res.status}).`);
        if (hosts && !hosts.test(new URL(res.url).hostname)) throw new Error("That download was sent on to another site, so it wasn't used.");
        if (/text\/html/i.test(res.headers.get("content-type") ?? "")) {
            throw new Error("That link opens a web page, not a file. Use the page's own download button, then Import a file.");
        }

        const size = Number(res.headers.get("content-length")) || 0;
        if (size > MAX_DOWNLOAD_BYTES) throw new Error("That file is more than 4 GB, so it wasn't downloaded.");

        const name = path.basename(String(fileName || decodeURIComponent(parsed.pathname.split("/").pop() || "") || "world.zip")) || "world.zip";
        const file = path.join(tempDir, /\.zip$/i.test(name) ? name : `${name}.zip`);
        const hash = crypto.createHash("sha1");
        let got = 0;

        await pipeline(
            Readable.fromWeb(res.body),
            new Transform({
                transform(chunk, _enc, done) {
                    alive();
                    got += chunk.length;
                    if (got > MAX_DOWNLOAD_BYTES) return done(new Error("That file is more than 4 GB, so it wasn't downloaded."));
                    hash.update(chunk);
                    onProgress?.(size ? got / size : null, "Downloading");
                    done(null, chunk);
                },
            }),
            fs.createWriteStream(file)
        );

        if (sha1 && hash.digest("hex") !== String(sha1).toLowerCase()) throw new Error("The download came out damaged (its checksum doesn't match). Try again.");

        const head = Buffer.alloc(4);
        const handle = await fsp.open(file, "r");
        await handle.read(head, 0, 4, 0).finally(() => handle.close());
        if (head.toString("latin1") !== "PK\x03\x04") {
            throw new Error("That link didn't give a .zip file. If it's a page, use its download button, then Import a file.");
        }

        return { file, tempDir };
    } catch (err) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        throw err.name === "AbortError" && controller.signal.reason instanceof Error ? controller.signal.reason : err;
    } finally {
        clearTimeout(timer);
    }
}

/* Links people share for files, turned into the file itself where the site allows it. */
function directLink(url) {
    try {
        const parsed = new URL(String(url).trim());
        if (/(^|\.)dropbox\.com$/i.test(parsed.hostname)) {
            parsed.searchParams.set("dl", "1");
            return parsed.toString();
        }
        return parsed.toString();
    } catch {
        return String(url).trim();
    }
}

async function importLink(instance, url, { onProgress } = {}) {
    const link = directLink(url);
    refuseOtherFormats(new URL(link, "https://x").pathname);
    const { file, tempDir } = await download(link, { onProgress });
    try {
        return await importZip(instance, file, { onProgress });
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

/* ---------------- CurseForge ---------------- */

const versionsOf = (files = []) =>
    [...new Set(files.flatMap((f) => f.gameVersions ?? []).filter((v) => /^\d+(\.\d+)+$/.test(v)))].sort((a, b) => compareVersions(b, a));

function card(mod) {
    return {
        id: String(mod.id),
        name: mod.name,
        summary: mod.summary ?? "",
        author: mod.authors?.[0]?.name ?? null,
        downloads: mod.downloadCount ?? 0,
        updated: mod.dateModified ?? null,
        icon: mod.logo?.thumbnailUrl ?? mod.logo?.url ?? null,
        url: mod.links?.websiteUrl ?? null,
        categories: (mod.categories ?? []).map((c) => c.name),
        versions: versionsOf(mod.latestFiles),
        installable: mod.allowModDistribution !== false,
    };
}

/* A page of CurseForge's worlds. mcVersion, when given, keeps to worlds made for it. */
async function search({ query = "", mcVersion = null, category = null, sort = "popular", page = 0 } = {}) {
    const index = Math.max(0, Math.floor(page)) * PAGE_SIZE;
    const params = new URLSearchParams({
        gameId: "432",
        classId: String(CF_WORLDS_CLASS),
        index: String(index),
        pageSize: String(PAGE_SIZE),
        sortField: String(SORTS[sort] ?? SORTS.popular),
        sortOrder: "desc",
    });
    if (String(query).trim()) params.set("searchFilter", String(query).trim());
    if (mcVersion) params.set("gameVersion", mcVersion);
    if (CATEGORIES.some((c) => c.id === Number(category))) params.set("categoryId", String(category));

    const data = await curseforgeJson(`/mods/search?${params}`);
    // CurseForge pages no further than its 10,000th result.
    const total = Math.min(data.pagination?.totalCount ?? 0, 10000);
    return { results: (data.data ?? []).map(card), total, page: Math.floor(index / PAGE_SIZE), pageSize: PAGE_SIZE };
}

/* The file to download for this instance: one made for its version if there is one, else the newest. */
async function pickFile(projectId, mcVersion) {
    const list = async (params) =>
        ((await curseforgeJson(`/mods/${projectId}/files?${new URLSearchParams({ pageSize: "50", ...params })}`)).data ?? [])
            .filter((f) => f.isAvailable !== false && !f.isServerPack)
            .sort((a, b) => String(b.fileDate).localeCompare(String(a.fileDate)));

    let files = mcVersion ? await list({ gameVersion: mcVersion }) : [];
    const exact = files.length > 0;
    if (!exact) files = await list({});
    if (!files.length) throw new Error("That world has no files to download.");
    // releaseType 1 is a full release; betas and alphas only if there's nothing else.
    return { file: files.find((f) => f.releaseType === 1) ?? files[0], exact };
}

async function installCurseForge(instance, projectId, { onProgress } = {}) {
    if (!/^\d+$/.test(String(projectId))) throw new Error("Unknown CurseForge project.");
    const project = (await curseforgeJson(`/mods/${projectId}`)).data ?? {};
    if (project.classId !== CF_WORLDS_CLASS) throw new Error("That CurseForge project isn't a world.");

    const { file, exact } = await pickFile(projectId, instance.version);
    if (!file.downloadUrl) {
        const err = new Error("This world's author only allows downloads from CurseForge's own site. Download it there, then use Import a file.");
        err.code = "DISTRIBUTION_DENIED";
        throw err;
    }
    if (!/\.zip$/i.test(file.fileName ?? "")) throw new Error(`"${file.fileName}" isn't a .zip, so it can't be added as a world.`);

    const { file: zip, tempDir } = await download(file.downloadUrl, {
        fileName: file.fileName,
        sha1: file.hashes?.find((h) => h.algo === 1)?.value,
        hosts: CURSEFORGE_HOSTS,
        onProgress,
    });
    try {
        const added = await importZip(instance, zip, { label: project.name, onProgress });
        // Made for a different version: say so, whatever its level.dat says.
        const made = versionsOf([file]);
        return added.map((world) => ({ ...world, madeFor: exact ? null : made[0] ?? null }));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

module.exports = {
    CATEGORIES,
    worldRoots,
    safeName,
    compareVersions,
    worldsInFolder,
    importZip,
    importFolder,
    importLink,
    directLink,
    search,
    installCurseForge,
};
