const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");

/*
 * What a mod jar is, from inside it: its mod IDs, name and version (fabric.mod.json,
 * quilt.mod.json or a Forge/NeoForge mods.toml), the mods it requires, the mod IDs of the
 * jars bundled inside it, the Java packages its code is in, and its mixin configs. Crash
 * help uses these to tie a crash back to a mod, and adding a mod uses them to fetch what
 * it needs. Read once per file version, then kept.
 */

const cache = new Map();

// What a jar we can't read, or a file that isn't a mod, is known to contain.
const EMPTY = { ids: [], name: null, version: null, packages: [], mixinConfigs: [], depends: [], provides: [], authors: [], icon: null };

// Packages that belong to Minecraft, Java or a loader, never to a mod.
const NOT_A_MOD = /^(net\/minecraft|com\/mojang|java|javax|jdk|sun|org\/lwjgl|org\/spongepowered|net\/fabricmc|org\/quiltmc|cpw\/mods|net\/neoforged\/fml|net\/minecraftforge\/fml|io\/netty|com\/google|org\/apache|it\/unimi|org\/slf4j|kotlin|org\/objectweb)\//;

async function readEntry(entries, name) {
    const entry = entries.find((e) => e.path === name);
    return entry ? (await entry.buffer()).toString("utf8") : null;
}

/* A mods.toml's [[mods]] and [[dependencies.x]] tables, as plain key/value maps. */
function tomlTables(text) {
    const tables = [];
    let current = null;
    for (const line of text.split(/\r?\n/)) {
        const header = line.match(/^\s*\[\[\s*([\w.-]+)\s*\]\]/) ?? line.match(/^\s*\[\s*([\w.-]+)\s*\]/);
        if (header) {
            current = { name: header[1], values: {} };
            tables.push(current);
            continue;
        }
        const pair = line.match(/^\s*(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(true|false))/);
        if (pair && current) current.values[pair[1]] = pair[2] ?? pair[3] ?? pair[4];
    }
    return tables;
}

function fromToml(text) {
    const tables = tomlTables(text);
    const mods = tables.filter((table) => table.name === "mods");
    const ids = mods.map((table) => table.values.modId).filter(Boolean);
    const name = mods[0]?.values.displayName ?? null;
    const version = mods[0]?.values.version ?? null;
    const authors = (mods[0]?.values.authors ?? tables[0]?.values.authors ?? "").split(/,\s*|\s+and\s+/).map((a) => a.trim()).filter(Boolean);
    const icon = mods[0]?.values.logoFile ?? tables[0]?.values.logoFile ?? null;
    // Required: NeoForge says type="required", Forge says mandatory=true. Server-only ones don't count.
    const depends = tables
        .filter((table) => table.name.startsWith("dependencies"))
        .filter(({ values }) => (values.type ? /^required$/i.test(values.type) : values.mandatory === "true") && !/^server$/i.test(values.side ?? ""))
        .map(({ values }) => values.modId)
        .filter(Boolean);
    return { ids, name, version: version && !version.includes("${") ? version : null, depends, authors, icon };
}

/* People named in a fabric.mod.json / quilt.mod.json ("Alice", { name: "Bob" }, { Bob: "Owner" }). */
function fabricAuthors(json) {
    const list = json.quilt_loader ? Object.keys(json.quilt_loader.metadata?.contributors ?? {}) : [].concat(json.authors ?? []);
    return list.map((author) => (typeof author === "string" ? author : author?.name)).filter(Boolean);
}

/* The path of a fabric.mod.json's icon, the largest if it lists several sizes. */
function fabricIcon(json) {
    const icon = json.quilt_loader ? json.quilt_loader.metadata?.icon : json.icon;
    if (!icon) return null;
    if (typeof icon === "string") return icon;
    const sizes = Object.keys(icon).map(Number).filter((n) => n <= 256).sort((a, b) => b - a);
    return icon[String(sizes[0] ?? Object.keys(icon)[0])] ?? null;
}

const parseLoose = (text) => JSON.parse(text.replace(/^\uFEFF/, "").replace(/[\u0000-\u001f]+/g, " "));

/* The mods a fabric.mod.json or quilt.mod.json says it can't run without. */
function fabricDepends(json) {
    if (json.quilt_loader) {
        return [].concat(json.quilt_loader.depends ?? [])
            .filter((dep) => typeof dep === "string" || (dep && typeof dep === "object" && !Array.isArray(dep) && !dep.optional && !dep.unless))
            .map((dep) => (typeof dep === "string" ? dep : dep.id));
    }
    return Object.keys(json.depends ?? {});
}

