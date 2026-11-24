const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");
const unzipper = require("unzipper");

const { downloadFile, fetchJson, pool } = require("./net.cjs");
const { curseforgeFetch } = require("../curseforge.cjs");

/*
 * Modpacks from the launchers that host their own: Feed The Beast, Technic and ATLauncher.
 * Each is listed, its versions shown, and one installed as a new instance like a Modrinth
 * or CurseForge pack: the Minecraft version and loader it names, its files, its configs.
 *
 *   FTB         api.feed-the-beast.com: a version lists every file with a URL and a SHA-1.
 *   Technic     api.technicpack.net, then the pack's Solder: each build is a list of zips
 *               laid over the game folder; bin/modpack.jar names the Forge it runs on.
 *   ATLauncher  api.atlauncher.com for the list, Configs.json for a version's mods and loader.
 */

const PLATFORMS = ["ftb", "technic", "atlauncher"];
const NAMES = { ftb: "Feed The Beast", technic: "Technic", atlauncher: "ATLauncher" };
const PAGE = 20;

const FTB = "https://api.feed-the-beast.com/v1/modpacks/public/modpack";
const TECHNIC = "https://api.technicpack.net";
const ATL_API = "https://api.atlauncher.com/v1";
const ATL_CDN = "https://download.nodecdn.net/containers/atl/";

function checkPlatform(value) {
    if (!PLATFORMS.includes(value)) throw new Error("That isn't a modpack site the launcher knows.");
    return value;
}

// Ids and versions as the sites write them: never a path or a URL.
function checkId(value, what = "modpack") {
    const text = String(value ?? "");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.+-]{0,99}$/.test(text)) throw new Error(`That isn't a ${what} id.`);
    return text;
}

/* ---------------- small helpers ---------------- */

const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;

async function cached(key, load) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = await load();
    cache.set(key, { at: Date.now(), value });
    return value;
}

const iso = (seconds) => (Number(seconds) > 0 ? new Date(Number(seconds) * 1000).toISOString() : undefined);
const gb = (mb) => (Number(mb) > 0 ? Math.min(32, Math.max(2, Math.round(Number(mb) / 1024))) : undefined);

function pageOf(list, page, size = PAGE) {
    const pageCount = Math.max(1, Math.ceil(list.length / size));
    const current = Math.min(Math.max(1, Number(page) || 1), pageCount);
    return { slice: list.slice((current - 1) * size, current * size), page: current, pageCount, total: list.length };
}

// The most packs looked up one by one to check them against the filters.
const FILTER_LOOKUPS = 100;

// A file inside the game folder, or an error: a pack can never write outside it.
function inside(gameDir, ...parts) {
    const root = path.resolve(gameDir);
    const target = path.resolve(root, ...parts.map((part) => String(part).replace(/\\/g, "/")));
    if (!target.startsWith(root + path.sep)) throw new Error(`A pack file points outside the game folder: ${parts.join("/")}`);
    return target;
}

const md5Of = (file) =>
    new Promise((resolve, reject) => {
        const hash = crypto.createHash("md5");
        fs.createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
    });

/* Technic and ATLauncher give MD5s: downloaded, then checked, and tried once more if wrong. */
async function downloadChecked(url, target, { md5, size, sha1 } = {}) {
    for (let attempt = 1; attempt <= 2; attempt++) {
        await downloadFile(url, target, { sha1: sha1 || undefined, size: Number(size) > 0 ? Number(size) : undefined });
        if (!md5 || (await md5Of(target)) === String(md5).toLowerCase()) return target;
        fs.rmSync(target, { force: true });
    }
    throw new Error(`${path.basename(target)} didn't match its checksum.`);
}

