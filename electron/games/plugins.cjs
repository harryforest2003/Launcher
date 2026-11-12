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

module.exports = { read, activate, remove, fileFor };
