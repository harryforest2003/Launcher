const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, dialog, ipcMain, protocol, session, WebContentsView } = require("electron");

/*
 * Blockbench, the model editor, inside the launcher's own window. It runs from its own
 * built files (scripts/build-blockbench.cjs) in a view of its own, with no Node, its own
 * storage and no internet. So neither a model file nor Blockbench itself can reach this
 * computer or send anything off it. A small bridge hands it one thing to edit, and its
 * Save sends the result back instead of downloading a file. The page shows it in the
 * space it sets aside, and recolours it to match the launcher.
 */

const SCHEME = "blockbench";
const PARTITION = "persist:blockbench";
const START_PAGE = `${SCHEME}://app/index.html`;

// Has to happen before the app is ready, which is why main.cjs loads this file early.
protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".wasm": "application/wasm",
};

function filesRoot() {
    return app.isPackaged
        ? path.join(process.resourcesPath, "blockbench")
        : path.join(__dirname, "../../vendor/blockbench");
}

function isAvailable() {
    return fs.existsSync(path.join(filesRoot(), "index.html"));
}

let prepared = false;

function prepare() {
    if (prepared) return;
    prepared = true;

    const editorSession = session.fromPartition(PARTITION);

    editorSession.protocol.handle(SCHEME, async (request) => {
        const root = filesRoot();
        const file = path.normalize(path.join(root, decodeURIComponent(new URL(request.url).pathname)));

        if (!file.startsWith(root + path.sep)) return new Response("Not found", { status: 404 });

        try {
            const data = await fs.promises.readFile(file);
            const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
            return new Response(data, { headers: { "Content-Type": type } });
        } catch {
            return new Response("Not found", { status: 404 });
        }
    });

    // Only its own files, and images it makes itself. Its usage statistics, plugin
    // store and theme downloads would otherwise all go out to the internet.
    editorSession.webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: !/^(blockbench|data|blob|devtools):/i.test(details.url) });
    });

    editorSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

// Each open editor, by the id of its page, and by the launcher window it sits in.
const editors = new Map();
const editorsByWindow = new Map();

// The space each window's page last made for an editor. The page can report it before
// the editor exists, while the thing to edit is still loading.
const spaceByWindow = new Map();

function fitBounds(rect) {
    return {
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
    };
}

const BRIDGE = fs.readFileSync(path.join(__dirname, "bridge.js"), "utf8");

// Blockbench's own colour names, set to the launcher's.
const THEME = `
body {
    --color-ui: #151515 !important;
    --color-back: #0d0d0d !important;
    --color-dark: #0a0a0a !important;
    --color-border: #2b1d47 !important;
    --color-selected: #3b2470 !important;
    --color-button: #232323 !important;
    --color-bright_ui: #ede9fe !important;
    --color-bright_ui_text: #1e1b2e !important;
    --color-accent: #7c3aed !important;
    --color-accent_text: #ffffff !important;
    --color-text: #e4e4e7 !important;
    --color-light: #f5f3ff !important;
    --color-subtle_text: #9ca3af !important;
    --color-grid: #2a2633 !important;
    --color-wireframe: #a78bfa !important;
    --color-checkerboard: #141414 !important;
    --color-menu_separator: #2b1d47 !important;
}
/* The launcher opens one thing at a time, and its own bar names it, so Blockbench's
   project tabs have no place here. */
#tab_bar { display: none !important; }
`;

// If Blockbench never says it's ready, it's shown anyway after this long, so any
// message it has is seen instead of an empty space.
const SHOW_ANYWAY_MS = 20 * 1000;

/* Shows the editor, once what it's editing is open. */
function reveal(editor) {
    if (editor.done || editor.shown || !editor.job) return;
    editor.shown = true;
    clearTimeout(editor.showAnyway);
    editor.view.setVisible(true);
}

/*
 * Blockbench takes a few seconds to start, so each launcher window keeps one running,
 * hidden, from when a page with a Blockbench button opens. Opening something only has
 * to load it, and Done closes it and hides Blockbench again for the next one, so every
 * open is quick, however soon after the last.
 */
const spares = new Map();

// If Blockbench ever has to be started afresh, it's once things have settled.
const RESTART_SPARE_MS = 1500;

function warmUp(host) {
    if (!host || host.isDestroyed() || !isAvailable()) return;
    if (spares.has(host.id) || editorsByWindow.has(host.id)) return;
    spares.set(host.id, createEditor(host));
}

/* Closes a Blockbench for good, as when its launcher window closes. */
function destroy(editor) {
    if (editor.done) return;
    editor.done = true;

    clearTimeout(editor.showAnyway);
    editors.delete(editor.contentsId);
    if (editorsByWindow.get(editor.windowId) === editor) editorsByWindow.delete(editor.windowId);
    if (spares.get(editor.windowId) === editor) spares.delete(editor.windowId);

    try {
        editor.host.contentView.removeChildView(editor.view);
    } catch {
        // The launcher window has already gone.
    }

    if (!editor.view.webContents.isDestroyed()) editor.view.webContents.close();

    editor.resolve?.(editor.last);
}

