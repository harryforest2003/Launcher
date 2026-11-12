const fs = require("fs");
const path = require("path");
const { locate } = require("./detect.cjs");
const { dataDir } = require("./storage.cjs");
const store = require("./store.cjs");
const { readIndex, readResource, hex } = require("./dbpf.cjs");
const { withZip } = require("../minecraft/zipFile.cjs");

/*
 * What's inside each of The Sims 4's packages and script mods, for the conflict detector
 * and the CC browser: the resources each one has (game tuning, Create a Sim parts, Build/
 * Buy objects), whether it carries a thumbnail, and each script mod's Python modules.
 * Kept between runs by each file's size and date, so only new or changed files are read.
 */

// Resources that are pictures, meshes, animations and the like: never "the same setting".
const ASSET_TYPES = new Set(
    [
        0x00b2d882, 0x3453cf95, 0xba856c78, 0x2bc04edf, 0x3c1af1f2, 0x3c2a8647, 0x5b282d45, 0xcd9de247, 0x2f7d0004, 0x015a1849, 0x01661233, 0x01d10f34,
        0x8eaf13de, 0xd382bf57, 0xac16fbec, 0x6b20c4f3, 0xbc4a5044, 0x01d0e75d, 0x02019972, 0x0166038c, 0x220557da, 0xd3044521, 0x03b4c61d, 0x81ca1a10,
        0x0354796a, 0x9d1ab874, 0xb0118c15, 0x1b25a024, 0xd5f0f921, 0x033b2b66, 0x9917eacd, 0xba856c78,
    ]
);
const CASP = 0x034aeecb;
const OBJECT_TYPES = new Set([0xc0db5ae7, 0x319e4f1d]);
const SIMDATA = 0x545ac67a;
// Pictures packages carry, in the order they're worth showing.
const THUMB_TYPES = [0x3c1af1f2, 0x3c2a8647, 0x5b282d45, 0xcd9de247];

const keyOf = (e) => `${hex(e.type)}:${hex(e.group)}:${e.instance}`;

/* ---------------- the files ---------------- */

/*
 * Every package and script mod, on or off: [{ abs, rel, key, enabled, owner }]. rel is the
 * path in Mods; key is its entry in the mod list (a mod the launcher installed, or the
 * file itself when it was added by hand).
 */
function files(gameId = "sims4") {
    const loc = locate(gameId);
    if (!loc.docsDir) return [];
    const mods = path.join(loc.docsDir, "Mods");
    const out = [];
    const state = store.readState(gameId);
    const owned = new Map();
    for (const mod of state.mods) {
        for (const file of mod.files) {
            if (file.base !== "docs" || !/\.(package|ts4script)$/i.test(file.to)) continue;
            const rel = file.to.replace(/^Mods\//i, "");
            const live = path.join(loc.docsDir, file.to);
            const parked = path.join(dataDir(), gameId, "parked", mod.id, "docs", file.to);
            const kept = path.join(dataDir(), gameId, "versions", mod.id, "docs", file.to);
            const abs = mod.enabled ? (fs.existsSync(live) ? live : kept) : fs.existsSync(parked) ? parked : kept;
            owned.set(rel.toLowerCase(), true);
            out.push({ abs, rel, key: `m:${mod.id}`, enabled: mod.enabled, owner: mod.name });
        }
    }
    const walk = (dir, rel, depth) => {
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith(".")) continue;
            const child = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (depth < 6) walk(path.join(dir, entry.name), child, depth + 1);
            } else if (/\.(package|ts4script)$/i.test(entry.name) && !owned.has(child.toLowerCase())) {
                out.push({ abs: path.join(dir, entry.name), rel: child, key: `h:docs:Mods/${child}`, enabled: true, owner: null });
            }
        }
    };
    walk(mods, "", 0);
    // Ones added by hand and turned off, kept in the launcher's folder.
    walk(path.join(dataDir(), gameId, "parked", "_hand", "docs", "Mods"), "", 0);
    for (const item of out) if (item.abs.includes(`${path.sep}parked${path.sep}_hand${path.sep}`)) item.enabled = false;
    return out.filter((item) => fs.existsSync(item.abs));
}

/* ---------------- what's in each ---------------- */

const cacheFile = () => path.join(dataDir(), "sims4", "package-index.json");
let cache = null;

function loadCache() {
    if (cache) return cache;
    try {
        cache = JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
    } catch {
        cache = {};
    }
    return cache;
}

function saveCache() {
    try {
        fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
        fs.writeFileSync(cacheFile(), JSON.stringify(cache));
    } catch {
        // Read again next time.
    }
}

/*
 * What a package holds: { keys: [settings and items it has], cas, objects, tuning, thumb, instances }
 * thumb is where its own picture is; instances are its CAS parts' and objects' (for the
 * pictures the game makes of them).
 */
