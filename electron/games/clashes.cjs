const fs = require("fs");
const path = require("path");
const { getGame } = require("./registry.cjs");
const { locate } = require("./detect.cjs");
const store = require("./store.cjs");
const plugins = require("./plugins.cjs");
const simsIndex = require("./simsIndex.cjs");
const { readSettings, writeSettings } = require("./storage.cjs");

/*
 * Mods that change the same thing inside the game, for every game (shared files are the
 * file-conflict check's):
 *  - The Sims 4: packages with the same tuning, the same CC item twice, script mods with
 *    the same Python modules;
 *  - Skyrim and Fallout 4: plugins changing the same records; the later one in the load
 *    order wins, unless a patch loaded after both combines them;
 *  - Cyberpunk 2077: redscript mods replacing the same function (redscript then fails);
 *  - Stardew Valley: Content Patcher packs loading the same asset (SMAPI applies neither).
 * GTA V's mods only conflict through files, which that check covers.
 *
 * -> [{ id, kind, mods: [{ name, key }], count, examples, severity, winner?, what }]
 */

const SIZE_LIMIT = 256 * 1024 * 1024;

/* ---------------- Skyrim and Fallout 4 ---------------- */

const recordCache = new Map();

/*
 * The records a plugin changes that come from other plugins: Map("master.esm:objectId" -> type).
 * Records are read by their headers alone (24 bytes each); groups are walked straight through.
 */
function overrides(file) {
    let stat;
    try {
        stat = fs.statSync(file);
    } catch {
        return new Map();
    }
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    const cached = recordCache.get(file);
    if (cached?.stamp === stamp) return cached.map;
    const map = new Map();
    if (stat.size > SIZE_LIMIT) return map;
    const masters = plugins.header(file)?.masters ?? [];
    const data = fs.readFileSync(file);
    let pos = 0;
    while (pos + 24 <= data.length) {
        const type = data.toString("latin1", pos, pos + 4);
        const size = data.readUInt32LE(pos + 4);
        if (type === "GRUP") {
            pos += 24;
            continue;
        }
        if (type !== "TES4") {
            const formId = data.readUInt32LE(pos + 12);
            const index = formId >>> 24;
            if (index < masters.length) map.set(`${masters[index].toLowerCase()}:${(formId & 0xffffff).toString(16)}`, type);
        }
        pos += 24 + size;
    }
    recordCache.set(file, { stamp, map });
    return map;
}

function bethesda(game, loc) {
    if (!loc.gameDir) return [];
    const order = plugins.loadOrder(game, loc).plugins.filter((p) => p.active);
    const data = path.join(loc.gameDir, "Data");
    const keyOf = (name) => {
        const mod = store.readState(game.id).mods.find((m) => (m.plugins ?? []).some((p) => p.toLowerCase() === name.toLowerCase()));
        return mod ? `m:${mod.id}` : `p:game:Data/${name}`;
    };
    const touched = new Map();
    order.forEach((plugin, index) => {
        for (const [record, type] of overrides(path.join(data, plugin.name))) {
            const list = touched.get(record) ?? [];
            list.push({ index, type });
            touched.set(record, list);
        }
    });
    const pairs = new Map();
    for (const list of touched.values()) {
        if (list.length < 2) continue;
        const winner = list[list.length - 1];
        const winnerMasters = new Set(order[winner.index].masters.map((m) => m.toLowerCase()));
        for (const other of list.slice(0, -1)) {
            // A patch loaded after both, made with both as its masters, means they've been combined.
            if (winnerMasters.has(order[other.index].name.toLowerCase())) continue;
            const id = `${order[other.index].name}>${order[winner.index].name}`;
            const pair = pairs.get(id) ?? { loser: order[other.index], winner: order[winner.index], types: {} };
            pair.types[winner.type] = (pair.types[winner.type] ?? 0) + 1;
            pairs.set(id, pair);
        }
    }
    return [...pairs.entries()].map(([id, pair]) => {
        const count = Object.values(pair.types).reduce((a, b) => a + b, 0);
        return {
            id: `records|${id}`,
            kind: "records",
            mods: [
                { name: pair.loser.name, key: keyOf(pair.loser.name) },
                { name: pair.winner.name, key: keyOf(pair.winner.name) },
            ],
            winner: pair.winner.name,
            count,
            examples: Object.entries(pair.types)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([type, n]) => `${type} ×${n}`),
            severity: "warn",
        };
    });
}

/* Makes one plugin win over another by loading it after it (where its masters allow). */
function loadAfter(gameId, name, after) {
    const game = getGame(gameId);
    const loc = locate(gameId);
    const order = plugins.loadOrder(game, loc).plugins;
    const moving = order.find((p) => p.name === name);
    const others = order.filter((p) => p.name !== name);
    const at = others.findIndex((p) => p.name === after);
    if (!moving || at < 0) throw new Error("Those plugins aren't in the load order.");
    if (order.find((p) => p.name === after)?.masters.some((m) => m.toLowerCase() === name.toLowerCase())) {
        throw new Error(`${after} needs ${name} to load first, so it can't win over it: look for a patch that combines them.`);
    }
    const next = plugins.sorted([...others.slice(0, at + 1), moving, ...others.slice(at + 1)]);
    plugins.setOrder(game, loc, next.map((p) => ({ name: p.name, active: p.active })));
    store.touch(gameId);
}

/* ---------------- Cyberpunk 2077: redscript ---------------- */

