const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, dialog, ipcMain, WebContentsView } = require("electron");
const security = require("../security.cjs");

/*
 * Blockbench, the model editor, inside the launcher's own window. It runs from its own
 * built files (scripts/build-blockbench.cjs) in a view of its own, with no Node, its own
 * storage and no internet. So neither a model file nor Blockbench itself can reach this
 * computer or send anything off it. A small bridge hands it one thing to edit, and its
 * Save sends the result back instead of downloading a file. The page shows it in the
 * space it sets aside, and recolours it to match the launcher.
 */

// Its scheme is registered, with the launcher's, in security.cjs (Electron takes one list).
const SCHEME = security.BLOCKBENCH_SCHEME;
const START_PAGE = `${security.BLOCKBENCH_ORIGIN}/index.html`;

// The launcher's own files on Blockbench's scheme, under a folder name Blockbench doesn't use.
const OWN = "/__unity_launcher__/";
const THEME_PATH = `${OWN}theme.css`;

function filesRoot() {
    return app.isPackaged
        ? path.join(process.resourcesPath, "blockbench")
        : path.join(__dirname, "../../vendor/blockbench");
}

function isAvailable() {
    return fs.existsSync(path.join(filesRoot(), "index.html"));
}

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

/*
 * Blockbench's page, with the launcher's colours linked in last (so they win, and are
 * there from the first paint), and the policy it runs under: its own files and the images
 * it makes itself, nothing from the internet, no plugins, no frames, no forms.
 *
 * Blockbench itself can't run without two things a stricter policy would take away
 * (tried, with Electron 45, on the vendored build: the results are in security.md):
 *   - eval: its interface library (Vue 2) compiles its templates at run time with
 *     new Function. Without it Blockbench doesn't start (EvalError, then "reading 'vue'").
 *   - inline script: its markup uses inline event handlers (onclick="DisplayMode.loadHead()",
 *     and ones built as it runs, such as onclick="displayReferenceObjects.refmodels.<id>.load(<n>)").
 *     With only its two inline scripts allowed by hash, it starts, but 13 handlers are
 *     blocked at start alone, so those buttons do nothing.
 * So both stay allowed here, and nowhere else, and this view is shut in instead: no Node,
 * sandboxed, its own session with no permissions and no network (prepare), no navigation
 * or new windows, and a bridge of four messages whose sender and contents are checked.
 */
const BLOCKBENCH_POLICY = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' data: blob:",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
].join("; ");

let page = null;

async function blockbenchPage(file) {
    if (page?.file !== file) {
        const original = await fs.promises.readFile(file, "utf8");
        const html = original.replace(/<\/head>/i, `\t<link rel="stylesheet" href="${THEME_PATH}">\n</head>`);
        page = { file, html: Buffer.from(html) };
    }
    return page.html;
}

let prepared = false;

function prepare() {
    if (prepared) return;
    prepared = true;

    // No permissions at all (see security.cjs).
    const editorSession = security.protectBlockbenchSession();

    editorSession.protocol.handle(SCHEME, async (request) => {
        const url = new URL(request.url);
        if (`${url.protocol}//${url.host}` !== security.BLOCKBENCH_ORIGIN || request.method !== "GET") return security.notFound();

        if (url.pathname === THEME_PATH) {
            return new Response(THEME, { headers: { ...security.BASE_HEADERS, "Content-Type": "text/css; charset=utf-8" } });
        }

        const file = await security.fileInside(filesRoot(), url.pathname === "/" ? "/index.html" : url.pathname);
        if (!file) return security.notFound();

        try {
            if (path.relative(filesRoot(), file) === "index.html") {
                return new Response(await blockbenchPage(file), {
                    headers: { ...security.BASE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": BLOCKBENCH_POLICY },
                });
            }
            const data = await fs.promises.readFile(file);
            return new Response(data, { headers: { ...security.BASE_HEADERS, "Content-Type": security.contentType(file) } });
        } catch {
            return security.notFound();
        }
    });

    // Only its own files, and images it makes itself. Its usage statistics, plugin
    // store and theme downloads would otherwise all go out to the internet.
    editorSession.webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: !/^(blockbench|data|blob|devtools):/i.test(details.url) });
    });
}

// Each open editor, by the id of its page, and by the launcher window it sits in.
const editors = new Map();
const editorsByWindow = new Map();

// The space each window's page last made for an editor. The page can report it before
// the editor exists, while the thing to edit is still loading.
const spaceByWindow = new Map();

/* A rectangle in whole, non-negative pixels, whatever the page sent. */
function fitBounds(rect) {
    const whole = (value) => {
        const number = Math.round(Number(value));
        return Number.isFinite(number) ? Math.min(Math.max(0, number), 100000) : 0;
    };
    return { x: whole(rect?.x), y: whole(rect?.y), width: whole(rect?.width), height: whole(rect?.height) };
}

