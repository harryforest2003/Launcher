const fs = require("fs");
const os = require("os");
const path = require("path");

/*
 * Where the launcher keeps what it knows about each game: the folder chosen for it, the
 * mods it installed and the files of any turned off. In the app that's its profile; run
 * outside it (tests), UNITY_GAMES_DATA or a temporary folder.
 */
function dataDir() {
    let base = process.env.UNITY_GAMES_DATA;
    if (!base) {
        try {
            const { app } = require("electron");
            if (app?.getPath) base = path.join(app.getPath("userData"), "game-mods");
        } catch {
            // Not in Electron.
        }
    }
    base ??= path.join(os.tmpdir(), "unity-game-mods");
    fs.mkdirSync(base, { recursive: true });
    return base;
}

const settingsFile = () => path.join(dataDir(), "settings.json");

function readSettings() {
    try {
        return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    } catch {
        return { gameDirs: {} };
    }
}

function writeSettings(settings) {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}

module.exports = { dataDir, readSettings, writeSettings };
