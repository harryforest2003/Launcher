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

// Blockbench's own colour names, set to the launcher's. Its "Download App" button makes
// no sense inside an app.
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
#web_download_button { display: none !important; }
`;

function finish(editor) {
    if (editor.done) return;
    editor.done = true;

    editors.delete(editor.contentsId);
    editorsByWindow.delete(editor.windowId);

    try {
        editor.host.contentView.removeChildView(editor.view);
    } catch {
        // The launcher window has already gone.
    }

    if (!editor.view.webContents.isDestroyed()) editor.view.webContents.close();

    editor.resolve(editor.last);
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

    prepare();

    const view = new WebContentsView({
        webPreferences: {
            partition: PARTITION,
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    view.setBackgroundColor("#0d0d0d");
    // Nothing shows until the page says where it goes.
    view.setBounds(fitBounds(spaceByWindow.get(host.id) ?? { x: 0, y: 0, width: 0, height: 0 }));
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

    return new Promise((resolve) => {
        const editor = {
            job,
            onSave,
            last: null,
            view,
            host,
            resolve,
            contentsId: contents.id,
            windowId: host.id,
            done: false,
        };

        editors.set(editor.contentsId, editor);
        editorsByWindow.set(editor.windowId, editor);

        host.once("closed", () => finish(editor));

        contents.loadURL(START_PAGE);
    });
}

function editorFor(event) {
    const editor = editors.get(event.sender.id);
    if (!editor) throw new Error("This window isn't editing anything for the launcher.");
    return editor;
}

function registerBridgeIpc() {
    ipcMain.handle("blockbench-bridge:job", (event) => editorFor(event).job);

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
        editorsByWindow.get(host.id)?.view.setBounds(fitBounds(rect));
    });

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

    ipcMain.handle("blockbench:editSkin", async (event, { skin, slim, name }) => {
        const image = await skins.skinImage(skin);
        let edited = null;

        const result = await openEditor(
            {
                kind: "skin",
                name: String(name || "Skin").slice(0, 60),
                slim: Boolean(slim),
                image: `data:image/png;base64,${image.toString("base64")}`,
            },
            async (saved) => {
                if (!PNG_DATA_URL.test(saved?.image ?? "")) throw new Error("Blockbench didn't send an image back.");
                edited = Buffer.from(saved.image.replace(PNG_DATA_URL, ""), "base64");
                return "Saved. Press Done when you've finished.";
            },
            BrowserWindow.fromWebContents(event.sender)
        );

        return result && edited ? skins.keepEditedSkin(edited, `${name} (edited)`) : null;
    });
}

module.exports = {
    registerBlockbenchIpc,
    isAvailable,
    openEditor,
    registerBridgeIpc,
};
