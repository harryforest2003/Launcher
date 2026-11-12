const fs = require("fs");
const path = require("path");

/*
 * Skyrim's and Fallout 4's load order: plugins.txt, one plugin a line, "*" in front of the
 * ones turned on. It's kept in AppData\Local\<game> on Windows; for a game run through
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

/* [{ name, active, line }] in order; comments and blank lines are kept as lines without a name. */
function read(game, loc) {
    const file = need(game, loc);
    let text = "";
    try {
        text = fs.readFileSync(file, "utf8");
    } catch {
        return [];
    }
    const lines = text.split(/\r?\n/);
    while (lines.length && !lines.at(-1).trim()) lines.pop(); // The file ends with a line break.
    return lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return { name: null, active: false, line };
        return { name: trimmed.replace(/^\*/, ""), active: trimmed.startsWith("*"), line };
    });
}

function write(game, loc, lines) {
    const file = need(game, loc);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = lines
        .map((entry) => (entry.name ? `${entry.active ? "*" : ""}${entry.name}` : entry.line))
        .join("\r\n")
        .replace(/(\r\n)+$/, "");
    fs.writeFileSync(file, `${text}\r\n`);
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
        const listFile = path.join(loc.gameDir, game.id === "fallout4" ? "Fallout4.ccc" : "Skyrim.ccc");
        cc = fs.readFileSync(listFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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

module.exports = { read, activate, remove, fileFor, header, loadOrder, setOrder, sorted };
