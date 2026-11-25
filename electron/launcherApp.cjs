const { app, BrowserWindow, Notification, dialog, ipcMain, session, shell } = require("electron");
const fs = require("fs");
const path = require("path");

/*
 * The launcher itself, for Settings: its version, where it keeps its data and how much
 * of that is cache, starting with the computer, desktop notifications, and saving or
 * loading the settings as one file (window.appAPI in preload.cjs).
 */

const BACKUP_KIND = "unity-launcher-settings";
// The renderer's own preferences in a backup: its localStorage keys with these prefixes.
const RENDERER_PREFIXES = ["unity.", "theme", "appearance"];
// Chromium's caches in userData: safe to delete, they fill again.
const CACHE_DIRS = ["Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "Shared Dictionary"];

const settings = () => require("./minecraft/settings.cjs");

/* Total bytes in a folder, looking at most `limit` files. */
async function sizeOf(dir, limit = 200_000) {
    let total = 0;
    let seen = 0;
    const stack = [dir];
    while (stack.length && seen < limit) {
        const current = stack.pop();
        let entries;
        try {
            entries = await fs.promises.readdir(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else if (entry.isFile()) {
                seen += 1;
                try {
                    total += (await fs.promises.stat(full)).size;
                } catch {
                    // Gone since: nothing to count.
                }
            }
        }
    }
    return total;
}

const userData = () => app.getPath("userData");

function about() {
    let build = null;
    try {
        build = JSON.parse(fs.readFileSync(path.join(__dirname, "build-info.json"), "utf8"));
    } catch {
        // Run from source: no build to name.
    }
    return {
        version: app.getVersion(),
        commit: typeof build?.commit === "string" ? build.commit : null,
        built: typeof build?.built === "string" ? build.built : typeof build?.committed === "string" ? build.committed : null,
        packaged: app.isPackaged,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
    };
}

async function storage() {
    const dir = userData();
    const caches = await Promise.all(CACHE_DIRS.map((name) => sizeOf(path.join(dir, name))));
    const updates = await sizeOf(path.join(dir, "updates"));
    return {
        dataDir: dir,
        dataBytes: await sizeOf(dir),
        cacheBytes: caches.reduce((a, b) => a + b, 0),
        updateBytes: updates,
    };
}

async function clearCache() {
    const before = (await storage()).cacheBytes;
    await session.defaultSession.clearCache();
    await session.defaultSession.clearCodeCaches({});
    await session.defaultSession.clearStorageData({ storages: ["shadercache", "cachestorage"] });
    // The dashboard's file-scan cache is rebuilt on the next look at Home.
    try {
        fs.rmSync(path.join(userData(), "dashboard", "scan-cache.json"), { force: true });
    } catch {
        // Not there.
    }
    const after = (await storage()).cacheBytes;
    return { freedBytes: Math.max(0, before - after), ...(await storage()) };
}

/* Opening with the computer (macOS and Windows; Linux keeps its own autostart). */
function startup() {
    const supported = process.platform === "darwin" || process.platform === "win32";
    const login = supported ? app.getLoginItemSettings() : { openAtLogin: false };
    return { supported: supported && app.isPackaged, openAtLogin: Boolean(login.openAtLogin) };
}

function setStartup({ openAtLogin } = {}) {
    if (!app.isPackaged) throw new Error("Only the installed launcher can open with your computer.");
    if (typeof openAtLogin === "boolean") app.setLoginItemSettings({ openAtLogin });
    return startup();
}

/* A desktop notification, when they're on in Settings. */
function notify(title, body) {
    try {
        if (!settings().readSettings().notifications || !Notification.isSupported()) return false;
        const note = new Notification({ title, body, silent: false });
        note.on("click", () => {
            const win = BrowserWindow.getAllWindows()[0];
            if (win && !win.isDestroyed()) {
                if (win.isMinimized()) win.restore();
                win.show();
                win.focus();
            }
        });
        note.show();
        return true;
    } catch {
        return false;
    }
}

/*
 * Saves every setting to one file: the launcher's own (launcher-settings.json) and the
 * page's preferences (its colours, layout and such), passed in from the page.
 */
async function exportSettings(event, rendererPrefs) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const picked = await dialog.showSaveDialog(win, {
        title: "Save launcher settings",
        defaultPath: path.join(app.getPath("documents"), "Unity Launcher settings.json"),
        filters: [{ name: "Settings", extensions: ["json"] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    const { skinPackFolder: _ignored, ...launcher } = settings().readSettings();
    const prefs = {};
    if (rendererPrefs && typeof rendererPrefs === "object") {
        for (const [key, value] of Object.entries(rendererPrefs)) {
            if (typeof value === "string" && RENDERER_PREFIXES.some((p) => key.startsWith(p))) prefs[key] = value;
        }
    }
    const backup = { kind: BACKUP_KIND, version: 1, savedAt: new Date().toISOString(), launcher, prefs };
    await fs.promises.writeFile(picked.filePath, JSON.stringify(backup, null, 2));
    return picked.filePath;
}

/*
 * Loads a file saved above: the launcher's settings are checked as if the page had sent
 * them, and the page's preferences go back to the page to put in place.
 */
async function importSettings(event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const picked = await dialog.showOpenDialog(win, {
        title: "Load launcher settings",
        properties: ["openFile"],
        filters: [{ name: "Settings", extensions: ["json"] }],
    });
    if (picked.canceled || !picked.filePaths.length) return null;
    const stat = await fs.promises.stat(picked.filePaths[0]);
    if (stat.size > 2 * 1024 * 1024) throw new Error("That file is too big to be a settings file.");
    let backup;
    try {
        backup = JSON.parse(await fs.promises.readFile(picked.filePaths[0], "utf8"));
    } catch {
        throw new Error("That file couldn't be read as launcher settings.");
    }
    if (!backup || backup.kind !== BACKUP_KIND) throw new Error("That isn't a launcher settings file.");
    const launcher = backup.launcher && typeof backup.launcher === "object" ? { ...backup.launcher } : {};
    // Paths from another computer may not exist here: those stay as they are.
    for (const key of ["javaPath", "cloudFolder"]) delete launcher[key];
    const s = settings();
    s.writeSettings(s.settingsFromPage(launcher));
    const prefs = {};
    if (backup.prefs && typeof backup.prefs === "object") {
        for (const [key, value] of Object.entries(backup.prefs)) {
            if (typeof value === "string" && RENDERER_PREFIXES.some((p) => key.startsWith(p))) prefs[key] = value;
        }
    }
    return { prefs };
}

function registerLauncherAppIpc() {
    ipcMain.handle("app:about", () => about());
    ipcMain.handle("app:storage", () => storage());
    ipcMain.handle("app:clearCache", () => clearCache());
    ipcMain.handle("app:openDataFolder", async () => {
        const failed = await shell.openPath(userData());
        if (failed) throw new Error(failed);
    });
    ipcMain.handle("app:startup", () => startup());
    ipcMain.handle("app:setStartup", (_e, change) => setStartup(change && typeof change === "object" ? change : {}));
    ipcMain.handle("app:testNotification", () => {
        if (!Notification.isSupported()) throw new Error("This computer doesn't support desktop notifications.");
        new Notification({ title: "Unity Launcher", body: "Notifications are on." }).show();
    });
    ipcMain.handle("app:exportSettings", (event, prefs) => exportSettings(event, prefs));
    ipcMain.handle("app:importSettings", (event) => importSettings(event));
}

module.exports = { registerLauncherAppIpc, notify, about, _internal: { sizeOf } };