/* The mod IDs inside jars bundled in this one (Fabric API's modules, libraries a mod carries). */
async function nestedIds(entries, paths) {
    const ids = [];
    for (const nested of paths.slice(0, 200)) {
        const entry = entries.find((e) => e.path === nested);
        if (!entry) continue;
        try {
            const inner = (await unzipper.Open.buffer(await entry.buffer())).files;
            const fabric = (await readEntry(inner, "fabric.mod.json")) ?? (await readEntry(inner, "quilt.mod.json"));
            if (fabric) {
                const json = parseLoose(fabric);
                const meta = json.quilt_loader ?? json;
                if (meta.id) ids.push(meta.id);
                for (const provided of [].concat(json.provides ?? meta.provides ?? [])) ids.push(typeof provided === "string" ? provided : provided?.id);
            }
            for (const toml of ["META-INF/neoforge.mods.toml", "META-INF/mods.toml"]) {
                const text = await readEntry(inner, toml);
                if (text) ids.push(...fromToml(text).ids);
            }
        } catch {
            // Not a jar we can read; it provides nothing we know of.
        }
    }
    return ids;
}

async function readJar(file) {
    const directory = await unzipper.Open.file(file);
    const entries = directory.files;
    const info = { ...EMPTY, ids: [], packages: [], mixinConfigs: [], depends: [], provides: [], authors: [] };
    const nested = [];

    const fabric = (await readEntry(entries, "fabric.mod.json")) ?? (await readEntry(entries, "quilt.mod.json"));
    if (fabric) {
        try {
            const json = parseLoose(fabric);
            const meta = json.quilt_loader ?? json;
            if (meta.id) info.ids.push(meta.id);
            info.name = json.name ?? meta.metadata?.name ?? null;
            info.version = meta.version ?? null;
            for (const mixin of [].concat(json.mixins ?? json.mixin ?? [])) {
                info.mixinConfigs.push(typeof mixin === "string" ? mixin : mixin.config);
            }
            for (const provided of [].concat(json.provides ?? meta.provides ?? [])) {
                const id = typeof provided === "string" ? provided : provided?.id;
                if (id) info.ids.push(id);
            }
            info.depends.push(...fabricDepends(json));
            info.authors.push(...fabricAuthors(json));
            info.icon = fabricIcon(json);
            nested.push(...[].concat(json.jars ?? meta.jars ?? []).map((jar) => (typeof jar === "string" ? jar : jar?.file)).filter(Boolean));
        } catch {
            // A broken fabric.mod.json: the jar is still known by its file name.
        }
    }

    for (const toml of ["META-INF/neoforge.mods.toml", "META-INF/mods.toml"]) {
        const text = await readEntry(entries, toml);
        if (text) {
            const found = fromToml(text);
            info.ids.push(...found.ids);
            info.name ??= found.name;
            info.version ??= found.version;
            info.depends.push(...found.depends);
            if (!info.authors.length) info.authors.push(...found.authors);
            info.icon ??= found.icon;
        }
    }
    // Forge and NeoForge bundle jars here.
    nested.push(...entries.filter((e) => /^META-INF\/jarjar\/[^/]+\.jar$/.test(e.path)).map((e) => e.path));
    info.provides = [...new Set((await nestedIds(entries, nested)).filter(Boolean))];

    const packages = new Set();
    for (const entry of entries) {
        if (entry.type === "File" && entry.path.endsWith(".class")) {
            const dir = path.posix.dirname(entry.path);
            if (dir !== "." && !NOT_A_MOD.test(dir + "/")) packages.add(dir);
        } else if (!entry.path.includes("/") && /mixins?\.json$/.test(entry.path)) {
            info.mixinConfigs.push(entry.path);
        }
    }
    // The shortest few package roots are enough to recognise its code.
    info.packages = [...packages].sort((a, b) => a.length - b.length).filter((dir, i, all) => !all.slice(0, i).some((root) => dir.startsWith(root + "/"))).slice(0, 40);
    info.ids = [...new Set(info.ids.filter(Boolean))];
    info.depends = [...new Set(info.depends.filter((id) => id && !info.ids.includes(id)))];
    info.authors = [...new Set(info.authors)].slice(0, 6);
    info.mixinConfigs = [...new Set(info.mixinConfigs.filter(Boolean))];
    return info;
}

/* What's in one jar, or null if it can't be read. */
async function modInfo(file) {
    let stat;
    try {
        stat = fs.statSync(file);
    } catch {
        return null;
    }
    const key = `${file}:${stat.size}:${stat.mtimeMs}`;
    if (!cache.has(key)) cache.set(key, readJar(file).catch(() => null));
    return cache.get(key);
}

/* Every jar in a mods folder, enabled or not, with what's in it. */
async function modsIn(modsDir) {
    let files = [];
    try {
        files = fs.readdirSync(modsDir).filter((f) => /\.jar(\.disabled)?$/i.test(f));
    } catch {
        return [];
    }
    const mods = await Promise.all(
        files.map(async (fileName) => {
            const info = await modInfo(path.join(modsDir, fileName));
            return { fileName, enabled: !fileName.endsWith(".disabled"), ...(info ?? EMPTY) };
        })
    );
    return mods.map((mod) => ({ ...mod, name: mod.name ?? mod.fileName.replace(/\.jar(\.disabled)?$/i, "") }));
}

module.exports = { modInfo, modsIn, NOT_A_MOD };
