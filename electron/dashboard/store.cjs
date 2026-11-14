const fs = require("fs");
const path = require("path");

/*
 * Where the Home dashboard keeps what it records and caches: <userData>/dashboard/.
 * Nothing here is ever written into an instance. Tests (and plain Node) pass their own
 * folder with setDataDir, so they never touch the real profile.
 */

let dataDir = null;

function setDataDir(dir) {
    dataDir = dir ? path.resolve(dir) : null;
}

function getDataDir() {
    if (dataDir) return dataDir;
    const electron = require("electron");
    if (typeof electron !== "object" || !electron.app) throw new Error("No folder for dashboard data was set.");
    dataDir = path.join(electron.app.getPath("userData"), "dashboard");
    return dataDir;
}

const fileIn = (name) => path.join(getDataDir(), name);

/* A JSON file from the dashboard folder, or fallback when it's missing or unreadable. */
function readJson(name, fallback) {
    try {
        const value = JSON.parse(fs.readFileSync(fileIn(name), "utf8"));
        return value ?? fallback;
    } catch {
        return fallback;
    }
}

/* Writes whole or not at all: a crash mid-write leaves the previous copy. */
function writeJson(name, value) {
    const file = fileIn(name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value));
    fs.renameSync(temp, file);
}

module.exports = { setDataDir, getDataDir, readJson, writeJson };
