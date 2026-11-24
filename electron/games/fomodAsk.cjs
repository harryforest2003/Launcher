const crypto = require("crypto");
const { BrowserWindow, ipcMain } = require("electron");

/*
 * Asks in the app which options of a mod's FOMOD installer to install. The window shows the
 * choice screen on "games:fomod" and answers through "games:fomodAnswer".
 */

const waiting = new Map(); // id -> settle(answer)
let wired = false;

// [{ step, group, options: [names] }], as strings, from whatever the window sent.
function clean(choices) {
    if (!Array.isArray(choices)) return [];
    return choices.slice(0, 500).flatMap((choice) => {
        if (!choice || typeof choice !== "object") return [];
        const options = Array.isArray(choice.options) ? choice.options.slice(0, 500).map(String) : [];
        return [{ step: String(choice.step ?? ""), group: String(choice.group ?? ""), options }];
    });
}

function wire() {
    if (wired) return;
    wired = true;
    ipcMain.handle("games:fomodAnswer", (_event, id, choices) => {
        const settle = waiting.get(id);
        if (!settle) return false;
        // null: the install was cancelled.
        settle(choices === null ? null : clean(choices));
        return true;
    });
}

/*
 * request: { gameId, modName, info, preset }
 * -> the options chosen, null when the person cancels, or undefined when there's no window
 * to ask in (or it closed or reloaded first), so the installer's recommended options apply.
 */
function ask(request) {
    wire();
    const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
    if (!windows.length) return Promise.resolve(undefined);
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
        const cleanups = [];
        const settle = (answer) => {
            if (!waiting.has(id)) return;
            waiting.delete(id);
            for (const undo of cleanups) undo();
            resolve(answer);
        };
        waiting.set(id, settle);
        for (const win of windows) {
            const contents = win.webContents;
            const closed = () => settle(undefined);
            const navigated = (...args) => {
                // Newer Electron passes one details object; older passes (event, url, isInPlace, isMainFrame).
                const details = args[0] && typeof args[0] === "object" && "isMainFrame" in args[0] ? args[0] : { isMainFrame: args[3], isSameDocument: args[2] };
                if (details.isMainFrame && !details.isSameDocument) settle(undefined);
            };
            win.once("closed", closed);
            contents.on("did-start-navigation", navigated);
            contents.once("render-process-gone", closed);
            cleanups.push(() => {
                if (win.isDestroyed()) return;
                win.removeListener("closed", closed);
                contents.removeListener("did-start-navigation", navigated);
                contents.removeListener("render-process-gone", closed);
            });
            contents.send("games:fomod", { id, ...request });
        }
    });
}

module.exports = { ask };