/*
 * Done: the launcher gets what was saved, and Blockbench is hidden, closes what it had
 * open, and waits for the next thing. If it can't close it, it's replaced instead.
 */
function finish(editor) {
    if (editor.done || !editor.job) return;

    clearTimeout(editor.showAnyway);
    editor.view.setVisible(false);
    editorsByWindow.delete(editor.windowId);

    const { resolve, last } = editor;
    Object.assign(editor, { job: null, onSave: null, last: null, resolve: null, shown: false, showAnyway: null, placed: false });
    resolve?.(last);

    // Ready for the next open straight away: Blockbench only asks what to open once
    // it has closed this.
    if (!spares.has(editor.windowId)) spares.set(editor.windowId, editor);

    editor.view.webContents
        .executeJavaScript("window.__unityLauncherClose?.()")
        .then((closed) => {
            if (!closed) throw new Error("Blockbench didn't close the last thing it had open.");
        })
        .catch(() => {
            // Unless it's already been given something else to open.
            if (editor.job) return;
            destroy(editor);
            setTimeout(() => warmUp(editor.host), RESTART_SPARE_MS);
        });
}

/*
 * Opens one thing to edit, in the launcher window `host`. Each Save in Blockbench calls
 * onSave straight away, and the promise settles when the editor closes, with whatever
 * was saved last (or null).
 */
function openEditor(job, onSave, host) {
    if (!isAvailable()) {
        throw new Error("Blockbench isn't built yet. Run npm run blockbench:build, then try again.");
    }

    if (editorsByWindow.has(host.id)) {
        throw new Error("Blockbench is already open. Press Done there first.");
    }

    // The one started ahead of time, or a new one if there isn't one yet.
    const editor = spares.get(host.id) ?? createEditor(host);
    spares.delete(host.id);
    editorsByWindow.set(host.id, editor);

    editor.job = job;
    editor.onSave = onSave;
    editor.view.setBounds(fitBounds(spaceByWindow.get(host.id) ?? editor.view.getBounds()));
    editor.showAnyway = setTimeout(() => reveal(editor), SHOW_ANYWAY_MS);

    const opened = new Promise((resolve) => (editor.resolve = resolve));

    // Blockbench sizes its panels from its width, so it's told what to open once the
    // page has said where it goes. The first time, the page's bar appears just after this.
    editor.placed = spaceByWindow.has(host.id);
    if (editor.placed) handOver(editor);
    else setTimeout(() => place(editor), PLACE_WAIT_MS);

    return opened;
}

// The longest Blockbench waits to hear where it goes before opening anyway.
const PLACE_WAIT_MS = 500;

function place(editor) {
    if (editor.placed || !editor.job) return;
    editor.placed = true;
    handOver(editor);
}

/* Tells a Blockbench waiting to be told what to open. */
function handOver(editor) {
    for (const hand of editor.waitingForJob.splice(0)) hand();
}

/* A hidden Blockbench in `host`, starting up, with nothing to edit yet. */
function createEditor(host) {
    prepare();

    const view = new WebContentsView({
        webPreferences: {
            partition: PARTITION,
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            // It loads while hidden, so it mustn't be slowed down as a background page.
            backgroundThrottling: false,
        },
    });

    view.setBackgroundColor("#0d0d0d");
    // Hidden while Blockbench starts and opens the thing to edit, so the first thing
    // shown is the editor. The page shows "Opening..." in the space meanwhile.
    view.setVisible(false);
    // The space the page last made for it, or the window's size until it makes one.
    const { width, height } = host.getContentBounds();
    view.setBounds(fitBounds(spaceByWindow.get(host.id) ?? { x: 0, y: 0, width, height }));
    host.contentView.addChildView(view);

    const contents = view.webContents;

    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, url) => {
        if (!url.startsWith(`${SCHEME}://`)) event.preventDefault();
    });

    contents.on("did-finish-load", () => {
        contents.insertCSS(THEME).catch(() => {});
        contents.executeJavaScript(BRIDGE).catch(() => {});
    });

    const editor = {
        job: null,
        onSave: null,
        last: null,
        view,
        host,
        resolve: null,
        contentsId: contents.id,
        windowId: host.id,
        done: false,
        shown: false,
        showAnyway: null,
        // Blockbench asking what to open, before anything has been chosen.
        waitingForJob: [],
    };

    editors.set(editor.contentsId, editor);
    host.once("closed", () => destroy(editor));

    contents.loadURL(START_PAGE);
    return editor;
}