function describePackage(abs) {
    const entries = readIndex(abs);
    if (!entries) return { broken: true, keys: [], cas: 0, objects: 0, tuning: 0, thumb: null, instances: [] };
    const keys = [];
    let cas = 0;
    let objects = 0;
    let tuning = 0;
    const instances = [];
    for (const e of entries) {
        if (e.type === CASP) {
            cas += 1;
            instances.push(e.instance);
        } else if (OBJECT_TYPES.has(e.type)) {
            objects += 1;
            if (e.type === 0x319e4f1d) instances.push(e.instance);
        } else if (e.type === SIMDATA || !ASSET_TYPES.has(e.type)) tuning += 1;
        if (!ASSET_TYPES.has(e.type)) keys.push(keyOf(e));
    }
    let thumb = null;
    for (const type of THUMB_TYPES) {
        const found = entries.filter((e) => e.type === type).sort((a, b) => b.size - a.size)[0];
        if (found) {
            thumb = { offset: found.offset, stored: found.stored, size: found.size, compression: found.compression };
            break;
        }
    }
    return { keys, cas, objects, tuning, thumb, instances: instances.slice(0, 8) };
}

async function describeScript(abs) {
    try {
        const modules = await withZip(abs, async (dir) =>
            dir.files.filter((f) => f.type !== "Directory" && /\.pyc?$/i.test(f.path)).map((f) => f.path.replace(/\\/g, "/").replace(/\.pyc?$/i, "").toLowerCase())
        );
        return { modules: [...new Set(modules)] };
    } catch {
        return { modules: [], broken: true };
    }
}

/* What each file holds, read afresh only when it's new or changed. -> Map(abs -> info) */
async function contents(list) {
    const known = loadCache();
    const out = new Map();
    let changed = false;
    for (const item of list) {
        let stat;
        try {
            stat = fs.statSync(item.abs);
        } catch {
            continue;
        }
        const stamp = `${stat.size}:${Math.round(stat.mtimeMs)}`;
        const cached = known[item.abs];
        if (cached?.stamp === stamp) {
            out.set(item.abs, cached.info);
            continue;
        }
        const info = /\.ts4script$/i.test(item.abs) ? await describeScript(item.abs) : describePackage(item.abs);
        known[item.abs] = { stamp, info };
        out.set(item.abs, info);
        changed = true;
    }
    if (changed) saveCache();
    return out;
}

/* ---------------- what clashes ---------------- */

/* The name a tuning resource gives itself (n="buff_Happy"). */
function tuningName(abs, key) {
    const [type, group, instance] = key.split(":");
    const entry = (readIndex(abs) ?? []).find((e) => hex(e.type) === type && hex(e.group) === group && e.instance === instance);
    const data = entry && readResource(abs, entry, 4 * 1024 * 1024);
    if (!data) return null;
    const text = data.toString("utf8", 0, Math.min(data.length, 600));
    return text.match(/\sn="([^"]+)"/)?.[1] ?? null;
}

/*
 * Mods that change the same thing: [{ id, kind: "tuning" | "item" | "script", mods: [{ name, key }],
 * count, examples, severity }]. Only files that are on; files of one mod never clash with each other.
 */
