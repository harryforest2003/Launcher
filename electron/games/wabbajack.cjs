const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { EventEmitter } = require("events");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { getGame, allGames } = require("./registry.cjs");
const { locate } = require("./detect.cjs");
const { dataDir, readSettings, writeSettings } = require("./storage.cjs");
const { untar, insideOf, listFiles } = require("./archive.cjs");
const { CROSSOVER_WINE, startDetached, inBottle } = require("./launch.cjs");
const { withZip } = require("../minecraft/zipFile.cjs");
const { USER_AGENT, getJson, remembered } = require("./sources/http.cjs");
const nexus = require("./nexus.cjs");

/*
 * Wabbajack modlists: whole setups (often hundreds of mods, already sorted and patched)
 * that a list's author put together in Mod Organizer 2. A .wabbajack file says where
 * each archive comes from and which file out of which archive goes where; installing is
 * downloading the archives, then rebuilding the author's Mod Organizer folder from them.
 *
 * This does what Wabbajack does for most lists: plain copies out of archives (nested ones
 * too), files carried in the list itself (with the paths in them made this computer's),
 * and binary patches (OctoDiff). Lists that also build BSA/BA2 archives or resize textures
 * need the Wabbajack app itself, and are said to.
 *
 *   settings.modlists[key] = { key, gameId, title, version, file, dir, download, installed: { version, at } }
 */

const GALLERY = "https://raw.githubusercontent.com/wabbajack-tools/mod-lists/master/repositories.json";
const WABBAJACK_SITE = "https://www.wabbajack.org/";
const HOUR = 60 * 60 * 1000;
const MARKER = ".unity-modlist.json";
const WORK = ".unity-work";
const IDLE_MS = 60 * 1000;

// Wabbajack's game names (lowercased), where the Nexus Mods name differs. null: a VR game.
const DOMAIN = { falloutnewvegas: "newvegas", dragonageorigins: "dragonage", sevendaystodie: "7daystodie", skyrimvr: null, fallout4vr: null };
const domainOf = (wjGame) => {
    const name = String(wjGame ?? "").toLowerCase();
    return name in DOMAIN ? DOMAIN[name] : name || null;
};
// The games Wabbajack has lists for, as Nexus Mods names them.
const LIST_GAMES = new Set(
    [
        "skyrimspecialedition", "skyrim", "enderal", "enderalspecialedition", "fallout4", "falloutnewvegas", "fallout3", "oblivion", "oblivionremastered",
        "morrowind", "starfield", "cyberpunk2077", "stardewvalley", "witcher3", "baldursgate3", "valheim", "darkestdungeon", "dishonored", "dragonageorigins",
        "dragonage2", "dragonageinquisition", "kingdomcomedeliverance", "mechwarrior5mercenaries", "nomanssky", "sevendaystodie", "mountandblade2bannerlord",
        "finalfantasy7remake", "karrynsprison",
    ].map(domainOf)
);
const hasLists = (game) => Boolean(game?.nexus && LIST_GAMES.has(game.nexus));

const events = new EventEmitter();
const say = (key, payload) => events.emit("progress", { key, ...payload });

const root = () => path.join(dataDir(), "wabbajack");
const downloadsDir = () => path.join(root(), "downloads");
const listsDir = () => path.join(root(), "lists");
const safeName = (text) => String(text).replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").replace(/^\.+/, "").trim().slice(0, 120) || "modlist";
const slashes = (p) => String(p).replace(/\\/g, "/").replace(/^\.?\/+/, "");

function saved(key) {
    return readSettings().modlists?.[key] ?? null;
}
function save(key, change) {
    const settings = readSettings();
    settings.modlists ??= {};
    settings.modlists[key] = { ...(settings.modlists[key] ?? { key }), ...change };
    writeSettings(settings);
    return settings.modlists[key];
}

/* ---------- The gallery ---------- */