/* Every file of a zip into a folder, except those skip() turns down. */
async function extractZip(zipPath, destDir, skip = () => false, from = "") {
    const directory = await unzipper.Open.file(zipPath);
    const prefix = from ? `${from.toLowerCase()}/` : "";
    let written = 0;
    for (const entry of directory.files) {
        if (entry.type !== "File") continue;
        let relative = entry.path.replace(/\\/g, "/").replace(/^\/+/, "");
        if (prefix) {
            if (!relative.toLowerCase().startsWith(prefix)) continue;
            relative = relative.slice(prefix.length);
        }
        // Leftovers of zipping on a Mac: never part of the pack.
        if (/(^|\/)(__MACOSX\/|\.DS_Store$)/.test(relative)) continue;
        if (!relative || relative.endsWith("/") || skip(relative)) continue;
        let target;
        try {
            target = inside(destDir, relative);
        } catch {
            continue;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        await pipeline(entry.stream(), fs.createWriteStream(target));
        written++;
    }
    return written;
}

/* CurseForge files a pack names by id: their download URLs, or why there isn't one. */
async function curseForgeUrls(fileIds) {
    const found = new Map();
    for (let i = 0; i < fileIds.length; i += 500) {
        const res = await curseforgeFetch("/mods/files", { method: "POST", body: { fileIds: fileIds.slice(i, i + 500).map(Number) } });
        if (!res.ok) throw new Error(`CurseForge lookup failed (HTTP ${res.status}).`);
        for (const file of (await res.json()).data ?? []) found.set(String(file.id), file);
    }
    return found;
}

/* ---------------- the loader a Technic pack runs on ---------------- */

/*
 * The loader a version.json (Forge's, NeoForge's, Fabric's) is for, from its libraries,
 * else its id: "1.12.2-forge-14.23.5.2860", "1.7.10-Forge10.13.4.1614-1.7.10".
 */
function loaderFromVersionJson(json, mc) {
    const trim = (value) => String(value).replace(new RegExp(`^${mc.replace(/\./g, "\\.")}-`), "").replace(new RegExp(`-${mc.replace(/\./g, "\\.")}$`), "");
    for (const lib of json?.libraries ?? []) {
        const [group, artifact, version] = String(lib?.name ?? "").split(":");
        if (!version) continue;
        if (group === "net.neoforged" && artifact === "neoforge") return { loader: "neoforge", loaderVersion: version };
        if (group === "net.minecraftforge" && (artifact === "forge" || artifact === "minecraftforge")) return { loader: "forge", loaderVersion: trim(version) };
        if (group === "net.fabricmc" && artifact === "fabric-loader") return { loader: "fabric", loaderVersion: version };
        if (group === "org.quiltmc" && artifact === "quilt-loader") return { loader: "quilt", loaderVersion: version };
    }
    const id = String(json?.id ?? "");
    let match = id.match(/neoforge-?([\d.]+[\w.-]*)/i);
    if (match) return { loader: "neoforge", loaderVersion: match[1] };
    match = id.match(/fabric-loader-([\d.]+)/i);
    if (match) return { loader: "fabric", loaderVersion: match[1] };
    match = id.match(/forge-?(\d[\w.-]*)/i);
    if (match) return { loader: "forge", loaderVersion: trim(match[1]) };
    return null;
}

/* Looks through a Technic build's zips for bin/version.json or bin/modpack.jar. */
async function technicLoader(zips, mc) {
    let jarOnly = false;
    for (const zip of zips) {
        const directory = await unzipper.Open.file(zip);
        const entry = (name) => directory.files.find((file) => file.path.replace(/\\/g, "/").toLowerCase() === name);
        const plain = entry("bin/version.json");
        if (plain) {
            const found = loaderFromVersionJson(JSON.parse((await plain.buffer()).toString("utf8")), mc);
            if (found) return found;
        }
        const jar = entry("bin/modpack.jar");
        if (jar) {
            const inner = await unzipper.Open.buffer(await jar.buffer());
            const json = inner.files.find((file) => file.path === "version.json");
            if (json) {
                const found = loaderFromVersionJson(JSON.parse((await json.buffer()).toString("utf8")), mc);
                if (found) return found;
            }
            jarOnly = true;
        }
    }
    if (jarOnly) throw new Error("This Technic pack is built the old way, with mods inside the Minecraft jar, which the launcher can't install.");
    return { loader: "vanilla", loaderVersion: "" };
}

/* =========================================================
   FEED THE BEAST
========================================================= */

const ftbPack = (id) => cached(`ftb:${id}`, () => fetchJson(`${FTB}/${id}`));

function ftbItem(pack) {
    const newest = (pack.versions ?? []).filter((v) => !v.private).sort((a, b) => (a.released ?? 0) - (b.released ?? 0)).at(-1);
    return {
        id: String(pack.id),
        name: pack.name,
        author: pack.authors?.[0]?.name ?? "FTB",
        summary: pack.synopsis ?? "",
        icon: pack.art?.find((art) => art.type === "square")?.url ?? null,
        downloads: Number(pack.installs) || 0,
        date: iso(pack.updated),
        url: `https://www.feed-the-beast.com/modpacks/${pack.id}-${pack.slug ?? ""}`,
        mcVersion: newest?.targets?.find((t) => t.type === "game")?.version ?? null,
        loader: newest?.targets?.find((t) => t.type === "modloader")?.name ?? null,
    };
}

// A pack with any version for that Minecraft version and loader.
function ftbMatches(pack, filters) {
    if (pack.private) return false;
    if (!filters.mcVersion && !filters.loader) return true;
    return (pack.versions ?? []).some(
        (version) =>
            !version.private &&
            (!filters.mcVersion || version.targets?.some((t) => t.type === "game" && t.version === filters.mcVersion)) &&
            (!filters.loader || version.targets?.some((t) => t.type === "modloader" && String(t.name).toLowerCase() === filters.loader))
    );
}

async function ftbSearch(query, page, size, filters) {
    const ids = query
        ? (await fetchJson(`${FTB}/search/100?term=${encodeURIComponent(query)}`)).packs ?? []
        : (await cached("ftb:popular", () => fetchJson(`${FTB}/popular/installs/FTB/100`))).packs ?? [];
    // Filtering needs every pack's versions, so then all of them are looked up first.
    const filtering = Boolean(filters.mcVersion || filters.loader);
    const wanted = filtering ? ids.slice(0, FILTER_LOOKUPS) : pageOf(ids, page, size).slice;
    const packs = new Map();
    await pool(wanted, async (id) => {
        packs.set(id, await ftbPack(checkId(id)));
    }, { concurrency: 8 });
    if (!filtering) {
        const { slice, ...rest } = pageOf(ids, page, size);
        return { items: slice.map((id) => packs.get(id)).filter((pack) => pack && !pack.private).map(ftbItem), ...rest };
    }
    const kept = wanted.map((id) => packs.get(id)).filter((pack) => pack && ftbMatches(pack, filters));
    const { slice, ...rest } = pageOf(kept, page, size);
    return { items: slice.map(ftbItem), ...rest };
}

async function ftbVersions(id) {
    const pack = await ftbPack(id);
    return (pack.versions ?? [])
        .filter((v) => !v.private)
        .sort((a, b) => (b.released ?? 0) - (a.released ?? 0))
        .map((v) => ({
            id: String(v.id),
            name: v.name,
            version_type: String(v.type ?? "release").toLowerCase(),
            game_versions: (v.targets ?? []).filter((t) => t.type === "game").map((t) => t.version),
            loaders: (v.targets ?? []).filter((t) => t.type === "modloader").map((t) => t.name),
            date_published: iso(v.updated ?? v.released),
        }));
}

async function ftbPlan(id, versionId) {
    const [pack, version] = await Promise.all([ftbPack(id), fetchJson(`${FTB}/${id}/${versionId}`)]);
    const targets = version.targets ?? [];
    const loader = targets.find((t) => t.type === "modloader");
    const files = (version.files ?? []).filter((file) => !file.serveronly);

    // A file with no URL of its own comes from CurseForge, by id.
    const fromCurse = files.filter((file) => !file.url && file.curseforge?.file);
    const curse = fromCurse.length ? await curseForgeUrls(fromCurse.map((file) => file.curseforge.file)) : new Map();
    const downloads = [];
    const blocked = [];
    for (const file of files) {
        const url = file.url || curse.get(String(file.curseforge?.file))?.downloadUrl;
        if (!url) {
            blocked.push(file.name);
            continue;
        }
        downloads.push({ url, path: [file.path ?? ".", file.name], sha1: file.sha1 || file.hashes?.sha1, size: file.size });
    }

    return {
        name: pack.name,
        packVersion: version.name,
        mcVersion: targets.find((t) => t.type === "game")?.version,
        loader: loader?.name ?? "vanilla",
        loaderVersion: loader?.version ?? "",
        ram: gb(version.specs?.recommended),
        downloads,
        blocked,
        notes: [],
        archives: [],
    };
}

/* =========================================================
   TECHNIC
========================================================= */

const technicBuild = () => cached("technic:build", async () => (await fetchJson(`${TECHNIC}/launcher/version/stable4`)).build ?? 1182);
const technicPack = async (slug) => cached(`technic:${slug}`, async () => fetchJson(`${TECHNIC}/modpack/${slug}?build=${await technicBuild()}`));

function solderOf(pack) {
    if (!pack?.solder) return null;
    const url = new URL(pack.solder);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

async function technicSearch(query, page, size, filters) {
    const build = await technicBuild();
    const found = query
        ? await fetchJson(`${TECHNIC}/search?build=${build}&q=${encodeURIComponent(query)}`)
        : await cached("technic:trending", () => fetchJson(`${TECHNIC}/trending?build=${build}`));
    let list = (found.modpacks ?? []).filter((pack) => pack?.slug);
    const details = new Map();
    const lookUp = (entries) =>
        pool(entries, async (entry) => {
            details.set(entry.slug, await technicPack(checkId(entry.slug)).catch(() => null));
        }, { concurrency: 8 });
    // A Technic pack only says which Minecraft version its recommended build is for.
    if (filters.mcVersion) {
        list = list.slice(0, FILTER_LOOKUPS);
        await lookUp(list);
        list = list.filter((entry) => details.get(entry.slug)?.minecraft === filters.mcVersion);
    }
    const { slice, ...rest } = pageOf(list, page, size);
    if (!filters.mcVersion) await lookUp(slice);
    const items = await Promise.all(
        slice.map(async (entry) => {
            const pack = details.get(entry.slug);
            return {
                id: entry.slug,
                name: pack?.displayName ?? entry.name,
                author: pack?.user ?? "",
                summary: pack?.description ?? "",
                icon: pack?.icon?.url ?? entry.iconUrl ?? null,
                downloads: Number(pack?.installs) || 0,
                date: undefined,
                url: pack?.platformUrl ?? entry.url,
                mcVersion: pack?.minecraft ?? null,
                loader: null,
                installable: Boolean(pack && (pack.solder || pack.url)),
            };
        })
    );
    return { items, ...rest };
}

async function technicVersions(slug) {
    const pack = await technicPack(slug);
    const solder = solderOf(pack);
    if (!solder) {
        if (!pack.url) throw new Error("This Technic pack has no download.");
        return [{ id: checkId(pack.version || "latest", "version"), name: pack.version || "Latest", version_type: "release", game_versions: [pack.minecraft].filter(Boolean) }];
    }
    const info = await fetchJson(`${solder}modpack/${slug}`);
    const builds = (info.builds ?? []).map(String);
    const recommendedAt = builds.indexOf(String(info.recommended));
    // Newer than the recommended build: still being tested.
    return builds
        .map((build, index) => ({
            id: build,
            name: build === String(info.recommended) ? `${build} (recommended)` : build,
            version_type: recommendedAt >= 0 && index > recommendedAt ? "beta" : "release",
            game_versions: [],
        }))
        .reverse();
}

async function technicPlan(slug, versionId, tempDir, report) {
    const pack = await technicPack(slug);
    const solder = solderOf(pack);
    let mc = pack.minecraft;
    let ram;
    let zips;
    if (solder) {
        const build = await fetchJson(`${solder}modpack/${slug}/${encodeURIComponent(versionId)}`);
        mc = build.minecraft ?? mc;
        ram = gb(build.memory);
        zips = (build.mods ?? []).map((mod) => ({ name: `${mod.name}-${mod.version}`, url: mod.url, md5: mod.md5, size: mod.filesize }));
    } else {
        zips = [{ name: slug, url: pack.url }];
    }
    if (!mc) throw new Error("This Technic pack doesn't say which Minecraft version it's for.");

    // The zips come first: one of them says which loader the instance needs.
    const files = [];
    const { errors } = await pool(zips, async (zip, index) => {
        if (!/^https?:\/\//.test(String(zip.url))) throw new Error(`${zip.name} has no download.`);
        const target = path.join(tempDir, `${String(index).padStart(4, "0")}.zip`);
        await downloadChecked(zip.url, target, { md5: zip.md5, size: zip.size });
        files[index] = target;
    }, { concurrency: 8, onProgress: (done, total) => report(Math.round((done / total) * 40), `Downloading pack files ${done}/${total}`) });
    if (errors.length) throw new Error(`${errors.length} of the pack's ${zips.length} files couldn't be downloaded: ${errors[0].message}`);

    const { loader, loaderVersion } = await technicLoader(files, mc);
    return {
        name: pack.displayName ?? slug,
        packVersion: versionId,
        mcVersion: mc,
        loader,
        loaderVersion,
        ram,
        downloads: [],
        blocked: [],
        notes: [],
        // Laid over the game folder in order; bin/ is the launcher's own, never the game's.
        archives: files.map((file) => ({ file, into: ".", skip: (relative) => relative.toLowerCase().startsWith("bin/") })),
    };
}

/* =========================================================
   ATLAUNCHER
========================================================= */

const atlPacks = () =>
    cached("atl:packs", async () => ((await fetchJson(`${ATL_API}/packs/full/public`)).data ?? []).filter((pack) => pack.type === "public" && pack.versions?.length));

const atlIcon = (safeName) => `${ATL_CDN}launcher/images/${safeName.toLowerCase()}.png`;

async function atlSearch(query, page, size, filters) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const packs = (await atlPacks())
        .filter((pack) => words.every((word) => `${pack.name} ${pack.description ?? ""}`.toLowerCase().includes(word)))
        .filter((pack) => !filters.mcVersion || pack.versions.some((version) => version.minecraft === filters.mcVersion))
        .sort((a, b) => (b.versions[0]?.published ?? 0) - (a.versions[0]?.published ?? 0));
    const { slice, ...rest } = pageOf(packs, page, size);
    return {
        items: slice.map((pack) => ({
            id: pack.safeName,
            name: pack.name,
            author: "",
            summary: pack.description ?? "",
            icon: atlIcon(pack.safeName),
            downloads: 0,
            date: iso(pack.versions[0]?.published),
            url: `https://atlauncher.com/pack/${pack.safeName}`,
            mcVersion: pack.versions[0]?.minecraft ?? null,
            loader: null,
        })),
        ...rest,
    };
}

async function atlVersions(safeName) {
    const pack = (await atlPacks()).find((entry) => entry.safeName === safeName);
    if (!pack) throw new Error("That ATLauncher pack isn't listed any more.");
    return pack.versions.map((v) => ({ id: String(v.version), name: String(v.version), version_type: "release", game_versions: [v.minecraft].filter(Boolean), date_published: iso(v.published) }));
}

// Where ATLauncher puts each kind of file, inside the game folder.
const ATL_FOLDERS = {
    mods: "mods",
    resourcepack: "resourcepacks",
    texturepack: "texturepacks",
    shaderpack: "shaderpacks",
    coremods: "coremods",
    plugins: "plugins",
    ic2lib: "mods/ic2",
    denlib: "mods/denlib",
    flan: "Flan",
    root: ".",
};

async function atlPlan(safeName, versionId, tempDir) {
    const pack = (await atlPacks()).find((entry) => entry.safeName === safeName);
    if (!pack) throw new Error("That ATLauncher pack isn't listed any more.");
    const base = `${ATL_CDN}packs/${safeName}/versions/${encodeURIComponent(versionId)}/`;
    const config = await fetchJson(`${base}Configs.json`);
    const mc = config.minecraft;

    const notes = [];
    const unsupported = new Set();
    let optionalLeft = 0;
    const wanted = (config.mods ?? []).filter((mod) => {
        if (mod.client === false) return false;
        if (mod.optional && !mod.selected) {
            optionalLeft++;
            return false;
        }
        return true;
    });

    const fromCurse = wanted.filter((mod) => mod.download === "browser" && mod.curse_file_id);
    const curse = fromCurse.length ? await curseForgeUrls(fromCurse.map((mod) => mod.curse_file_id)).catch(() => new Map()) : new Map();

    const downloads = [];
    const blocked = [];
    const archives = [];
    let oldForge = null;
    for (const mod of wanted) {
        const type = String(mod.type ?? "mods").toLowerCase();
        // Old packs name Forge as one of their files: forge-1.7.10-10.13.4.1614-1.7.10-universal.jar.
        if (type === "forge" || type === "mcpc") {
            oldForge = String(mod.file ?? "").match(/forge-[\d.]+-([\d.]+)/i)?.[1] ?? oldForge;
            continue;
        }
        const folder = type === "dependency" ? `mods/${mc}` : type === "extract" ? ATL_FOLDERS[String(mod.extractTo ?? "root").toLowerCase()] : ATL_FOLDERS[type];
        if (!folder) {
            unsupported.add(type);
            continue;
        }
        const url =
            mod.download === "server" ? new URL(String(mod.url), ATL_CDN).href
            : mod.download === "direct" ? String(mod.url)
            : curse.get(String(mod.curse_file_id))?.downloadUrl;
        if (!url || !/^https?:\/\//.test(url)) {
            blocked.push(mod.name);
            continue;
        }
        const file = path.basename(String(mod.file || new URL(url).pathname));
        // extractFolder is the folder inside the zip to take; ATLauncher writes / as %s%.
        const from = String(mod.extractFolder ?? "").replace(/%s%/g, "/").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        if (type === "extract") archives.push({ url, md5: mod.md5, size: mod.filesize, into: folder, from, name: file });
        else downloads.push({ url, path: [folder, file], md5: mod.md5, size: mod.filesize });
    }
    if (optionalLeft) notes.push(`${optionalLeft} optional mod${optionalLeft === 1 ? " was" : "s were"} left out.`);
    if (unsupported.size) notes.push(`Files of a kind the launcher doesn't install were left out: ${[...unsupported].join(", ")}.`);

    // The pack's configs, in one zip beside Configs.json.
    if (!config.noConfigs && config.configs?.sha1) archives.push({ url: `${base}Configs.zip`, sha1: config.configs.sha1, size: config.configs.filesize, into: ".", name: "Configs.zip" });

    const loaderType = String(config.loader?.type ?? (oldForge ? "forge" : "")).toLowerCase();
    const meta = config.loader?.metadata ?? {};
    const known = ["forge", "neoforge", "fabric", "quilt"].includes(loaderType);
    const loaderVersion =
        !known ? ""
        : loaderType === "fabric" || loaderType === "quilt" ? meta.loader || ""
        : oldForge && !config.loader ? oldForge
        : String(meta.version || meta.rawVersion || "").replace(`${mc}-`, "").replace(`-${mc}`, "");
    if (config.loader && !known) throw new Error(`This pack runs on ${loaderType || "a loader"} the launcher doesn't install.`);
    return {
        name: pack.name,
        packVersion: versionId,
        mcVersion: mc,
        loader: known ? loaderType : "vanilla",
        loaderVersion,
        ram: gb(config.memory),
        downloads,
        blocked,
        notes,
        archives: archives.map((archive) => ({ ...archive, tempDir })),
    };
}

/* =========================================================
   THE THREE TOGETHER
========================================================= */

/*
 * One page of a site's packs. mcVersion and loader narrow it where the site says enough:
 * FTB lists both for every version, Technic and ATLauncher only the Minecraft version, so
 * with a loader chosen they have nothing to show (loaderUnknown).
 */
async function search(platform, { query = "", page = 1, mcVersion = null, loader = null, perPage = PAGE } = {}) {
    const text = String(query ?? "").trim().slice(0, 100);
    const site = checkPlatform(platform);
    const size = Math.min(50, Math.max(1, Math.floor(Number(perPage)) || PAGE));
    const filters = { mcVersion: mcVersion ? String(mcVersion) : null, loader: loader ? String(loader).toLowerCase() : null };
    if (filters.loader && site !== "ftb") return { platform: site, items: [], page: 1, pageCount: 1, total: 0, loaderUnknown: true };
    const run = site === "ftb" ? ftbSearch : site === "technic" ? technicSearch : atlSearch;
    const result = await run(text, page, size, filters);
    // A filtered pack has a version for the filters, so its tags show those rather than its newest.
    const items = result.items.map((item) => ({
        installable: true,
        ...item,
        mcVersion: filters.mcVersion ?? item.mcVersion,
        loader: (site === "ftb" && filters.loader) || item.loader,
        source: site,
    }));
    return { platform: site, ...result, items };
}

async function versions(platform, id) {
    const site = checkPlatform(platform);
    const pack = checkId(id);
    return site === "ftb" ? ftbVersions(pack) : site === "technic" ? technicVersions(pack) : atlVersions(pack);
}

/*
 * Works out what to install before the instance exists: the Minecraft version, the loader,
 * and the files. Technic's are downloaded here already, as one of them names the loader.
 */
async function plan(platform, id, versionId, tempDir, report) {
    const site = checkPlatform(platform);
    const pack = checkId(id);
    const version = checkId(versionId, "version");
    const result =
        site === "ftb" ? await ftbPlan(pack, version)
        : site === "technic" ? await technicPlan(pack, version, tempDir, report)
        : await atlPlan(pack, version, tempDir);
    if (!result.mcVersion) throw new Error("That modpack doesn't say which Minecraft version it's for.");
    return result;
}

/* Downloads a plan's files into the new instance's game folder, then lays its zips over it. */
async function apply(planned, gameDir, report) {
    const { errors } = await pool(
        planned.downloads,
        async (item) => {
            const target = inside(gameDir, ...item.path);
            await downloadChecked(item.url, target, { md5: item.md5, sha1: item.sha1, size: item.size });
        },
        { concurrency: 12, onProgress: (done, total) => report(45 + Math.round((done / total) * 40), `Pack files ${done}/${total}`) }
    );

    let written = 0;
    for (const [index, archive] of planned.archives.entries()) {
        report(86 + Math.round((index / Math.max(1, planned.archives.length)) * 12), "Applying pack files");
        let file = archive.file;
        if (!file) {
            file = path.join(archive.tempDir, `extract-${index}.zip`);
            try {
                await downloadChecked(archive.url, file, { md5: archive.md5, sha1: archive.sha1, size: archive.size });
            } catch (err) {
                errors.push(err);
                continue;
            }
        }
        const into = archive.into === "." ? path.resolve(gameDir) : inside(gameDir, archive.into);
        written += await extractZip(file, into, archive.skip, archive.from);
    }

    return { failed: errors.length, firstError: errors[0]?.message ?? null, written };
}

/*
 * The whole install: plan, make the instance with the pack's Minecraft and loader, fill it.
 * createInstance is instanceManager.createInstanceFrom.
 */
async function install(platform, id, versionId, requestedName, { createInstanceFrom, uniqueName, onProgress }) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "unity-platform-pack-"));
    const report = (percent, detail, name = requestedName) => onProgress?.({ name, stage: "pack", percent, detail });
    try {
        report(0, `Reading the pack from ${NAMES[platform] ?? platform}`);
        const planned = await plan(platform, id, versionId, tempDir, (percent, detail) => report(percent, detail));
        const name = uniqueName(String(requestedName || planned.name || "Modpack").slice(0, 80));
        report(42, `${planned.name}: Minecraft ${planned.mcVersion}, ${planned.loader}`, name);

        let result = null;
        const created = await createInstanceFrom(
            { name, version: planned.mcVersion, loader: planned.loader, loaderVersion: planned.loaderVersion, ram: planned.ram },
            async ({ gameDir }) => {
                result = await apply(planned, gameDir, (percent, detail) => report(percent, detail, name));
            },
            { onProgress: (progress) => onProgress?.({ name, ...progress }) }
        );
        report(100, "Modpack installed", name);

        return {
            ...created,
            pack: {
                name: planned.name,
                version: planned.packVersion,
                fileCount: planned.downloads.length + planned.archives.length,
                blocked: planned.blocked,
                failed: result?.failed ?? 0,
                firstError: result?.firstError ?? null,
                notes: planned.notes,
                site: NAMES[platform],
            },
        };
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

module.exports = { PLATFORMS, search, versions, install, plan, apply, loaderFromVersionJson, checkPlatform, checkId };