async function conflicts(gameId = "sims4") {
    const list = files(gameId).filter((f) => f.enabled);
    const info = await contents(list);
    const label = (f) => f.owner ?? path.posix.basename(f.rel).replace(/\.(package|ts4script)$/i, "");
    const owners = new Map(list.map((f) => [f.abs, { name: label(f), key: f.key }]));

    const byKey = new Map();
    for (const f of list) {
        const i = info.get(f.abs);
        for (const k of i?.keys ?? []) byKey.set(k, [...(byKey.get(k) ?? []), f]);
        for (const m of i?.modules ?? []) byKey.set(`py:${m}`, [...(byKey.get(`py:${m}`) ?? []), f]);
    }

    const pairs = new Map();
    for (const [key, holders] of byKey) {
        const mods = [...new Map(holders.map((f) => [owners.get(f.abs).key, f])).values()];
        if (mods.length < 2) continue;
        const kind = key.startsWith("py:") ? "script" : key.startsWith(hex(CASP)) || [...OBJECT_TYPES].some((t) => key.startsWith(hex(t))) ? "item" : "tuning";
        const id = `${kind}|${mods.map((f) => owners.get(f.abs).key).sort().join("|")}`;
        const pair = pairs.get(id) ?? { id, kind, files: mods, keys: [] };
        pair.keys.push(key);
        pairs.set(id, pair);
    }

    return [...pairs.values()].map((pair) => {
        const examples = [];
        if (pair.kind === "tuning") {
            for (const key of pair.keys.filter((k) => !k.startsWith(hex(SIMDATA))).slice(0, 3)) {
                const name = tuningName(pair.files[0].abs, key);
                if (name) examples.push(name);
            }
        } else if (pair.kind === "script") {
            examples.push(...pair.keys.slice(0, 3).map((k) => k.slice(3).replace(/\//g, ".")));
        }
        return {
            id: pair.id,
            kind: pair.kind,
            mods: pair.files.map((f) => owners.get(f.abs)),
            count: pair.kind === "tuning" ? pair.keys.filter((k) => !k.startsWith(hex(SIMDATA))).length || pair.keys.length : pair.keys.length,
            examples,
            severity: pair.kind === "item" ? "warn" : "error",
        };
    });
}

/* ---------------- the CC browser ---------------- */

const CATEGORY = (i) => (i.cas ? "Create a Sim" : i.objects ? "Build/Buy" : i.tuning ? "Gameplay" : i.modules ? "Script" : "Other");

/* Every package and script mod with what it is: [{ rel, key, name, folder, category, size, enabled, picture, owner }]. */
async function catalogue(gameId = "sims4") {
    const list = files(gameId);
    const info = await contents(list);
    return list
        .map((f) => {
            const i = info.get(f.abs) ?? {};
            let size = 0;
            try {
                size = fs.statSync(f.abs).size;
            } catch {
                size = 0;
            }
            return {
                rel: f.rel,
                key: f.key,
                name: path.posix.basename(f.rel).replace(/\.(package|ts4script)$/i, "").replace(/[_]+/g, " ").trim(),
                folder: path.posix.dirname(f.rel) === "." ? "" : path.posix.dirname(f.rel),
                category: /\.ts4script$/i.test(f.rel) ? "Script" : CATEGORY(i),
                items: (i.cas ?? 0) + (i.objects ?? 0),
                size,
                enabled: f.enabled,
                picture: Boolean(i.thumb || i.instances?.length),
                owner: f.owner,
                broken: Boolean(i.broken),
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------------- pictures ---------------- */

let thumbCache = null;

/* The game's own pictures of CC (localthumbcache.package): Map(instance -> entry). */
function gameThumbs(loc) {
    const file = loc.docsDir && path.join(loc.docsDir, "localthumbcache.package");
    if (!file || !fs.existsSync(file)) return { file: null, byInstance: new Map() };
    const stamp = fs.statSync(file).mtimeMs;
    if (thumbCache?.stamp === stamp) return thumbCache;
    const byInstance = new Map();
    for (const e of readIndex(file) ?? []) {
        if (!THUMB_TYPES.includes(e.type)) continue;
        const best = byInstance.get(e.instance);
        if (!best || e.size > best.size) byInstance.set(e.instance, e);
    }
    thumbCache = { stamp, file, byInstance };
    return thumbCache;
}

/*
 * The game's thumbnails are JPEGs with their transparency as a PNG tucked into an "ALFA"
 * block, written so that a few stray bytes follow it, which most image readers refuse.
 * -> the JPEG with only its well-formed parts, and the transparency PNG.
 */
function splitJpeg(data) {
    const out = [data.subarray(0, 2)];
    let alpha = null;
    let i = 2;
    while (i < data.length - 3) {
        if (data[i] !== 0xff || data[i + 1] === 0x00 || data[i + 1] === 0xff) {
            i += 1;
            continue;
        }
        const marker = data[i + 1];
        const length = data.readUInt16BE(i + 2);
        const segment = data.subarray(i, i + 2 + length);
        if (marker === 0xe0 && segment.toString("latin1", 4, 8) === "ALFA") alpha = segment.subarray(12, 12 + segment.readUInt32BE(8));
        else out.push(segment);
        if (marker === 0xda) {
            out.push(data.subarray(i + 2 + length));
            break;
        }
        i += 2 + length;
    }
    return { jpeg: Buffer.concat(out), alpha };
}

/* A picture for the page: { src, alpha } (alpha is the transparency, when there is one), or null. */
function asPicture(data) {
    if (!data || data.length < 8) return null;
    if (data[0] === 0x89 && data[1] === 0x50) return { src: `data:image/png;base64,${data.toString("base64")}`, alpha: null };
    if (data[0] !== 0xff || data[1] !== 0xd8) return null;
    const { jpeg, alpha } = splitJpeg(data);
    return { src: `data:image/jpeg;base64,${jpeg.toString("base64")}`, alpha: alpha?.length ? `data:image/png;base64,${alpha.toString("base64")}` : null };
}

/* Pictures for some files, by their rel path: { rel: { src, alpha } | null }. */
async function pictures(gameId, rels) {
    const loc = locate(gameId);
    const list = files(gameId).filter((f) => rels.includes(f.rel));
    const info = await contents(list);
    const out = {};
    const game = gameThumbs(loc);
    for (const f of list) {
        const i = info.get(f.abs);
        let picture = i?.thumb ? asPicture(readResource(f.abs, i.thumb, 4 * 1024 * 1024)) : null;
        if (!picture && game.file) {
            for (const instance of i?.instances ?? []) {
                const entry = game.byInstance.get(instance);
                if (entry && (picture = asPicture(readResource(game.file, entry, 4 * 1024 * 1024)))) break;
            }
        }
        out[f.rel] = picture;
    }
    return out;
}

module.exports = { files, contents, conflicts, catalogue, pictures };