/* Every list in Wabbajack's gallery: its repositories, then each one's lists. Down, utility and adult lists are left out. */
function gallery() {
    return remembered("wabbajack-gallery", 6 * HOUR, async () => {
        const repos = await getJson(GALLERY, { label: "Wabbajack's gallery" });
        const out = [];
        const names = Object.entries(repos ?? {}).filter(([, url]) => /^https:\/\//.test(String(url)));
        let next = 0;
        const worker = async () => {
            while (next < names.length) {
                const [repo, url] = names[next++];
                let lists = [];
                try {
                    lists = await getJson(url, { label: `Wabbajack's ${repo} lists`, timeout: 15000 });
                } catch {
                    continue;
                }
                for (const entry of Array.isArray(lists) ? lists : []) {
                    const links = entry?.links ?? {};
                    if (!links.download || !links.machineURL || entry.nsfw || entry.utility_list || entry.force_down) continue;
                    const meta = entry.download_metadata ?? {};
                    out.push({
                        key: `${repo}/${links.machineURL}`,
                        title: String(entry.title ?? links.machineURL),
                        author: String(entry.author ?? ""),
                        description: String(entry.description ?? ""),
                        game: domainOf(entry.game),
                        version: entry.version ? String(entry.version) : null,
                        official: Boolean(entry.official),
                        tags: Array.isArray(entry.tags) ? entry.tags.map(String).slice(0, 12) : [],
                        image: /^https:\/\//.test(String(links.image ?? "")) ? links.image : null,
                        readme: /^https?:\/\//.test(String(links.readme ?? "")) ? links.readme : null,
                        website: /^https?:\/\//.test(String(links.websiteURL ?? "")) ? links.websiteURL : null,
                        download: String(links.download),
                        size: { list: meta.Size ?? null, archives: meta.SizeOfArchives ?? null, installed: meta.SizeOfInstalledFiles ?? null, count: meta.NumberOfArchives ?? null },
                        updated: entry.dateUpdated ?? null,
                    });
                }
            }
        };
        await Promise.all(Array.from({ length: 12 }, worker));
        return out;
    });
}

/* A game's lists in the gallery, newest first, with what's been done with each here. */
async function listsFor(gameId) {
    const game = getGame(gameId);
    if (!hasLists(game)) return [];
    const mine = readSettings().modlists ?? {};
    return (await gallery())
        .filter((entry) => entry.game === game.nexus)
        .sort((a, b) => String(b.updated ?? "").localeCompare(String(a.updated ?? "")))
        .map((entry) => ({ ...entry, here: mine[entry.key] ? { fetched: Boolean(mine[entry.key].file && fs.existsSync(mine[entry.key].file)), installed: mine[entry.key].installed ?? null } : null }));
}

/* ---------- Downloads ---------- */

/* A file to dest, through a .part file, never all in memory; size checked when known. */
async function fetchTo(url, dest, { size, headers = {}, signal, onBytes, append = false } = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(`${path.basename(dest)} isn't from a web address.`);
    const controller = new AbortController();
    const stop = () => controller.abort(signal?.reason ?? new Error("Stopped."));
    signal?.addEventListener("abort", stop, { once: true });
    let timer;
    const alive = () => {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(new Error(`No data for a minute from ${parsed.hostname}.`)), IDLE_MS);
    };
    alive();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const part = append ? dest : `${dest}.part`;
    try {
        const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers }, redirect: "follow", signal: controller.signal });
        if (!res.ok || !res.body) throw new Error(`${parsed.hostname} answered ${res.status} for ${path.basename(dest)}.`);
        const counter = new Transform({
            transform(chunk, _enc, done) {
                alive();
                onBytes?.(chunk.length);
                done(null, chunk);
            },
        });
        await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part, { flags: append ? "a" : "w" }));
    } catch (err) {
        if (!append) fs.rmSync(part, { force: true });
        throw controller.signal.aborted && controller.signal.reason instanceof Error ? controller.signal.reason : err;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
    }
    if (append) return dest;
    const got = fs.statSync(part).size;
    if (size != null && got !== Number(size)) {
        fs.rmSync(part, { force: true });
        throw new Error(`${path.basename(dest)} didn't download whole (${got} of ${size} bytes). Try again.`);
    }
    fs.renameSync(part, dest);
    return dest;
}