function editorFor(event) {
    const editor = editors.get(event.sender.id);
    if (!editor) throw new Error("This window isn't editing anything for the launcher.");
    return editor;
}

function registerBridgeIpc() {
    // What to open, with the width it's shown at: while hidden, its page can't measure
    // itself. A spare waits here until something is chosen.
    ipcMain.handle("blockbench-bridge:job", async (event) => {
        const editor = editorFor(event);
        if (!editor.job || !editor.placed) await new Promise((resolve) => editor.waitingForJob.push(resolve));
        return { ...editor.job, width: editor.view.getBounds().width };
    });

    // What's being edited is open, so the editor can be shown.
    ipcMain.handle("blockbench-bridge:ready", (event) => reveal(editorFor(event)));

    ipcMain.handle("blockbench-bridge:save", async (event, result) => {
        const editor = editorFor(event);
        const message = await editor.onSave(result);
        editor.last = result;

        if (!editor.host.isDestroyed()) editor.host.webContents.send("blockbench:saved", message);
        return message;
    });
}

const PNG_DATA_URL = /^data:image\/png;base64,/;

function registerBlockbenchIpc() {
    registerBridgeIpc();

    // Loaded here rather than at the top, so this file can load before the app is ready.
    const skins = require("../minecraft/skins.cjs");

    ipcMain.handle("blockbench:available", () => isAvailable());

    const editorIn = (event) => editorsByWindow.get(BrowserWindow.fromWebContents(event.sender)?.id);

    // Where the page has made room for it, in the window's own coordinates.
    ipcMain.handle("blockbench:setBounds", (event, rect) => {
        const host = BrowserWindow.fromWebContents(event.sender);
        if (!host) return;

        spaceByWindow.set(host.id, rect);
        const active = editorsByWindow.get(host.id);
        active?.view.setBounds(fitBounds(rect));
        // Where it goes is known now, so Blockbench can open what it was given.
        if (active) place(active);
        spares.get(host.id)?.view.setBounds(fitBounds(rect));
    });

    // A page with a Blockbench button has opened, so start one ready for it.
    ipcMain.handle("blockbench:prepare", (event) => warmUp(BrowserWindow.fromWebContents(event.sender)));

    ipcMain.handle("blockbench:save", (event) => {
        const editor = editorIn(event);
        return editor?.view.webContents.executeJavaScript("window.__unityLauncherSave?.()");
    });

    /*
     * Done, or leaving the page. With unsaved changes it asks whether to save them, leave
     * without them, or stay. Resolves false if Blockbench stays open.
     */
    ipcMain.handle("blockbench:close", async (event) => {
        const editor = editorIn(event);
        if (!editor) return true;

        const contents = editor.view.webContents;
        const unsaved = await contents
            .executeJavaScript("Boolean(window.Project && Project.saved === false)")
            .catch(() => false);

        if (unsaved) {
            const { response } = await dialog.showMessageBox(editor.host, {
                type: "question",
                buttons: ["Save changes", "Exit without saving", "Cancel"],
                defaultId: 0,
                cancelId: 2,
                message: "Save your changes before leaving Blockbench?",
                detail: "They haven't been saved back to Unity Launcher yet.",
            });

            if (response === 2) return false;

            if (response === 0) {
                const saved = await contents.executeJavaScript("window.__unityLauncherSave?.()").catch(() => false);
                // A failed save already showed why, in Blockbench, which stays open.
                if (!saved) return false;
            }
        }

        finish(editor);
        return true;
    });

    /*
     * Each Save goes straight into Saved skins: over the saved skin it was opened from
     * (savedId), or as a copy the first time and over that copy after. So it's kept
     * however the editor is left. Resolves with the saved skin, or null if nothing was saved.
     */
    ipcMain.handle("blockbench:editSkin", async (event, { skin, slim, name, savedId }) => {
        const image = await skins.skinImage(skin);
        const title = String(name || "Skin").slice(0, 60);
        let kept = null;

        await openEditor(
            {
                kind: "skin",
                name: title,
                slim: Boolean(slim),
                image: `data:image/png;base64,${image.toString("base64")}`,
            },
            async (saved) => {
                if (!PNG_DATA_URL.test(saved?.image ?? "")) throw new Error("Blockbench didn't send an image back.");
                kept = skins.keepEditedInSaved(Buffer.from(saved.image.replace(PNG_DATA_URL, ""), "base64"), {
                    savedId: kept?.id ?? savedId,
                    name: `${title} (edited)`,
                    slim,
                });
                return kept.updated ? `Saved over "${kept.name}" in your skins.` : `Saved to your skins as "${kept.name}".`;
            },
            BrowserWindow.fromWebContents(event.sender)
        );

        return kept;
    });
}

module.exports = {
    registerBlockbenchIpc,
    isAvailable,
    openEditor,
    registerBridgeIpc,
};
