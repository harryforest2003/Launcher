const fs = require("fs");
const path = require("path");

/*
 * The Bethesda games' load order: plugins.txt, one plugin a line, "*" in front of the ones
 * turned on (older games list only those, see read). It's kept in AppData\Local\<game> on Windows; for a game run through
 * CrossOver or Whisky, in the same place inside its bottle.
 */

function appDataLocal(gameDir) {
    if (process.platform === "win32" && process.env.LOCALAPPDATA) return process.env.LOCALAPPDATA;
    const at = gameDir?.indexOf(`${path.sep}drive_c${path.sep}`) ?? -1;
    if (at < 0) return null;
    const users = path.join(gameDir.slice(0, at), "drive_c", "users");
    let names = [];
    try {
        names = fs.readdirSync(users).filter((name) => name !== "Public");
    } catch {
        return null;
    }
    const user = names.find((name) => name === "crossover") ?? names[0];
    return user ? path.join(users, user, "AppData", "Local") : null;
}

/* Where plugins.txt is: the folder that already has one, else the first. Null where there's none. */
function fileFor(game, loc) {
    const local = appDataLocal(loc.gameDir);
    if (!local) return null;
    const options = game.bethesda.appData.map((folder) => path.join(local, folder, "plugins.txt"));
    return options.find((file) => fs.existsSync(file)) ?? options[0];
}

function need(game, loc) {
    const file = fileFor(game, loc);
    if (!file) throw new Error(`${game.name}'s load order (plugins.txt) is only on Windows, or in a CrossOver bottle`);
    return file;
}

const lower = (name) => name.toLowerCase();
const unique = (names) => {
    const seen = new Set();
    return names.filter((name) => !seen.has(lower(name)) && seen.add(lower(name)));
};
function linesOf(file) {
    try {
        return fs.readFileSync(file, "utf8").split(/\r?\n/);
    } catch {
        return [];
    }
}
function writeLines(file, lines) {
    const text = lines.join("\r\n").replace(/(\r\n)+$/, "");
    fs.writeFileSync(file, `${text}\r\n`);
}
function mtime(file) {
    try {
        return fs.statSync(file).mtimeMs;
    } catch {
        return Infinity;
    }
}
/* The plugin files in the game's Data folder. */
function dataPlugins(loc) {
    try {
        return fs.readdirSync(path.join(loc.gameDir, "Data")).filter((name) => PLUGIN.test(name));
    } catch {
        return [];
    }
}

