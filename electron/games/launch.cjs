const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const protect = require("./protect.cjs");
const mac = require("./mac.cjs");

/*
 * Starting a game: through Steam when that's where it is, else its own exe (or app on a
 * Mac), and for a game in a CrossOver bottle, through CrossOver. With a script extender
 * (SKSE, F4SE, SMAPI) installed, that starts the game, so its mods load.
 *
 * "safe" plays without the mods that hook into the game's code, for after a game update:
 * The Sims 4 with script mods off, GTA V with Script Hook V's ASI loader set aside,
 * Cyberpunk without Cyber Engine Tweaks and RED4ext, Skyrim and Fallout without their
 * script extender, Stardew without SMAPI.
 *
 * Cyberpunk's Mac version: redscript compiles the script mods first (the game doesn't),
 * then archive-loader starts it when it's installed with archive mods to load, else Steam
 * or the app. "safe" compiles no script mods and leaves archive-loader out.
 */

/*
 * The files that load each game's code mods, set aside (renamed) to play without them:
 * Script Hook V's ASI loader, and Cyber Engine Tweaks' and RED4ext's.
 */
const LOADERS = {
    gtav: ["dinput8.dll"],
    cyberpunk2077: ["bin/x64/version.dll", "bin/x64/winmm.dll"],
};
const PARKED = ".unity-off";
const PARKED_LOADER = `dinput8.dll${PARKED}`;
const CROSSOVER_WINE = "/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine";

function startDetached(command, args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, detached: true, stdio: "ignore" });
        child.once("error", reject);
        child.once("spawn", () => {
            child.unref();
            resolve();
        });
    });
}