const BRIDGE = fs.readFileSync(path.join(__dirname, "bridge.js"), "utf8");

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
    clearInterval(editor.watch);
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
    clearInterval(editor.watch);
    editor.view.setVisible(false);
    editorsByWindow.delete(editor.windowId);

    const { resolve, last } = editor;
    Object.assign(editor, { job: null, onSave: null, last: null, resolve: null, reject: null, shown: false, showAnyway: null, watch: null, placed: false, tries: 0 });
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

    // The one started ahead of time, unless it's stopped working, or a new one.
    let editor = spares.get(host.id);
    spares.delete(host.id);
    if (editor && (editor.done || editor.view.webContents.isDestroyed() || editor.view.webContents.isCrashed())) {
        destroy(editor);
        editor = null;
    }
    editor ??= createEditor(host);
    editorsByWindow.set(host.id, editor);

    return new Promise((resolve, reject) => start(editor, { job, onSave, resolve, reject }));
}

let jobCount = 0;

/* Gives an editor something to open, and watches that it does. */
function start(editor, { job, onSave, resolve, reject, last = null, tries = 0 }) {
    Object.assign(editor, { job: { ...job, id: ++jobCount }, onSave, resolve, reject, last, tries, shown: false, openedAt: Date.now() });
    editor.view.setBounds(fitBounds(spaceByWindow.get(editor.windowId) ?? editor.view.getBounds()));
    editor.showAnyway = setTimeout(() => reveal(editor), SHOW_ANYWAY_MS);

    // Blockbench sizes its panels from its width, so it's told what to open once the
    // page has said where it goes. The first time, the page's bar appears just after this.
    editor.placed = spaceByWindow.has(editor.windowId);
    if (editor.placed) handOver(editor);
    else setTimeout(() => place(editor), PLACE_WAIT_MS);

    watch(editor);
}

/*
 * Blockbench is kept running between things, so if it ever gets stuck (its page crashed,
 * closing the last thing failed, or it never finished starting), everything after would
 * open in a Blockbench that can't. So each open is watched: if Blockbench hasn't taken
 * what to open in time, or hasn't opened it, a fresh one is started with the same thing.
 */
const TAKE_WAIT_MS = 4 * 1000; // a Blockbench that's running takes it in a fraction of a second
const START_WAIT_MS = 45 * 1000; // one that's starting takes a few seconds
const OPEN_WAIT_MS = 40 * 1000; // a big model takes a few seconds to open
const TRIES = 2;

function watch(editor) {
    clearInterval(editor.watch);
    editor.watch = setInterval(() => {
        if (editor.done || !editor.job || editor.readyFor === editor.job.id) {
            clearInterval(editor.watch);
            return;
        }
        const waited = Date.now() - editor.openedAt;
        const taken = editor.taken === editor.job.id;
        if (!editor.placed) return;
        if ((!taken && waited > (editor.alive ? TAKE_WAIT_MS : START_WAIT_MS)) || (taken && waited > OPEN_WAIT_MS)) replace(editor);
    }, 1000);
}

/* Swaps a stuck Blockbench for a fresh one, which opens the same thing. */
function replace(old) {
    const { host, job, onSave, resolve, reject, last } = old;
    const tries = (old.tries ?? 0) + 1;
    Object.assign(old, { job: null, resolve: null, reject: null });
    destroy(old);
    if (host.isDestroyed()) return resolve?.(last);

    if (tries > TRIES) {
        reject?.(new Error("Blockbench didn't open the model. Press the Blockbench button to try again."));
        setTimeout(() => warmUp(host), RESTART_SPARE_MS);
        return;
    }

    const fresh = createEditor(host);
    editorsByWindow.set(host.id, fresh);
    start(fresh, { job, onSave, resolve, reject, last, tries });
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
            partition: security.BLOCKBENCH_PARTITION,
            // Four bridge functions (preload.cjs), each one message, checked in registerBridgeIpc.
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInWorker: false,
            nodeIntegrationInSubFrames: false,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            experimentalFeatures: false,
            webviewTag: false,
            safeDialogs: true,
            navigateOnDragDrop: false,
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
    // Its own page, by origin, and nowhere else.
    contents.on("will-navigate", (event, url) => {
        if (security.originOf(url) !== security.BLOCKBENCH_ORIGIN) event.preventDefault();
    });

    // The launcher's colours are already in its page (see prepare); the bridge goes in once it's loaded.
    contents.on("did-finish-load", () => {
        contents.executeJavaScript(BRIDGE).catch(() => {});
    });

    // Its page crashed: what it was opening goes to a fresh one, and a spare is started again.
    contents.on("render-process-gone", () => broken(editor));

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
        // Its bridge has asked for something to open, so Blockbench is running.
        alive: false,
        // The id of the last thing it took to open, and the last it said was open.
        taken: null,
        readyFor: null,
        watch: null,
        tries: 0,
    };

    editors.set(editor.contentsId, editor);
    host.once("closed", () => destroy(editor));

    contents.loadURL(START_PAGE);
    return editor;
}

