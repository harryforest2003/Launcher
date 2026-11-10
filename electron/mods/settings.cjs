const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { hasSecret } = require("../secrets.cjs");

/*
 * Small JSON settings store in userData. API keys don't belong here: they
 * are encrypted by secrets.cjs instead.
 */

function settingsPath() {
    return path.join(app.getPath("userData"), "unity-settings.json");
}

function readSettings() {
    try {
        return JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    } catch {
        return {};
    }
}

function writeSettings(patch) {
    const current = readSettings();
    const next = { ...current, ...patch };

    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));

    return next;
}

function publicSettings() {
    const s = readSettings();

    return {
        hasNexusKey: hasSecret("nexus") || !!s.nexusApiKey,
        customGames: s.customGames ?? [],
    };
}

module.exports = {
    readSettings,
    writeSettings,
    publicSettings,
};
