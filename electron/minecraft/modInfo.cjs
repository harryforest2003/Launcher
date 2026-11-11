const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");

/*
 * What a mod jar is, from inside it: its mod IDs, name and version (fabric.mod.json,
 * quilt.mod.json or a Forge/NeoForge mods.toml), the Java packages its code is in, and
 * its mixin configs. Crash help uses these to tie a crash back to a mod. Read once per
 * file version, then kept.
 */

const cache = new Map();

// Packages that belong to Minecraft, Java or a loader, never to a mod.
const NOT_A_MOD = /^(net\/minecraft|com\/mojang|java|javax|jdk|sun|org\/lwjgl|org\/spongepowered|net\/fabricmc|org\/quiltmc|cpw\/mods|net\/neoforged\/fml|net\/minecraftforge\/fml|io\/netty|com\/google|org\/apache|it\/unimi|org\/slf4j|kotlin|org\/objectweb)\//;

async function readEntry(entries, name) {
    const entry = entries.find((e) => e.path === name);
    return entry ? (await entry.buffer()).toString("utf8") : null;
}

function fromToml(text) {
    const ids = [...text.matchAll(/^\s*modId\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
    const name = text.match(/^\s*displayName\s*=\s*"([^"]+)"/m)?.[1] ?? null;
    const version = text.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
    return { ids, name, version: version && !version.includes("${") ? version : null };
}

async function readJar(file) {
    const directory = await unzipper.Open.file(file);
    const entries = directory.files;
    const info = { ids: [], name: null, version: null, packages: [], mixinConfigs: [] };

    const fabric = (await readEntry(entries, "fabric.mod.json")) ?? (await readEntry(entries, "quilt.mod.json"));
    if (fabric) {
        try {
            const json = JSON.parse(fabric.replace(/^﻿/, "").replace(/[\u0000-\u001f]+/g, " "));
            const meta = json.quilt_loader ?? json;
            if (meta.id) info.ids.push(meta.id);
            info.name = json.name ?? meta.metadata?.name ?? null;
            info.version = meta.version ?? null;
            for (const mixin of [].concat(json.mixins ?? json.mixin ?? [])) {
                info.mixinConfigs.push(typeof mixin === "string" ? mixin : mixin.config);
            }
            for (const provided of [].concat(json.provides ?? [])) if (typeof provided === "string") info.ids.push(provided);
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
        }
    }

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
            return { fileName, enabled: !fileName.endsWith(".disabled"), ...(info ?? { ids: [], name: null, version: null, packages: [], mixinConfigs: [] }) };
        })
    );
    return mods.map((mod) => ({ ...mod, name: mod.name ?? mod.fileName.replace(/\.jar(\.disabled)?$/i, "") }));
}

module.exports = { modInfo, modsIn, NOT_A_MOD };