/* A file on Wabbajack's own CDN: its definition, then its parts one after another. */
async function fetchCdn(url, dest, { size, signal, onBytes } = {}) {
    const base = String(url).replace(/\/+$/, "");
    if (!/^https:\/\/[\w.-]+\.wabbajack\.org\//i.test(`${base}/`)) throw new Error("That isn't a Wabbajack download address.");
    const res = await fetch(`${base}/definition.json.gz`, { headers: { "User-Agent": USER_AGENT }, signal: signal ?? AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Wabbajack's CDN answered ${res.status}.`);
    const definition = JSON.parse(zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
    const parts = [...(definition.Parts ?? [])].sort((a, b) => a.Index - b.Index);
    if (!parts.length) throw new Error("Wabbajack's CDN has no parts for that file.");
    const part = `${dest}.part`;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(part, "");
    try {
        for (const piece of parts) await fetchTo(`${base}/parts/${piece.Index}`, part, { signal, onBytes, append: true });
        const got = fs.statSync(part).size;
        const want = Number(size ?? definition.Size);
        if (got !== want) throw new Error(`${path.basename(dest)} didn't download whole (${got} of ${want} bytes). Try again.`);
        fs.renameSync(part, dest);
    } catch (err) {
        fs.rmSync(part, { force: true });
        throw err;
    }
    return dest;
}

/* ---------- Reading a list ---------- */

let loaded = null; // { file, mtime, list }

/* The list's own JSON, kept while it's the one being looked at. */
async function readList(file) {
    const mtime = fs.statSync(file).mtimeMs;
    if (loaded?.file === file && loaded.mtime === mtime) return loaded.list;
    const list = await withZip(file, async (directory) => {
        const entry = directory.files.find((f) => f.path === "modlist");
        if (!entry) throw new Error("That isn't a Wabbajack modlist (it has no list inside).");
        return JSON.parse((await entry.buffer()).toString("utf8"));
    });
    if (!Array.isArray(list.Archives) || !Array.isArray(list.Directives)) throw new Error("That Wabbajack modlist is missing its archives or directives.");
    loaded = { file, mtime, list };
    return list;
}

const typeOf = (thing) => String(thing?.$type ?? "").split(",")[0].trim();
const ARCHIVE_EXT = /\.(bsa|ba2)$/i;

/* Where an archive comes from, as the list says. */
function sourceOf(archive) {
    const state = archive.State ?? {};
    const type = typeOf(state).replace(/\+State$/, "");
    if (/^NexusDownloader$/i.test(type)) {
        const domain = domainOf(state.GameName);
        return { kind: "nexus", domain, modId: String(state.ModID), fileId: String(state.FileID), page: `https://www.nexusmods.com/${domain}/mods/${state.ModID}?tab=files&file_id=${state.FileID}&nmm=1`, label: "Nexus Mods" };
    }
    if (/^HttpDownloader$/i.test(type) && /^https?:\/\//i.test(String(state.Url))) return { kind: "http", url: state.Url, headers: state.Headers ?? [], page: state.Url, label: new URL(state.Url).hostname };
    if (/^WabbajackCDNDownloader$/i.test(type) && state.Url) return { kind: "cdn", url: state.Url, label: "Wabbajack" };
    if (/^GameFileSourceDownloader$/i.test(type)) return { kind: "game", file: slashes(state.GameFile ?? ""), gameVersion: state.GameVersion ?? null, label: "Your game" };
    const page = [state.Url, state.URL, state.IPS4Url, state.Id ? `https://drive.google.com/file/d/${state.Id}/view` : null].find((u) => /^https?:\/\//i.test(String(u ?? "")));
    return { kind: "manual", page: page ?? null, prompt: state.Prompt ? String(state.Prompt) : null, label: page ? new URL(page).hostname : type.replace(/Downloader$/, "") };
}

/* The directive types handled here; anything else needs the Wabbajack app. */
const HANDLED = new Set(["FromArchive", "PatchedFromArchive", "InlineFile", "RemappedInlineFile", "ArchiveMeta", "IgnoredDirectly", "NoMatch", "PropertyFile"]);
const WHY = {
    CreateBSA: "builds BSA/BA2 archives",
    TransformedTexture: "resizes and recompresses textures",
    MergedPatch: "merges patches",
    PatchedFromArchiveFromBSA: "patches files inside BSA archives",
};

/* The files the launcher can find for a list: in its own downloads, and the user's Downloads. */
function filesOnHand() {
    const byName = new Map();
    for (const dir of [downloadsDir(), path.join(os.homedir(), "Downloads")]) {
        let names = [];
        try {
            names = fs.readdirSync(dir);
        } catch {
            continue;
        }
        for (const name of names) {
            if (name.endsWith(".part") || name.endsWith(".meta")) continue;
            const full = path.join(dir, name);
            let stat;
            try {
                stat = fs.statSync(full);
            } catch {
                continue;
            }
            if (!stat.isFile()) continue;
            const key = name.toLowerCase();
            if (!byName.has(key)) byName.set(key, []);
            byName.get(key).push({ path: full, size: stat.size });
        }
    }
    return byName;
}

/* A path inside a folder, whatever its letter case says (lists come from Windows). */
function caseless(base, rel) {
    let at = base;
    for (const part of slashes(rel).split("/").filter(Boolean)) {
        const exact = path.join(at, part);
        if (fs.existsSync(exact)) {
            at = exact;
            continue;
        }
        let names = [];
        try {
            names = fs.readdirSync(at);
        } catch {
            return null;
        }
        const match = names.find((name) => name.toLowerCase() === part.toLowerCase());
        if (!match) return null;
        at = path.join(at, match);
    }
    return at;
}

/* Windows' name for a folder here: itself on Windows; in a CrossOver bottle, C:; anywhere else on a Mac, Wine's Z:. */
function windowsPath(dir) {
    if (process.platform === "win32") return path.resolve(dir);
    const marker = `${path.sep}drive_c`;
    const at = dir.indexOf(`${marker}${path.sep}`);
    if (at >= 0) return `C:${dir.slice(at + marker.length)}`.replace(/\//g, "\\");
    if (dir.endsWith(marker)) return "C:\\";
    return `Z:${dir}`.replace(/\//g, "\\");
}

function defaultDir(title, gameDir) {
    if (process.platform !== "win32" && inBottle(gameDir)) {
        const at = gameDir.indexOf(`${path.sep}drive_c${path.sep}`);
        return path.join(gameDir.slice(0, at), "drive_c", "Modlists", safeName(title));
    }
    return path.join(os.homedir(), "Modlists", safeName(title));
}

/* Why a folder can't take a list: not empty and not this list's, or inside the game or the downloads. */
function dirProblem(key, dir, gameDir) {
    if (!dir) return "Choose a folder to install the list in.";
    if (gameDir && (insideOf(gameDir, dir) || insideOf(dir, gameDir))) return "Install the list in its own folder, not in or around the game's.";
    if (insideOf(root(), dir) || insideOf(dir, root())) return "Install the list in its own folder, not the launcher's.";
    if (!fs.existsSync(dir)) return null;
    const names = fs.readdirSync(dir).filter((name) => name !== ".DS_Store");
    if (!names.length) return null;
    try {
        if (JSON.parse(fs.readFileSync(path.join(dir, MARKER), "utf8")).key === key) return null;
    } catch {
        // Not a list installed here.
    }
    return "That folder has other files in it: choose an empty one.";
}

/*
 * What installing a list takes: each archive, where it comes from and whether it's here,
 * what (if anything) about the list needs the Wabbajack app, and where it would go.
 */
async function plan(key) {
    const entry = saved(key);
    if (!entry?.file || !fs.existsSync(entry.file)) throw new Error("Get the list first.");
    const list = await readList(entry.file);
    const game = getGame(entry.gameId);
    const loc = game ? locate(game.id) : null;
    const onHand = filesOnHand();

    const usedBy = new Map();
    const unsupported = new Map();
    let installSize = 0;
    for (const d of list.Directives) {
        const type = typeOf(d);
        installSize += Number(d.Size ?? 0);
        if (!HANDLED.has(type)) {
            unsupported.set(type, (unsupported.get(type) ?? 0) + 1);
            continue;
        }
        const hashPath = d.ArchiveHashPath ?? [];
        if (!hashPath.length) continue;
        usedBy.set(hashPath[0], (usedBy.get(hashPath[0]) ?? 0) + 1);
        // A file read out of a BSA/BA2 (inside an archive or as the archive itself) needs a BSA reader.
        const containers = hashPath.slice(1, -1);
        const archive = list.Archives.find((a) => a.Hash === hashPath[0]);
        if (containers.some((c) => ARCHIVE_EXT.test(c)) || (hashPath.length > 1 && ARCHIVE_EXT.test(archive?.Name ?? ""))) {
            unsupported.set("FromBSA", (unsupported.get("FromBSA") ?? 0) + 1);
        }
    }

    const archives = list.Archives.map((archive) => {
        const source = sourceOf(archive);
        let where = null;
        if (source.kind === "game") {
            const file = loc?.gameDir ? caseless(loc.gameDir, source.file) : null;
            if (file && fs.statSync(file).size === Number(archive.Size)) where = file;
        } else {
            where = (onHand.get(String(archive.Name).toLowerCase()) ?? []).find((f) => f.size === Number(archive.Size))?.path ?? null;
        }
        return { hash: archive.Hash, name: String(archive.Name), size: Number(archive.Size ?? 0), ...source, have: Boolean(where), where, used: usedBy.get(archive.Hash) ?? 0 };
    });

    const problems = [];
    if (!loc?.gameDir) problems.push(`The launcher can't find ${game?.name ?? "the game"}: choose its folder in the game's Settings.`);
    else if (process.platform === "darwin" && !inBottle(loc.gameDir)) {
        problems.push(`Mod Organizer 2 is a Windows program: on a Mac, a list needs the Windows version of ${game.name} in a CrossOver bottle, and is installed beside it there.`);
    }
    const missingGame = archives.filter((a) => a.kind === "game" && !a.have);
    if (missingGame.length) problems.push(`${missingGame.length} of the game's own files aren't the ones the list was made with (${missingGame.slice(0, 3).map((a) => a.file).join(", ")}). It may want another version of the game${missingGame[0].gameVersion ? ` (${missingGame[0].gameVersion})` : ""}.`);

    const dir = entry.dir ?? defaultDir(entry.title ?? list.Name, loc?.gameDir ?? null);
    const reasons = [...unsupported.entries()].map(([type, count]) => ({ type, count, why: WHY[type] ?? (type === "FromBSA" ? "takes files out of BSA/BA2 archives" : `uses ${type} steps`) }));
    const missing = archives.filter((a) => !a.have && a.kind !== "game");
    return {
        key,
        gameId: entry.gameId,
        title: String(list.Name ?? entry.title ?? "Modlist"),
        author: String(list.Author ?? ""),
        version: list.Version ? String(list.Version) : null,
        description: String(list.Description ?? ""),
        readme: /^https?:\/\//.test(String(list.Readme ?? "")) ? list.Readme : null,
        website: /^https?:\/\//.test(String(list.Website ?? "")) ? list.Website : null,
        wabbajackVersion: list.WabbajackVersion ?? null,
        archives,
        missing: { count: missing.length, size: missing.reduce((n, a) => n + a.size, 0) },
        automatic: missing.filter((a) => a.kind === "http" || a.kind === "cdn" || a.kind === "nexus").length,
        installSize,
        files: list.Directives.length,
        unsupported: reasons,
        problems,
        dir,
        dirProblem: dirProblem(key, dir, loc?.gameDir ?? null),
        installed: entry.installed ?? null,
        busy: busy.get(key)?.what ?? null,
        wabbajackSite: WABBAJACK_SITE,
    };
}

/* ---------- Getting a list ---------- */

/* Downloads a gallery list's .wabbajack (or uses the one already here at that version). */
async function fetchList(gameId, listKey) {
    const entry = (await gallery()).find((e) => e.key === listKey);
    if (!entry) throw new Error("That list isn't in Wabbajack's gallery any more.");
    const game = getGame(gameId);
    if (!game || entry.game !== game.nexus) throw new Error(`That list isn't for ${game?.name ?? "this game"}.`);
    const file = path.join(listsDir(), `${safeName(listKey.replace("/", "-"))}.wabbajack`);
    const before = saved(listKey);
    const fresh = before?.file === file && fs.existsSync(file) && before.download === entry.download;
    if (!fresh) {
        await withBusy(listKey, "fetching", async (signal) => {
            let got = 0;
            const onBytes = (n) => {
                got += n;
                say(listKey, { stage: "fetching", done: got, total: entry.size.list ?? null, detail: `Getting ${entry.title}` });
            };
            if (/^https:\/\/[\w.-]+\.wabbajack\.org\//i.test(entry.download)) await fetchCdn(entry.download, file, { size: entry.size.list, signal, onBytes });
            else await fetchTo(entry.download, file, { size: entry.size.list, signal, onBytes });
        });
    }
    save(listKey, { gameId, title: entry.title, version: entry.version, file, download: entry.download, image: entry.image });
    return plan(listKey);
}

/* A .wabbajack file from this computer. */
async function openFile(gameId, file) {
    const list = await readList(file);
    const game = getGame(gameId);
    const wanted = domainOf(list.GameType);
    if (!game || wanted !== game.nexus) throw new Error(`That list is for ${list.GameType ?? "another game"}, not ${game?.name ?? "this game"}.`);
    const key = `file/${crypto.createHash("sha1").update(path.resolve(file)).digest("hex").slice(0, 12)}`;
    const copy = path.join(listsDir(), `${key.replace("/", "-")}.wabbajack`);
    fs.mkdirSync(listsDir(), { recursive: true });
    if (path.resolve(copy) !== path.resolve(file)) fs.copyFileSync(file, copy);
    save(key, { gameId, title: String(list.Name ?? path.basename(file, ".wabbajack")), version: list.Version ? String(list.Version) : null, file: copy, download: null });
    return plan(key);
}

/* Lists already got here, for a game. */
function mine(gameId) {
    return Object.values(readSettings().modlists ?? {})
        .filter((entry) => entry.gameId === gameId && entry.file && fs.existsSync(entry.file))
        .map((entry) => ({ key: entry.key, title: entry.title, version: entry.version ?? null, image: entry.image ?? null, installed: entry.installed ?? null, dir: entry.dir ?? null }));
}

function setDir(key, dir) {
    const entry = saved(key);
    if (!entry) throw new Error("Get the list first.");
    const loc = locate(entry.gameId);
    const problem = dirProblem(key, dir, loc.gameDir);
    if (problem) throw new Error(problem);
    save(key, { dir });
    return plan(key);
}

/* Forgets a list (and its .wabbajack); what it installed stays. */
function forgetList(key) {
    const entry = saved(key);
    if (busy.has(key)) throw new Error("Wait for the list to finish first.");
    if (entry?.file && insideOf(listsDir(), entry.file)) fs.rmSync(entry.file, { force: true });
    const settings = readSettings();
    delete settings.modlists?.[key];
    writeSettings(settings);
    return true;
}

/* ---------- One thing at a time per list ---------- */

const busy = new Map(); // key -> { what, controller }

async function withBusy(key, what, work) {
    if (busy.has(key)) throw new Error("That list is already busy.");
    const controller = new AbortController();
    busy.set(key, { what, controller });
    say(key, { stage: what, detail: null });
    try {
        return await work(controller.signal);
    } finally {
        busy.delete(key);
        say(key, { stage: "idle" });
    }
}

function stop(key) {
    busy.get(key)?.controller.abort(new Error("Stopped."));
    return true;
}

/* ---------- Downloading archives ---------- */

async function downloadArchive(archive, signal, onBytes, nxm = null) {
    const dest = path.join(downloadsDir(), safeName(archive.name));
    if (archive.kind === "cdn") await fetchCdn(archive.url, dest, { size: archive.size, signal, onBytes });
    else if (archive.kind === "http") {
        const headers = {};
        for (const line of archive.headers ?? []) {
            const at = String(line).indexOf(":");
            if (at > 0) headers[String(line).slice(0, at).trim()] = String(line).slice(at + 1).trim();
        }
        await fetchTo(archive.url, dest, { size: archive.size, headers, signal, onBytes });
    } else if (archive.kind === "nexus") {
        const url = await nexus.downloadUrl(archive.domain, archive.modId, archive.fileId, nxm);
        await fetchTo(url, dest, { size: archive.size, signal, onBytes });
    } else throw new Error(`${archive.name} has to be downloaded by hand.`);
    return dest;
}

/* Downloads every archive that can be (Nexus Mods ones only with Premium), three at a time. */
async function downloadMissing(key) {
    const first = await plan(key);
    let premium = false;
    try {
        premium = Boolean((await nexus.whoAmI())?.premium);
    } catch {
        premium = false;
    }
    const todo = first.archives.filter((a) => !a.have && (a.kind === "http" || a.kind === "cdn" || (a.kind === "nexus" && premium)));
    const failed = [];
    await withBusy(key, "downloading", async (signal) => {
        const total = todo.reduce((n, a) => n + a.size, 0);
        let done = 0;
        let files = 0;
        let next = 0;
        const worker = async () => {
            while (next < todo.length && !signal.aborted) {
                const archive = todo[next++];
                try {
                    await downloadArchive(archive, signal, (n) => {
                        done += n;
                        say(key, { stage: "downloading", done, total, detail: `${files} of ${todo.length} downloaded · ${archive.name}` });
                    });
                    files++;
                } catch (err) {
                    if (signal.aborted) return;
                    failed.push(`${archive.name}: ${err.message}`);
                }
            }
        };
        await Promise.all([worker(), worker(), worker()]);
        if (signal.aborted) throw signal.reason;
    });
    const after = await plan(key);
    return { ...after, failed: failed.slice(0, 20), nexusByHand: !premium && after.archives.some((a) => !a.have && a.kind === "nexus") };
}

/*
 * A Nexus "Mod Manager Download" link that a list waiting here wants: downloaded into the
 * list's downloads. null when no list is waiting for it, so it installs as a mod as usual.
 */
async function takeNxm(parsed) {
    for (const [key, entry] of Object.entries(readSettings().modlists ?? {})) {
        if (!entry.file || !fs.existsSync(entry.file) || entry.installed?.version === entry.version) continue;
        if (!loaded || loaded.file !== entry.file) continue; // only the list being looked at
        const archive = loaded.list.Archives.map((a) => ({ name: String(a.Name), size: Number(a.Size ?? 0), ...sourceOf(a) })).find(
            (a) => a.kind === "nexus" && a.domain === parsed.domain && a.modId === String(parsed.modId) && a.fileId === String(parsed.fileId)
        );
        if (!archive) continue;
        let done = 0;
        say(key, { stage: "nexus", detail: `Downloading ${archive.name}` });
        try {
            await downloadArchive(archive, null, (n) => {
                done += n;
                say(key, { stage: "nexus", done, total: archive.size, detail: `Downloading ${archive.name}` });
            }, parsed);
            say(key, { stage: "idle", changed: true, detail: `${archive.name} downloaded.` });
        } catch (err) {
            say(key, { stage: "idle", error: `${archive.name}: ${err.message}` });
        }
        return true;
    }
    return null;
}

/* ---------- Installing ---------- */

/* OctoDiff's delta format, applied to basis into out: copies out of basis, and new bytes; the result is checked. */
function applyDelta(basis, delta, out) {
    if (delta.toString("latin1", 0, 9) !== "OCTODELTA") throw new Error("A patch in the list isn't one the launcher can read.");
    let pos = 9;
    if (delta[pos++] !== 1) throw new Error("A patch in the list is a newer kind than the launcher reads.");
    let length = 0;
    let shift = 0;
    let byte;
    do {
        byte = delta[pos++];
        length |= (byte & 0x7f) << shift;
        shift += 7;
    } while (byte & 0x80);
    const algorithm = delta.toString("utf8", pos, pos + length);
    pos += length;
    const hashLength = delta.readInt32LE(pos);
    pos += 4;
    const expected = delta.subarray(pos, pos + hashLength);
    pos += hashLength;
    if (delta.toString("latin1", pos, pos + 3) !== ">>>") throw new Error("A patch in the list is damaged.");
    pos += 3;
    const input = fs.openSync(basis, "r");
    const output = fs.openSync(out, "w");
    const chunk = Buffer.alloc(1 << 20);
    try {
        while (pos < delta.length) {
            const command = delta[pos++];
            if (command === 0x60) {
                let start = Number(delta.readBigInt64LE(pos));
                let left = Number(delta.readBigInt64LE(pos + 8));
                pos += 16;
                while (left > 0) {
                    const n = fs.readSync(input, chunk, 0, Math.min(chunk.length, left), start);
                    if (!n) throw new Error("A patch in the list reads past the end of its file.");
                    fs.writeSync(output, chunk, 0, n);
                    start += n;
                    left -= n;
                }
            } else if (command === 0x80) {
                const left = Number(delta.readBigInt64LE(pos));
                pos += 8;
                fs.writeSync(output, delta, pos, left);
                pos += left;
            } else throw new Error("A patch in the list is damaged.");
        }
    } finally {
        fs.closeSync(input);
        fs.closeSync(output);
    }
    // The hash in the patch is the patched file's: what came out is checked against it.
    if (algorithm === "SHA1" && !sha1Of(out).equals(expected)) {
        fs.rmSync(out, { force: true });
        throw new Error(`Patching ${path.basename(basis)} didn't give the file the list expects: the archive may be another version than the list's.`);
    }
}

function sha1Of(file) {
    const hash = crypto.createHash("sha1");
    const fd = fs.openSync(file, "r");
    const chunk = Buffer.alloc(1 << 20);
    try {
        let n;
        let at = 0;
        while ((n = fs.readSync(fd, chunk, 0, chunk.length, at)) > 0) {
            hash.update(chunk.subarray(0, n));
            at += n;
        }
    } finally {
        fs.closeSync(fd);
    }
    return hash.digest();
}

const MAGIC = ["GAME_PATH", "MO2_PATH", "DOWNLOAD_PATH"];
/* Wabbajack's stand-ins for folders, in a list's own files, made this computer's. */
function remap(text, paths) {
    let out = text;
    for (const name of MAGIC) {
        const win = paths[name];
        const forms = { BACK: win, DOUBLE_BACK: win.replace(/\\/g, "\\\\"), FORWARD: win.replace(/\\/g, "/") };
        for (const [form, value] of Object.entries(forms)) out = out.split(`{--||${name}_MAGIC_${form}||--}`).join(value);
    }
    return out;
}

/* Sets one key in an INI section (adding the section or key if missing). */
function setIni(text, section, key, value) {
    const lines = text.split(/\r?\n/);
    const head = lines.findIndex((line) => line.trim().toLowerCase() === `[${section.toLowerCase()}]`);
    if (head < 0) return `${text.replace(/\s*$/, "")}\r\n\r\n[${section}]\r\n${key}=${value}\r\n`;
    let end = lines.findIndex((line, i) => i > head && /^\s*\[/.test(line));
    if (end < 0) end = lines.length;
    const at = lines.findIndex((line, i) => i > head && i < end && line.split("=")[0].trim().toLowerCase() === key.toLowerCase());
    if (at >= 0) lines[at] = `${key}=${value}`;
    else lines.splice(head + 1, 0, `${key}=${value}`);
    return lines.join("\r\n");
}

const clone = (from, to) => fs.copyFileSync(from, to, fs.constants.COPYFILE_FICLONE);

/* Unpacks an archive (any kind tar reads, zips included) into a fresh folder. */
async function unpackTo(file, into) {
    fs.mkdirSync(into, { recursive: true });
    await untar(file, into, { timeout: 2 * 60 * 60 * 1000 });
    const index = new Map();
    for (const rel of listFiles(into)) index.set(rel.toLowerCase(), path.join(into, rel));
    return index;
}

/*
 * Installs a list into its folder from the archives on hand: Wabbajack's work, minus what
 * needs Wabbajack itself. Files a previous install of the list put there and the new
 * version doesn't have are removed; ones already right are left as they are.
 */
async function install(key) {
    const current = await plan(key);
    if (current.unsupported.length) throw new Error(`This list ${current.unsupported.map((u) => u.why).join(" and ")}, which only the Wabbajack app does.`);
    if (current.problems.length) throw new Error(current.problems[0]);
    if (current.missing.count) throw new Error(`${current.missing.count} archives still need downloading.`);
    if (current.dirProblem) throw new Error(current.dirProblem);
    const entry = saved(key);
    const list = await readList(entry.file);
    const loc = locate(entry.gameId);
    const dir = current.dir;
    const byHash = new Map(current.archives.map((a) => [a.hash, a]));

    fs.mkdirSync(dir, { recursive: true });
    let before = { files: {} };
    try {
        before = JSON.parse(fs.readFileSync(path.join(dir, MARKER), "utf8"));
    } catch {
        // A first install.
    }
    const wanted = list.Directives.filter((d) => ["FromArchive", "PatchedFromArchive", "InlineFile", "RemappedInlineFile"].includes(typeOf(d)));
    const outOf = (d) => {
        const target = path.join(dir, slashes(d.To));
        if (!insideOf(dir, target) || path.resolve(target) === path.resolve(dir)) throw new Error(`The list tries to write outside its folder (${d.To}).`);
        return target;
    };
    // Already there from before, the same file: left alone.
    const already = (d) => {
        if (before.files?.[slashes(d.To).toLowerCase()] !== d.Hash) return false;
        try {
            return fs.statSync(outOf(d)).size === Number(d.Size);
        } catch {
            return false;
        }
    };
    const need = wanted.reduce((n, d) => n + (already(d) ? 0 : Number(d.Size ?? 0)), 0);
    let free = null;
    try {
        const { bavail, bsize } = fs.statfsSync(dir);
        free = bavail * bsize;
    } catch {
        // statfs isn't everywhere: go ahead.
    }
    if (free != null && free < need * 1.1 + 2 ** 30) {
        throw new Error(`The list needs about ${Math.ceil((need * 1.1) / 2 ** 30)} GB free where it's going, and there's ${Math.floor(free / 2 ** 30)} GB.`);
    }

    const paths = { GAME_PATH: windowsPath(loc.gameDir), MO2_PATH: windowsPath(dir), DOWNLOAD_PATH: windowsPath(downloadsDir()) };
    const written = {};
    const work = path.join(dir, WORK);
    return withBusy(key, "installing", async (signal) => {
        let doneBytes = 0;
        const step = (detail) => say(key, { stage: "installing", done: doneBytes, total: need, detail });
        const check = () => {
            if (signal.aborted) throw signal.reason;
        };
        const finish = (d, target) => {
            const size = fs.statSync(target).size;
            if (size !== Number(d.Size)) throw new Error(`${d.To} came out the wrong size (${size}, not ${d.Size}).`);
            written[slashes(d.To).toLowerCase()] = d.Hash;
            doneBytes += size;
        };
        fs.rmSync(work, { recursive: true, force: true });
        try {
            await withZip(entry.file, async (zip) => {
                const entries = new Map(zip.files.map((f) => [f.path, f]));
                const inline = async (id) => {
                    const file = entries.get(id);
                    if (!file) throw new Error(`The list is missing one of its own files (${id}).`);
                    return file.buffer();
                };

                // The list's own files.
                step("Writing the list's own files");
                for (const d of wanted) {
                    const type = typeOf(d);
                    if (type !== "InlineFile" && type !== "RemappedInlineFile") continue;
                    check();
                    const target = outOf(d);
                    fs.mkdirSync(path.dirname(target), { recursive: true });
                    // Not size-checked: Wabbajack rewrites some of these (paths, a profile's disabled
                    // mods left out of modlist.txt), so they needn't be the size the list gives.
                    let data = await inline(d.SourceDataID);
                    if (type === "RemappedInlineFile") data = Buffer.from(remap(data.toString("utf8"), paths), "utf8");
                    fs.writeFileSync(target, data);
                    written[slashes(d.To).toLowerCase()] = d.Hash;
                    doneBytes += Number(d.Size ?? 0);
                }

                // Out of each archive in turn: unpacked once, then cleared away.
                const groups = new Map();
                for (const d of wanted) {
                    if (!d.ArchiveHashPath?.length) continue;
                    if (already(d)) {
                        written[slashes(d.To).toLowerCase()] = d.Hash;
                        continue;
                    }
                    const hash = d.ArchiveHashPath[0];
                    if (!groups.has(hash)) groups.set(hash, []);
                    groups.get(hash).push(d);
                }
                let n = 0;
                for (const [hash, directives] of groups) {
                    check();
                    n++;
                    const archive = byHash.get(hash);
                    if (!archive?.where) throw new Error(`An archive the list needs is missing (${archive?.name ?? hash}).`);
                    step(`${n} of ${groups.size}: ${archive.name}`);
                    const here = path.join(work, String(n));
                    const unpacked = new Map(); // container path -> index
                    const open = async (hashPath) => {
                        // [archive, inner, (inner of inner)...]: each container unpacked once.
                        if (hashPath.length === 1) return archive.where;
                        let index = unpacked.get("");
                        if (!index) {
                            index = await unpackTo(archive.where, path.join(here, "0"));
                            unpacked.set("", index);
                        }
                        let file = null;
                        for (let i = 1; i < hashPath.length; i++) {
                            file = index.get(slashes(hashPath[i]).toLowerCase());
                            if (!file) throw new Error(`${archive.name} doesn't have ${hashPath.slice(1, i + 1).join(" → ")} in it. It may be another version than the list's.`);
                            if (i < hashPath.length - 1) {
                                const id = hashPath.slice(1, i + 1).join("|").toLowerCase();
                                index = unpacked.get(id);
                                if (!index) {
                                    index = await unpackTo(file, path.join(here, String(unpacked.size)));
                                    unpacked.set(id, index);
                                }
                            }
                        }
                        return file;
                    };
                    for (const d of directives) {
                        check();
                        const from = await open(d.ArchiveHashPath);
                        const target = outOf(d);
                        fs.mkdirSync(path.dirname(target), { recursive: true });
                        fs.rmSync(target, { force: true });
                        if (typeOf(d) === "PatchedFromArchive") applyDelta(from, await inline(d.PatchID), target);
                        else clone(from, target);
                        finish(d, target);
                    }
                    fs.rmSync(here, { recursive: true, force: true });
                    step(`${n} of ${groups.size}: ${archive.name}`);
                    // Partway, what's done so far is remembered: a stopped install picks up from it.
                    fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({ key, version: entry.version ?? null, files: { ...before.files, ...written }, partial: true }));
                }
            });
        } finally {
            fs.rmSync(work, { recursive: true, force: true });
        }

        // Files of the last version that this one doesn't have.
        for (const rel of Object.keys(before.files ?? {})) {
            if (written[rel]) continue;
            const target = caseless(dir, rel);
            if (target && insideOf(dir, target)) fs.rmSync(target, { force: true });
        }
        // Mod Organizer as Wabbajack leaves it: a portable instance, with the list's downloads.
        fs.writeFileSync(path.join(dir, "portable.txt"), "");
        const ini = caseless(dir, "ModOrganizer.ini");
        if (ini) fs.writeFileSync(ini, setIni(fs.readFileSync(ini, "utf8"), "Settings", "download_directory", paths.DOWNLOAD_PATH.replace(/\\/g, "/")));
        for (const archive of list.Archives) {
            if (!archive.Meta) continue;
            const meta = path.join(downloadsDir(), `${safeName(archive.Name)}.meta`);
            if (!fs.existsSync(meta) && fs.existsSync(path.join(downloadsDir(), safeName(archive.Name)))) fs.writeFileSync(meta, `${archive.Meta}\ninstalled=true\n`);
        }
        fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({ key, version: entry.version ?? null, files: written }));
        save(key, { dir, installed: { version: entry.version ?? null, at: new Date().toISOString(), files: Object.keys(written).length } });
        return plan(key);
    });
}

/* ---------- After ---------- */

const mo2Of = (key) => {
    const entry = saved(key);
    const exe = entry?.dir ? caseless(entry.dir, "ModOrganizer.exe") : null;
    if (!exe || !entry.installed) throw new Error("Install the list first.");
    return exe;
};

/* Starts the list's Mod Organizer: on a Mac through CrossOver, in its bottle. */
async function runMo2(key) {
    const exe = mo2Of(key);
    if (process.platform === "win32") return startDetached(exe, [], path.dirname(exe));
    const match = exe.match(/\/Bottles\/([^/]+)\/drive_c\//);
    if (!match || !exe.includes("/CrossOver/Bottles/") || !fs.existsSync(CROSSOVER_WINE)) {
        throw new Error("Mod Organizer is a Windows program: on a Mac it runs through CrossOver, from a list installed in the game's bottle.");
    }
    return startDetached(CROSSOVER_WINE, ["--bottle", match[1], exe], path.dirname(exe));
}

const folderOf = (key) => {
    const entry = saved(key);
    if (!entry?.dir || !fs.existsSync(entry.dir)) throw new Error("The list isn't installed yet.");
    return entry.dir;
};

module.exports = {
    hasLists,
    listsFor,
    mine,
    fetchList,
    openFile,
    plan,
    setDir,
    forgetList,
    downloadMissing,
    takeNxm,
    install,
    stop,
    runMo2,
    folderOf,
    events,
    // For tests.
    applyDelta,
    remap,
    setIni,
    windowsPath,
    sourceOf,
    WABBAJACK_SITE,
};
