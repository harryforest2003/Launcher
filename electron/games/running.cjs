const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const mac = require("./mac.cjs");

/*
 * Whether a game started from the launcher is still open. The launcher doesn't own these
 * games (Steam, the game's own launcher or `open` starts them), so it looks for their
 * programs among what's running on the computer.
 */

// Programs that only hand over to another launcher and quit: they say nothing about the game.
const HANDOFF = new Set(["playgtav.exe"]);
// The game's own program, when it isn't one its launch starts directly.
const ALSO = { gtav: ["GTA5.exe", "GTA5_Enhanced.exe"] };
// Installers and helpers in a game's folder that aren't the game.
const NOT_GAME = /^(unins|setup|install|crash|vc_?redist|dxsetup|dxwebsetup|ue4prereq|launcherpatcher|oalinst|dotnet)/i;

/* The .exe files in a folder and the two below it, at most 40. */
function exesIn(dir, depth = 2, found = []) {
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return found;
    }
    for (const entry of entries) {
        if (found.length >= 40) break;
        if (entry.isFile() && /\.exe$/i.test(entry.name) && !NOT_GAME.test(entry.name)) found.push(entry.name);
        else if (depth > 0 && entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.endsWith(".app")) exesIn(path.join(dir, entry.name), depth - 1, found);
    }
    return found;
}

/* The apps in a folder (a Mac game's), at most 10. */
function appsIn(dir) {
    try {
        return fs
            .readdirSync(dir)
            .filter((name) => name.endsWith(".app"))
            .slice(0, 10);
    } catch {
        return [];
    }
}

/*
 * What shows the game is open: its programs' names, its apps (any copy of them), and off
 * Windows, anything running from its folder. All lower case.
 */
function watchFor(game, loc) {
    const names = new Set();
    const apps = new Set();
    const addExe = (file) => {
        const name = path.basename(String(file)).toLowerCase();
        if (name.endsWith(".exe") && !HANDOFF.has(name)) names.add(name);
    };
    const addApp = (app) => {
        if (app) apps.add(`/${path.basename(String(app)).toLowerCase()}/contents/macos/`);
    };
    for (const exe of [...(game.launch?.win32Exe ?? []), ...(ALSO[game.id] ?? [])]) addExe(exe);
    if (game.launch?.darwinAppName) addApp(game.launch.darwinAppName);
    if (game.id === "sims4") addApp("The Sims 4.app");
    if (loc.launchChosen && loc.launchExe) (loc.launchExe.endsWith(".app") ? addApp : addExe)(loc.launchExe);
    if (process.platform === "darwin" && loc.gameDir) addApp(mac.appFor(game, loc));
    if (game.generic && loc.gameDir) {
        for (const exe of exesIn(loc.gameDir)) addExe(exe);
        if (process.platform === "darwin") for (const app of appsIn(loc.gameDir)) addApp(app);
    }
    const dirs = process.platform !== "win32" && loc.gameDir ? [`${path.resolve(loc.gameDir).toLowerCase()}/`] : [];
    return { names: [...names], apps: [...apps], dirs };
}

/* Whether there's anything to look for: Windows can only go by program names. */
const canWatch = (watch) => watch.names.length > 0 || (process.platform !== "win32" && watch.apps.length + watch.dirs.length > 0);

const run = (file, args) =>
    new Promise((resolve) =>
        execFile(file, args, { timeout: 10000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)))
    );

/*
 * What's running now: program names on Windows, whole command lines elsewhere (so a
 * Windows game in CrossOver, Wine or Proton shows by its .exe's path). Null if it can't tell.
 */
async function processes() {
    if (process.platform === "win32") {
        const out = await run("tasklist", ["/FO", "CSV", "/NH"]);
        if (out == null) return null;
        const names = new Set();
        for (const line of out.split(/\r?\n/)) {
            const name = line.match(/^"([^"]+)"/)?.[1];
            if (name) names.add(name.toLowerCase());
        }
        return { names, lines: [] };
    }
    const out = await run("ps", process.platform === "darwin" ? ["-axww", "-o", "args="] : ["-eww", "-o", "args="]);
    if (out == null) return null;
    return { names: null, lines: out.toLowerCase().split("\n") };
}

function isOpen(watch, running) {
    if (running.names) return watch.names.some((name) => running.names.has(name));
    return running.lines.some(
        (line) =>
            watch.names.some((name) => line.includes(`/${name}`) || line.includes(`\\${name}`)) ||
            watch.apps.some((app) => line.includes(app)) ||
            watch.dirs.some((dir) => line.includes(dir))
    );
}

/* Whether a game is open now; false when that can't be told. */
async function gameOpen(gameId) {
    try {
        const watch = watchFor(require("./registry.cjs").getGame(gameId), require("./detect.cjs").locate(gameId));
        if (!canWatch(watch)) return false;
        return isOpen(watch, await processes());
    } catch {
        return false;
    }
}

module.exports = { watchFor, canWatch, processes, isOpen, gameOpen };