/* An exe in a CrossOver bottle, through CrossOver's own wine. */
function startInBottle(exe) {
    const match = exe.match(/\/Bottles\/([^/]+)\/drive_c\//);
    if (!match || !exe.includes("/CrossOver/Bottles/") || !fs.existsSync(CROSSOVER_WINE)) {
        throw new Error("This game is in a Windows bottle: start it from CrossOver or Whisky.");
    }
    return startDetached(CROSSOVER_WINE, ["--bottle", match[1], exe], path.dirname(exe));
}

const inBottle = (dir) => Boolean(dir && dir.includes(`${path.sep}drive_c${path.sep}`));

/* The first of a game's exes that's there. */
const exeIn = (loc, names) => names.map((name) => path.join(loc.gameDir ?? "", name)).find((file) => loc.gameDir && fs.existsSync(file)) ?? null;

/* A Windows game's own exe: the only one at the top of its folder that isn't an installer. */
function onlyExe(dir) {
    if (!dir || process.platform !== "win32") return null;
    let names = [];
    try {
        names = fs.readdirSync(dir).filter((name) => /\.exe$/i.test(name) && !/^(unins|setup|install|crash|vc_?redist|dxsetup|ue4prereq|launcherpatcher)/i.test(name));
    } catch {
        return null;
    }
    return names.length === 1 ? path.join(dir, names[0]) : null;
}

/* A Mac game's app: the only one in its folder. */
function onlyApp(dir) {
    try {
        const apps = fs.readdirSync(dir).filter((name) => name.endsWith(".app"));
        return apps.length === 1 ? path.join(dir, apps[0]) : null;
    } catch {
        return null;
    }
}

/*
 * Every other game: what its Settings chose to start it with (an app, an exe, a CrossOver
 * bottle's exe), else Steam when that's where it is, else the app or exe in its folder.
 */
async function launchGeneric(game, loc, open) {
    const steamId = game.steamAppIds?.[0];
    const target = loc.launchChosen ? loc.launchExe : null;
    const macApp = process.platform === "darwin" && loc.gameDir && !inBottle(loc.gameDir) ? mac.appFor(game, loc) ?? onlyApp(loc.gameDir) : null;
    const exe = onlyExe(loc.gameDir);
    let how;
    let start;
    if (target) {
        how = path.basename(target);
        if (process.platform === "darwin" && target.endsWith(".app")) start = () => startDetached("open", ["-a", target]);
        else if (inBottle(target)) start = () => startInBottle(target);
        else if (process.platform === "darwin" && /\.(exe|bat|cmd)$/i.test(target)) {
            throw new Error("A Windows game needs CrossOver or Whisky on a Mac: choose its .exe inside a CrossOver bottle, or start it from there.");
        } else start = () => startDetached(target, [], path.dirname(target));
    } else if (steamId && loc.source === "Steam" && !inBottle(loc.gameDir)) {
        how = "Steam";
        start = () => open(`steam://rungameid/${steamId}`);
    } else if (macApp) {
        const problem = mac.runProblem(game, loc);
        if (problem) throw new Error(problem);
        how = path.basename(macApp);
        start = () => startDetached("open", ["-a", macApp]);
    } else if (exe) {
        how = path.basename(exe);
        start = () => startDetached(exe, [], path.dirname(exe));
    } else if (steamId && loc.source !== "Mods folder") {
        how = "Steam";
        start = () => open(`steam://rungameid/${steamId}`);
    } else {
        throw new Error(`Choose how ${game.name} starts in its Settings (Starts with), or start it as you usually do.`);
    }
    await start();
    protect.rememberPlay(game, loc);
    return { how, safe: false };
}

/*
 * Starts the game. open(url) opens a link (Steam's), so this works without Electron in tests.
 * -> { how } describing what was started.
 */
async function launch(game, loc, { safe = false, open }) {
    if (game.generic) return launchGeneric(game, loc, open);
    const steamId = () => {
        // GTA V Enhanced has its own Steam app.
        if (game.id === "gtav" && loc.gameDir && fs.existsSync(path.join(loc.gameDir, "GTA5_Enhanced.exe"))) return "3240220";
        return game.steamAppIds?.[0];
    };
    const viaSteam = loc.source?.startsWith("Steam") && !inBottle(loc.gameDir) && steamId();
    const macApp = process.platform === "darwin" && !inBottle(loc.gameDir) ? mac.appFor(game, loc) : null;
    const cyberpunkMac = game.id === "cyberpunk2077" && Boolean(macApp);

    // First, how it'll start, so nothing is changed for a game that can't be started.
    const problem = macApp ? mac.runProblem(game, loc) : null;
    if (problem) throw new Error(problem);
    let how;
    let start;
    const archiveLoader = cyberpunkMac && !safe ? mac.archiveLoader(loc.gameDir) : null;
    const extenderExe = !safe && game.bethesda ? exeIn(loc, [game.bethesda.extender.loader]) : null;
    const smapiExe = !safe && game.id === "stardew" && process.platform === "win32" ? exeIn(loc, ["StardewModdingAPI.exe"]) : null;

    if (extenderExe || smapiExe) {
        const exe = extenderExe ?? smapiExe;
        how = path.basename(exe);
        start = () => (inBottle(loc.gameDir) ? startInBottle(exe) : startDetached(exe, [], loc.gameDir));
    } else if (game.id === "sims4" && process.platform === "darwin" && !viaSteam) {
        const app = loc.gameDir?.endsWith(".app") ? loc.gameDir : "/Applications/The Sims 4.app";
        if (!fs.existsSync(app)) throw new Error("The Sims 4 app wasn't found. Choose it in Settings.");
        how = "The Sims 4 app";
        start = () => startDetached("open", ["-a", app]);
    } else if (archiveLoader) {
        // It patches the archives, runs the game and puts them back when it quits; a mod it
        // can't apply starts the game without archive mods rather than not at all.
        const exe = mac.appExecutable(macApp);
        if (!exe) throw new Error(`${path.basename(macApp)} has no program in it. Check the game's files in Steam or GOG.`);
        how = "archive-loader";
        start = () => startDetached(archiveLoader, ["run", "--vanilla-on-error", "--", exe], loc.gameDir);
    } else if (viaSteam) {
        how = "Steam";
        start = () => open(`steam://rungameid/${steamId()}`);
    } else {
        const exe = exeIn(loc, [...(game.launch?.win32Exe ?? []).filter((name) => !(safe && (name === game.bethesda?.extender?.loader || name === "StardewModdingAPI.exe")))]);
        if (exe) {
            how = inBottle(loc.gameDir) ? `${path.basename(exe)} in CrossOver` : path.basename(exe);
            start = () => (inBottle(loc.gameDir) ? startInBottle(exe) : startDetached(exe, [], path.dirname(exe)));
        } else if (macApp) {
            how = path.basename(macApp);
            start = () => startDetached("open", ["-a", macApp]);
        } else if (steamId() && process.platform !== "darwin") {
            how = "Steam";
            start = () => open(`steam://rungameid/${steamId()}`);
        } else {
            throw new Error(`${game.name} couldn't be started from here: choose its folder in Settings, or start it as you usually do.`);
        }
    }
    if (inBottle(loc.gameDir) && !(loc.gameDir.includes("/CrossOver/Bottles/") && fs.existsSync(CROSSOVER_WINE)) && how !== "Steam") {
        throw new Error("This game is in a Windows bottle: start it from CrossOver or Whisky.");
    }

    // Then, playing with or without the mods that hook into its code.
    if (game.id === "sims4" && safe) protect.setSimsOptions(loc, { scripts: false });
    if (cyberpunkMac) await mac.compileScripts(loc.gameDir, { safe });
    for (const rel of (loc.gameDir && LOADERS[game.id]) || []) {
        const live = path.join(loc.gameDir, rel);
        const parked = `${live}${PARKED}`;
        if (safe && fs.existsSync(live)) fs.renameSync(live, parked);
        if (!safe && fs.existsSync(parked) && !fs.existsSync(live)) fs.renameSync(parked, live);
    }

    await start();

    protect.rememberPlay(game, loc);
    return { how, safe };
}

module.exports = { launch, PARKED_LOADER, LOADERS };
