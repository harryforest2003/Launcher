const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const protect = require("./protect.cjs");

/*
 * Starting a game: through Steam when that's where it is, else its own exe (or app on a
 * Mac), and for a game in a CrossOver bottle, through CrossOver. With a script extender
 * (SKSE, F4SE, SMAPI) installed, that starts the game, so its mods load.
 *
 * "safe" plays without the mods that hook into the game's code, for after a game update:
 * The Sims 4 with script mods off, GTA V with Script Hook V's ASI loader set aside,
 * Cyberpunk without Cyber Engine Tweaks and RED4ext, Skyrim and Fallout without their
 * script extender, Stardew without SMAPI.
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
    const child = spawn(command, args, { cwd, detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
}

/* An exe in a CrossOver bottle, through CrossOver's own wine. */
function startInBottle(exe) {
    const match = exe.match(/\/Bottles\/([^/]+)\/drive_c\//);
    if (!match || !exe.includes("/CrossOver/Bottles/") || !fs.existsSync(CROSSOVER_WINE)) {
        throw new Error("This game is in a Windows bottle: start it from CrossOver or Whisky.");
    }
    startDetached(CROSSOVER_WINE, ["--bottle", match[1], exe], path.dirname(exe));
}

const inBottle = (dir) => Boolean(dir && dir.includes(`${path.sep}drive_c${path.sep}`));

/* The first of a game's exes that's there. */
const exeIn = (loc, names) => names.map((name) => path.join(loc.gameDir ?? "", name)).find((file) => loc.gameDir && fs.existsSync(file)) ?? null;

/*
 * Starts the game. open(url) opens a link (Steam's), so this works without Electron in tests.
 * -> { how } describing what was started.
 */
async function launch(game, loc, { safe = false, open }) {
    const steamId = () => {
        // GTA V Enhanced has its own Steam app.
        if (game.id === "gtav" && loc.gameDir && fs.existsSync(path.join(loc.gameDir, "GTA5_Enhanced.exe"))) return "3240220";
        return game.steamAppIds?.[0];
    };
    const viaSteam = loc.source?.startsWith("Steam") && !inBottle(loc.gameDir) && steamId();

    // First, how it'll start, so nothing is changed for a game that can't be started.
    let how;
    let start;
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
    } else if (viaSteam) {
        how = "Steam";
        start = () => open(`steam://rungameid/${steamId()}`);
    } else {
        const exe = exeIn(loc, [...(game.launch?.win32Exe ?? []).filter((name) => !(safe && (name === game.bethesda?.extender?.loader || name === "StardewModdingAPI.exe")))]);
        if (exe) {
            how = inBottle(loc.gameDir) ? `${path.basename(exe)} in CrossOver` : path.basename(exe);
            start = () => (inBottle(loc.gameDir) ? startInBottle(exe) : startDetached(exe, [], path.dirname(exe)));
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