/* [{ name, active, line }] in order; comments and blank lines are kept as lines without a name. */
function read(game, loc) {
    const file = need(game, loc);
    const lines = linesOf(file);
    while (lines.length && !lines.at(-1).trim()) lines.pop(); // The file ends with a line break.
    const format = game.bethesda.format ?? "star";
    if (format === "star") {
        return lines.map((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) return { name: null, active: false, line };
            return { name: trimmed.replace(/^\*/, ""), active: trimmed.startsWith("*"), line };
        });
    }
    // Older games list only the plugins that are on, without "*". The rest of the order is in
    // loadorder.txt beside it (Skyrim before Special Edition), or the plugin files' dates
    // (Oblivion, Fallout 3, New Vegas).
    const comments = lines.filter((line) => line.trim().startsWith("#")).map((line) => ({ name: null, active: false, line }));
    const on = unique(lines.map((line) => line.trim()).filter((line) => line && !line.startsWith("#")));
    const onSet = new Set(on.map(lower));
    let full;
    if (format === "plain") {
        full = unique([...linesOf(path.join(path.dirname(file), "loadorder.txt")).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")), ...on]);
    } else {
        const data = path.join(loc.gameDir, "Data");
        const dated = dataPlugins(loc).map((name) => ({ name, at: mtime(path.join(data, name)) }));
        dated.sort((a, b) => a.at - b.at || (lower(a.name) < lower(b.name) ? -1 : 1));
        full = unique([...dated.map((entry) => entry.name), ...on]);
    }
    // The game goes by the on list's order for the plugins that are on.
    let next = 0;
    const names = full.map((name) => (onSet.has(lower(name)) ? on[next++] : name));
    return [...comments, ...names.map((name) => ({ name, active: onSet.has(lower(name)) }))];
}

function write(game, loc, lines) {
    const file = need(game, loc);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const format = game.bethesda.format ?? "star";
    if (format === "star") {
        writeLines(file, lines.map((entry) => (entry.name ? `${entry.active ? "*" : ""}${entry.name}` : entry.line)));
        return;
    }
    // The game's own plugins first, then the rest as given.
    const present = new Map(dataPlugins(loc).map((name) => [lower(name), name]));
    const fixed = fixedPlugins(game, loc, new Set(present.keys())).map((name) => present.get(name));
    const fixedSet = new Set(fixed.map(lower));
    const order = [...fixed.map((name) => ({ name, active: true })), ...lines.filter((entry) => entry.name && !fixedSet.has(lower(entry.name)))];
    const comments = lines.filter((entry) => !entry.name && entry.line?.trim()).map((entry) => entry.line);
    // Skyrim loads its own masters without them listed; the older games need theirs listed.
    const listed = order.filter((entry) => entry.active && (format === "dates" || !fixedSet.has(lower(entry.name))));
    writeLines(file, [...comments, ...listed.map((entry) => entry.name)]);
    if (format === "plain") {
        writeLines(path.join(path.dirname(file), "loadorder.txt"), order.map((entry) => entry.name));
        return;
    }
    // Each plugin a minute after the one before it, from the earliest date they have now.
    const data = path.join(loc.gameDir, "Data");
    const files = order.map((entry) => path.join(data, entry.name)).filter((full) => fs.existsSync(full));
    const start = Math.min(...files.map(mtime), Date.UTC(2010, 0, 1));
    files.forEach((full, i) => {
        const at = new Date(start + i * 60 * 1000);
        fs.utimesSync(full, at, at);
    });
}

/* Turns plugins on or off; ones not listed yet are added at the end. */
function activate(game, loc, names, active) {
    const lines = read(game, loc);
    for (const name of names) {
        const entry = lines.find((line) => line.name && line.name.toLowerCase() === name.toLowerCase());
        if (entry) entry.active = active;
        else if (active) lines.push({ name, active: true });
    }
    write(game, loc, lines);
}

function remove(game, loc, names) {
    const drop = new Set(names.map((name) => name.toLowerCase()));
    write(game, loc, read(game, loc).filter((line) => !line.name || !drop.has(line.name.toLowerCase())));
}

/* ---------------- plugin headers and the load order ---------------- */

/*
 * What a plugin's header says: { master, light, masters: [file names] }, or null if it
 * isn't one. The header is its first record (TES4), whose MAST entries name the plugins
 * it needs loaded before it.
 */
function header(file) {
    let buffer;
    let read = 0;
    try {
        const fd = fs.openSync(file, "r");
        buffer = Buffer.alloc(256 * 1024);
        read = fs.readSync(fd, buffer, 0, buffer.length, 0);
        fs.closeSync(fd);
    } catch {
        return null;
    }
    if (read < 24 || buffer.toString("latin1", 0, 4) !== "TES4") return null;
    const flags = buffer.readUInt32LE(8);
    const end = Math.min(24 + buffer.readUInt32LE(4), read);
    const masters = [];
    let pos = 24;
    let bigNext = null;
    while (pos + 6 <= end) {
        const type = buffer.toString("latin1", pos, pos + 4);
        const size = bigNext ?? buffer.readUInt16LE(pos + 4);
        bigNext = null;
        const data = buffer.subarray(pos + 6, pos + 6 + size);
        if (type === "XXXX") bigNext = data.readUInt32LE(0);
        else if (type === "MAST") masters.push(data.toString("latin1").replace(/\0[\s\S]*$/, ""));
        pos += 6 + size;
    }
    return { master: (flags & 0x1) !== 0, light: (flags & 0x200) !== 0, masters };
}

const PLUGIN = /\.(esp|esm|esl)$/i;
const OFFICIAL_CC = /^cc[a-z0-9]+\.(esl|esm)$/i;

/* Plugins the game always loads first, in its own order: the game's and its DLC, then Creation Club's. */
function fixedPlugins(game, loc, present) {
    const fixed = game.bethesda.official.filter((name) => present.has(name));
    let cc = [];
    try {
        // Creation Club's list; games without one have null.
        const ccc = game.bethesda.ccc !== undefined ? game.bethesda.ccc : game.id === "fallout4" ? "Fallout4.ccc" : "Skyrim.ccc";
        if (ccc) cc = fs.readFileSync(path.join(loc.gameDir, ccc), "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    } catch {
        // No Creation Club list.
    }
    const ccPresent = [...present].filter((name) => OFFICIAL_CC.test(name));
    const orderedCc = [...cc.map((n) => n.toLowerCase()).filter((n) => present.has(n)), ...ccPresent.filter((n) => !cc.some((c) => c.toLowerCase() === n))];
    return [...new Set([...fixed, ...orderedCc])];
}

/*
 * The load order: the plugins the game always loads first, then the rest in plugins.txt's
 * order (ones not in it yet at the end, off), each with what it needs and what's wrong:
 * { fixed: [names], plugins: [{ name, active, master, light, masters, problems }] }
 */
function loadOrder(game, loc) {
    const data = path.join(loc.gameDir, "Data");
    let files = [];
    try {
        files = fs.readdirSync(data).filter((name) => PLUGIN.test(name));
    } catch {
        files = [];
    }
    const byLower = new Map(files.map((name) => [name.toLowerCase(), name]));
    const present = new Set(byLower.keys());
    const fixedLower = fixedPlugins(game, loc, present);
    const fixed = fixedLower.map((name) => byLower.get(name));
    const fixedSet = new Set(fixedLower);

    let lines = [];
    try {
        lines = read(game, loc);
    } catch {
        lines = [];
    }
    const listed = lines.filter((line) => line.name && present.has(line.name.toLowerCase()) && !fixedSet.has(line.name.toLowerCase()));
    const seen = new Set(listed.map((line) => line.name.toLowerCase()));
    const order = [
        ...listed.map((line) => ({ name: byLower.get(line.name.toLowerCase()), active: line.active })),
        ...files.filter((name) => !seen.has(name.toLowerCase()) && !fixedSet.has(name.toLowerCase())).map((name) => ({ name, active: false })),
    ];

    const plugins = order.map((entry) => ({ ...entry, ...(header(path.join(data, entry.name)) ?? { master: /\.esm$/i.test(entry.name), light: /\.esl$/i.test(entry.name), masters: [] }) }));
    // ESM and ESL files count as masters whatever their header says.
    for (const plugin of plugins) if (/\.(esm|esl)$/i.test(plugin.name)) plugin.master = true;
    const position = new Map(plugins.map((plugin, i) => [plugin.name.toLowerCase(), i]));
    const activeSet = new Set(plugins.filter((p) => p.active).map((p) => p.name.toLowerCase()));
    plugins.forEach((plugin, i) => {
        plugin.problems = [];
        if (!plugin.active) return;
        for (const master of plugin.masters) {
            const lower = master.toLowerCase();
            if (fixedSet.has(lower)) continue;
            if (!present.has(lower)) plugin.problems.push({ kind: "missing", master });
            else if (!activeSet.has(lower)) plugin.problems.push({ kind: "off", master });
            // The game loads masters before everything else, wherever they're listed.
            else if (position.get(lower) > i && !(plugins[position.get(lower)].master && !plugin.master)) plugin.problems.push({ kind: "after", master });
        }
    });
    return { fixed, plugins };
}

/* Writes the load order: the given plugin names, in order, each on or off as given. */
function setOrder(game, loc, entries) {
    const comments = read(game, loc).filter((line) => !line.name);
    write(game, loc, [...comments, ...entries.map((entry) => ({ name: entry.name, active: entry.active }))]);
}

/*
 * The order the game needs, changing as little as possible: masters (ESM, ESL) first, and
 * every plugin after the ones it needs, otherwise in the order given.
 */
function sorted(plugins) {
    const byLower = new Map(plugins.map((plugin) => [plugin.name.toLowerCase(), plugin]));
    const out = [];
    const placed = new Set();
    const visiting = new Set();
    const place = (plugin) => {
        const lower = plugin.name.toLowerCase();
        if (placed.has(lower) || visiting.has(lower)) return;
        visiting.add(lower);
        for (const master of plugin.masters) {
            const needed = byLower.get(master.toLowerCase());
            if (needed) place(needed);
        }
        visiting.delete(lower);
        placed.add(lower);
        out.push(plugin);
    };
    for (const plugin of plugins.filter((p) => p.master)) place(plugin);
    for (const plugin of plugins.filter((p) => !p.master)) place(plugin);
    return out;
}

/*
 * What fixing the load order would change, without changing it:
 * { turnOn: [{ name, for }], turnOff: [{ name, needs, missing, official }], moved: [names],
 *   get: [{ master, for }], order: [{ name, active }] }
 *  - a master that isn't installed is to be got (from Nexus Mods), and what needs it stays
 *    on; one that comes with the game's DLC or Creation Club has what needs it turned off;
 *  - masters a plugin that's on needs are turned on;
 *  - then each plugin is put after what it needs, changing as little as it can.
 */
function fixPlan(game, loc) {
    const { fixed, plugins } = loadOrder(game, loc);
    const fixedSet = new Set(fixed.map((n) => n.toLowerCase()));
    const byLower = new Map(plugins.map((p) => [p.name.toLowerCase(), p]));
    const exists = (lower) => fixedSet.has(lower) || byLower.has(lower);

    // Plugins that can't load: a master missing, or a master that can't load.
    const unavailable = new Map();
    const check = (plugin, seen = new Set()) => {
        const lower = plugin.name.toLowerCase();
        if (unavailable.has(lower)) return unavailable.get(lower);
        if (seen.has(lower)) return null;
        seen.add(lower);
        let missing = null;
        for (const master of plugin.masters) {
            const m = master.toLowerCase();
            if (fixedSet.has(m)) continue;
            if (!exists(m)) {
                missing = master;
                break;
            }
            if (check(byLower.get(m), seen)) {
                missing = master;
                break;
            }
        }
        unavailable.set(lower, missing);
        return missing;
    };
    plugins.forEach((plugin) => check(plugin));

    // The file at the end of a chain of masters that isn't installed (C needs B needs Missing.esm -> Missing.esm).
    const rootMissing = (plugin, seen = new Set()) => {
        if (seen.has(plugin.name.toLowerCase())) return null;
        seen.add(plugin.name.toLowerCase());
        for (const master of plugin.masters) {
            const m = master.toLowerCase();
            if (fixedSet.has(m)) continue;
            if (!exists(m)) return master;
            const deeper = rootMissing(byLower.get(m), seen);
            if (deeper) return deeper;
        }
        return null;
    };
    const official = (name) => game.bethesda.official.includes(name.toLowerCase()) || OFFICIAL_CC.test(name);

    // A missing master is got (it's on Nexus Mods); only one that comes with the game's DLC
    // or Creation Club, which can't be got that way, has what needs it turned off.
    const active = new Map(plugins.map((p) => [p.name.toLowerCase(), p.active]));
    const turnOff = [];
    const get = [];
    for (const plugin of plugins) {
        const needs = unavailable.get(plugin.name.toLowerCase());
        if (!plugin.active || !needs) continue;
        const root = rootMissing(plugin) ?? needs;
        if (official(root)) {
            active.set(plugin.name.toLowerCase(), false);
            turnOff.push({ name: plugin.name, needs: root, missing: true, official: true });
        } else if (!get.some((g) => g.master.toLowerCase() === root.toLowerCase() && g.for === plugin.name)) {
            get.push({ master: root, for: plugin.name });
        }
    }
    const turnOn = [];
    const switchOn = (plugin, forName) => {
        for (const master of plugin.masters) {
            const m = master.toLowerCase();
            const needed = byLower.get(m);
            if (!needed || active.get(m)) continue;
            active.set(m, true);
            turnOn.push({ name: needed.name, for: forName });
            switchOn(needed, needed.name);
        }
    };
    for (const plugin of plugins) if (active.get(plugin.name.toLowerCase())) switchOn(plugin, plugin.name);

    const order = sorted(plugins);
    // The ones that loaded before something they need (the rest only shift along).
    const moved = plugins.filter((p) => p.problems.some((x) => x.kind === "after") && active.get(p.name.toLowerCase())).map((p) => p.name);
    return { turnOn, turnOff, moved, get, order: order.map((p) => ({ name: p.name, active: active.get(p.name.toLowerCase()) })) };
}

module.exports = { read, activate, remove, fileFor, appDataLocal, header, loadOrder, setOrder, sorted, fixPlan };