/* A Blockbench that's stopped working: replaced if it was opening something, else started again later. */
function broken(editor) {
    if (editor.done) return;
    if (editor.job) return replace(editor);
    const { host } = editor;
    destroy(editor);
    setTimeout(() => warmUp(host), RESTART_SPARE_MS);
}

/* The editor a bridge message came from: one this file made, still running. */
function editorFor(event) {
    const editor = editors.get(event.sender.id);
    if (!editor || editor.done || editor.view.webContents !== event.sender) {
        throw new Error("This window isn't editing anything for the launcher.");
    }
    return editor;
}

// The most a save may hand back (a big model with its textures is a few megabytes).
const MAX_SAVE_CHARS = 64 * 1024 * 1024;

/* What a Save sends back: an image, or a model with its textures, as text, within reason. */
function checkSaved(result) {
    if (!result || typeof result !== "object") throw new Error("Blockbench didn't send anything back.");
    const size = (value) => (typeof value === "string" ? value.length : 0);
    const textures = Array.isArray(result.textures) ? result.textures : [];
    const total = size(result.image) + size(result.model) + textures.reduce((sum, texture) => sum + size(texture?.source) + size(texture?.name), 0);
    if (total > MAX_SAVE_CHARS) throw new Error("That's too big to save back to the launcher.");
    return result;
}

function registerBridgeIpc() {
    // What to open, with the width it's shown at: while hidden, its page can't measure
    // itself. A spare waits here until something is chosen.
    // Each thing is handed over once, so it's never opened twice.
    ipcMain.handle("blockbench-bridge:job", async (event) => {
        const editor = editorFor(event);
        editor.alive = true;
        while (!editor.job || !editor.placed || editor.taken === editor.job.id) {
            await new Promise((resolve) => editor.waitingForJob.push(resolve));
        }
        editor.taken = editor.job.id;
        return { ...editor.job, width: editor.view.getBounds().width };
    });

    // What's being edited is open, so the editor can be shown.
    ipcMain.handle("blockbench-bridge:ready", (event) => {
        const editor = editorFor(event);
        if (editor.job) editor.readyFor = editor.job.id;
        reveal(editor);
    });

    // Blockbench didn't start properly.
    ipcMain.handle("blockbench-bridge:failed", (event) => broken(editorFor(event)));

    ipcMain.handle("blockbench-bridge:save", async (event, result) => {
        const editor = editorFor(event);
        if (!editor.onSave) throw new Error("Nothing is open to save.");
        checkSaved(result);
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

        spaceByWindow.set(host.id, fitBounds(rect));
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

    // Whether what's open has changes that haven't been saved back to the launcher.
    const hasUnsaved = (editor) =>
        editor.view.webContents.executeJavaScript("Boolean(window.Project && Project.saved === false)").catch(() => false);

    ipcMain.handle("blockbench:unsaved", async (event) => {
        const editor = editorIn(event);
        return editor ? hasUnsaved(editor) : false;
    });

    // Blockbench is drawn over the page, so it steps aside while the page asks something
    // (whether to save before leaving), and comes back if the answer is to stay.
    ipcMain.handle("blockbench:hide", (event, hidden) => {
        const editor = editorIn(event);
        if (!editor || editor.done) return;
        editor.view.setVisible(!hidden && editor.shown);
    });

    /*
     * Done, or leaving the page. The page asks about unsaved changes itself, in the
     * launcher's own style, and says what was chosen: "save" saves first, "discard"
     * leaves without. Without a choice, it asks here instead. Resolves false if
     * Blockbench stays open (a save that failed, or Cancel).
     */
    ipcMain.handle("blockbench:close", async (event, choice) => {
        const editor = editorIn(event);
        if (!editor) return true;

        const contents = editor.view.webContents;

        if (choice === "save") {
            const saved = await contents.executeJavaScript("window.__unityLauncherSave?.()").catch(() => false);
            // A failed save already showed why, in Blockbench, which stays open.
            if (!saved) return false;
            finish(editor);
            return true;
        }

        const unsaved = choice === "discard" ? false : await hasUnsaved(editor);

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
    ipcMain.handle("blockbench:editSkin", async (event, request) => {
        const { skin, slim, name, savedId } = request ?? {};
        if (typeof skin !== "string") throw new Error("There's no skin to edit.");
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