function cyberpunk(game, loc) {
    if (!loc.gameDir) return [];
    const root = path.join(loc.gameDir, "r6", "scripts");
    const state = store.readState(game.id);
    const ownerOf = (rel) => {
        const to = `r6/scripts/${rel}`.toLowerCase();
        const mod = state.mods.find((m) => m.files.some((f) => f.to.toLowerCase() === to));
        const top = rel.split("/")[0];
        return mod ? { name: mod.name, key: `m:${mod.id}` } : { name: top.replace(/\.reds$/i, ""), key: `h:game:r6/scripts/${top}` };
    };
    const replaced = new Map();
    const walk = (dir, rel, depth) => {
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const child = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (depth < 6) walk(path.join(dir, entry.name), child, depth + 1);
                continue;
            }
            if (!/\.reds$/i.test(entry.name)) continue;
            let text = "";
            try {
                text = fs.readFileSync(path.join(dir, entry.name), "utf8");
            } catch {
                continue;
            }
            const owner = ownerOf(child);
            const found = [
                ...[...text.matchAll(/@replaceMethod\(\s*([\w.]+)\s*\)[\s\S]{0,200}?\bfunc\s+(\w+)\s*\(/g)].map((m) => `${m[1]}.${m[2]}`),
                ...[...text.matchAll(/@replaceGlobal\(\s*\)[\s\S]{0,200}?\bfunc\s+(\w+)\s*\(/g)].map((m) => m[1]),
            ];
            for (const fn of found) {
                const list = replaced.get(fn) ?? new Map();
                list.set(owner.key, owner);
                replaced.set(fn, list);
            }
        }
    };
    walk(root, "", 0);
    const pairs = new Map();
    for (const [fn, owners] of replaced) {
        if (owners.size < 2) continue;
        const mods = [...owners.values()];
        const id = `redscript|${mods.map((m) => m.key).sort().join("|")}`;
        const pair = pairs.get(id) ?? { mods, functions: [] };
        pair.functions.push(fn);
        pairs.set(id, pair);
    }
    return [...pairs.entries()].map(([id, pair]) => ({ id, kind: "redscript", mods: pair.mods, count: pair.functions.length, examples: pair.functions.slice(0, 3), severity: "error" }));
}

/* ---------------- Stardew Valley: Content Patcher ---------------- */

function readJson(file) {
    try {
        const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
        return JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1").replace(/,\s*([}\]])/g, "$1"));
    } catch {
        return null;
    }
}

function stardew(game, loc) {
    if (!loc.gameDir) return [];
    const mods = path.join(loc.gameDir, "Mods");
    const state = store.readState(game.id);
    const loads = new Map();
    let folders = [];
    try {
        folders = fs.readdirSync(mods, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
        return [];
    }
    for (const folder of folders) {
        const content = readJson(path.join(mods, folder, "content.json"));
        if (!content?.Changes) continue;
        const manifest = readJson(path.join(mods, folder, "manifest.json"));
        const mod = state.mods.find((m) => m.files.some((f) => f.to.toLowerCase().startsWith(`mods/${folder.toLowerCase()}/`)));
        const owner = mod ? { name: mod.name, key: `m:${mod.id}` } : { name: manifest?.Name ?? folder, key: `h:game:Mods/${folder}` };
        for (const change of content.Changes) {
            if (String(change?.Action).toLowerCase() !== "load" || !change.Target) continue;
            for (const target of String(change.Target).split(",")) {
                const t = target.trim().replace(/\\/g, "/").toLowerCase();
                if (!t || t.includes("{{")) continue;
                const list = loads.get(t) ?? new Map();
                list.set(owner.key, owner);
                loads.set(t, list);
            }
        }
    }
    const pairs = new Map();
    for (const [target, owners] of loads) {
        if (owners.size < 2) continue;
        const list = [...owners.values()];
        const id = `load|${list.map((m) => m.key).sort().join("|")}`;
        const pair = pairs.get(id) ?? { mods: list, targets: [] };
        pair.targets.push(target);
        pairs.set(id, pair);
    }
    return [...pairs.entries()].map(([id, pair]) => ({ id, kind: "load", mods: pair.mods, count: pair.targets.length, examples: pair.targets.slice(0, 3), severity: "error" }));
}

/* ---------------- every game ---------------- */

async function find(gameId) {
    const game = getGame(gameId);
    const loc = locate(gameId);
    try {
        if (gameId === "sims4") return await simsIndex.conflicts(gameId);
        if (game.bethesda) return bethesda(game, loc);
        if (gameId === "cyberpunk2077") return cyberpunk(game, loc);
        if (gameId === "stardew") return stardew(game, loc);
    } catch {
        // Looked at again next time.
    }
    return [];
}

/* Every conflict, those marked fine with hidden: true. */
async function check(gameId) {
    const hidden = new Set(readSettings().clashesHidden?.[gameId] ?? []);
    return (await find(gameId)).map((clash) => ({ ...clash, hidden: hidden.has(clash.id) }));
}

/* Marks a conflict as fine (or not), so it stops being shown and counted. */
function hide(gameId, id, hidden) {
    const settings = readSettings();
    settings.clashesHidden ??= {};
    const now = new Set(settings.clashesHidden[gameId] ?? []);
    if (hidden) now.add(id);
    else if (id === "*") now.clear();
    else now.delete(id);
    settings.clashesHidden[gameId] = [...now];
    writeSettings(settings);
    return check(gameId);
}

module.exports = { check, hide, loadAfter, overrides };
