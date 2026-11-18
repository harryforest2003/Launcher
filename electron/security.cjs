const fs = require("fs");
const path = require("path");
const electron = require("electron");

// Outside Electron (plain Node tests of files that load this one), require("electron") is a path.
const inElectron = typeof electron === "object";
const { app, BrowserWindow, ipcMain, protocol, session, shell } = inElectron ? electron : {};

/*
 * What keeps the launcher's pages from reaching more of this computer than they should,
 * in one place (Electron's security checklist, https://www.electronjs.org/docs/latest/tutorial/security):
 *
 *   - the launcher's page is served from app://unity, a scheme of its own, not file://
 *   - every page gets a Content-Security-Policy, so a mod description can't run script
 *   - no page gets a permission (camera, location, ...) except copying to the clipboard
 *   - no page can open a window, attach a <webview> or wander off to another site
 *   - every message a page sends the main process is checked for where it came from
 *   - links leave for the system browser only when they're ordinary web or mail links
 *
 * Loaded by main.cjs before anything else registers a message handler or a scheme.
 */

const APP_SCHEME = "app";
const APP_HOST = "unity";
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const APP_START_URL = `${APP_ORIGIN}/index.html`;

// Run from source, the page comes from Vite's dev server instead (npm run electron:dev).
const DEV_SERVER_URL = "http://localhost:5174";

const BLOCKBENCH_SCHEME = "blockbench";
const BLOCKBENCH_ORIGIN = `${BLOCKBENCH_SCHEME}://app`;
const BLOCKBENCH_PARTITION = "persist:blockbench";

const isDev = inElectron && !app.isPackaged;

/* Origins the launcher's own page is served from. */
const LAUNCHER_ORIGINS = isDev ? [APP_ORIGIN, DEV_SERVER_URL] : [APP_ORIGIN];

/*
 * Both schemes in one call: Electron takes this list once, before the app is ready, and
 * a second call would leave the first scheme without its privileges in the page.
 */
if (inElectron) {
    protocol.registerSchemesAsPrivileged([
        { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
        { scheme: BLOCKBENCH_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    ]);
}

/* ---------------- serving files on a scheme ---------------- */

const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".map": "application/json",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".wasm": "application/wasm",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".txt": "text/plain; charset=utf-8",
};

const contentType = (file) => TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";

const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });

/*
 * The file a request on one of the app's schemes names, inside root and nowhere else
 * (a "..", an encoded slash or a link out of the folder gets nothing).
 */
async function fileInside(root, pathname) {
    let relative;
    try {
        relative = decodeURIComponent(pathname);
    } catch {
        return null;
    }
    if (relative.includes("\0")) return null;

    const base = path.resolve(root);
    const file = path.resolve(base, `.${path.posix.normalize(`/${relative}`)}`);
    if (!file.startsWith(base + path.sep)) return null;

    try {
        // A link inside the folder that points out of it is refused too. Inside the
        // installed app's archive there are no links, and realpath can't see in.
        const real = await fs.promises.realpath(file).catch(() => file);
        const realBase = await fs.promises.realpath(base).catch(() => base);
        if (real !== file && !real.startsWith(realBase + path.sep)) return null;
        const stat = await fs.promises.stat(file);
        return stat.isFile() ? file : null;
    } catch {
        return null;
    }
}

/*
 * Every security header a page or file from the app's own schemes is sent with. The
 * page's policy itself is added by the session (see protectSessions), so the same one
 * covers the dev server's pages.
 */
const BASE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
};

/*
 * The launcher's own page and its files, from dist/ (built by Vite) on app://unity.
 * A path that isn't a file gets the page itself, so reloading on any screen works.
 */
function serveLauncher() {
    const root = path.join(__dirname, "..", "dist");

    protocol.handle(APP_SCHEME, async (request) => {
        const url = new URL(request.url);
        if (url.host !== APP_HOST || (request.method !== "GET" && request.method !== "HEAD")) return notFound();

        const wanted = url.pathname === "/" ? "/index.html" : url.pathname;
        let file = await fileInside(root, wanted);
        if (!file && !path.extname(wanted)) file = await fileInside(root, "/index.html");
        if (!file) return notFound();

        const data = await fs.promises.readFile(file);
        return new Response(request.method === "HEAD" ? null : data, {
            headers: { ...BASE_HEADERS, "Content-Type": contentType(file), "Cache-Control": "no-cache" },
        });
    });
}

/* ---------------- sessions: policy, permissions ---------------- */

/*
 * "scheme://host[:port]" of a URL, or null. Worked out here because Node's URL gives
 * "null" as the origin of any scheme it doesn't know, such as app: and blockbench:.
 */
const originOf = (url) => {
    try {
        const parsed = new URL(String(url));
        return parsed.host ? `${parsed.protocol}//${parsed.host}` : null;
    } catch {
        return null;
    }
};

const isLauncherUrl = (url) => LAUNCHER_ORIGINS.includes(originOf(url));

/*
 * Pages may only copy to the clipboard (Copy buttons in the log and the Model Builder).
 * Everything else a page could ask for (camera, microphone, location, notifications,
 * USB, MIDI, screen capture, opening other apps...) is refused without asking.
 */
function lockPermissions(ses, { clipboardFor = [] } = {}) {
    const allowed = (permission, origin) => permission === "clipboard-sanitized-write" && clipboardFor.includes(origin);

    ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
        callback(allowed(permission, originOf(details?.requestingUrl ?? "")));
    });
    ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => allowed(permission, originOf(requestingOrigin)));
    ses.setDevicePermissionHandler(() => false);
}

/*
 * The launcher's page: its script only from itself (named exactly: app://unity serves
 * nothing but the built dist/ folder), no inline script, no eval, no plugins, no frames;
 * pictures from anywhere on https (mod icons and screenshots come from many sites);
 * styles and fonts from itself and Google Fonts. Run from source, the page is Vite's
 * dev server's, which also needs its one inline script (React's refresh hook, allowed by
 * its hash) and its live-reload connection.
 */
function protectLauncherSession() {
    const ses = session.defaultSession;
    lockPermissions(ses, { clipboardFor: LAUNCHER_ORIGINS });

    ses.webRequest.onHeadersReceived((details, callback) => {
        if (originOf(details.url) === APP_ORIGIN) {
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    "Content-Security-Policy": [
                        "default-src 'none'; script-src app://unity; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' data: blob:; worker-src 'self' blob:; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests",
                    ],
                },
            });
        } else if (isDev && originOf(details.url) === DEV_SERVER_URL) {
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    "Content-Security-Policy": [
                        "default-src 'none'; script-src localhost:5174 'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' ws://localhost:5174 data: blob:; worker-src 'self' blob:; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
                    ],
                },
            });
        } else {
            callback({});
        }
    });

    return ses;
}

let blockbenchSession = null;

/* Blockbench's own session: its policy comes with its files (blockbench/index.cjs). */
function protectBlockbenchSession() {
    if (blockbenchSession) return blockbenchSession;
    blockbenchSession = session.fromPartition(BLOCKBENCH_PARTITION);
    lockPermissions(blockbenchSession);
    return blockbenchSession;
}

/* ---------------- windows, navigation, webviews ---------------- */

/*
 * For every page the app ever makes: no <webview>, no new windows (a page that wants a
 * link opened says so, and gets the system browser), and no leaving the origin it was
 * opened on. Windows add their own rules on top (main.cjs, blockbench/index.cjs).
 */
function limitEveryPage() {
    app.on("web-contents-created", (_event, contents) => {
        contents.on("will-attach-webview", (event) => event.preventDefault());

        contents.setWindowOpenHandler(() => ({ action: "deny" }));

        // DevTools (run from source) is Chromium's own page, and keeps its own rules.
        const isDevTools = () => contents.getURL().startsWith("devtools:");

        const stayHome = (event, url) => {
            if (isDevTools()) return;
            const current = originOf(contents.getURL());
            const target = originOf(url);
            // The first load sets where home is; after that, only home.
            if (!current) {
                if (!isLauncherUrl(url) && target !== BLOCKBENCH_ORIGIN) event.preventDefault();
                return;
            }
            if (target !== current) event.preventDefault();
        };
        contents.on("will-navigate", stayHome);
        contents.on("will-redirect", stayHome);
        contents.on("will-frame-navigate", (event) => {
            // Pages have no frames of their own (their policy allows none).
            if (!event.isMainFrame && !isDevTools()) event.preventDefault();
        });
    });
}

/* ---------------- links to the outside ---------------- */

const WEB_PROTOCOLS = ["https:", "http:", "mailto:"];
// Steam's own links the launcher opens: start a game, Steam's main window, and a game's store page.
const STEAM_LINKS = [/^steam:\/\/rungameid\/\d+$/, /^steam:\/\/open\/main$/, /^steam:\/\/store\/\d+$/, /^steam:\/\/url\/CommunityFilePage\/\d+$/];

/*
 * What may leave the app for the system: an ordinary web or mail link (or, with steam,
 * Steam's own steam://rungameid/<id>, steam://open/main, steam://store/<id> or a Workshop item's
 * steam://url/CommunityFilePage/<id>), parsed, with no user name or password in it.
 * Anything else (file:, javascript:, smb:, another app's scheme) is refused. -> the link
 * to open, or null.
 */
function externalLink(target, { steam = false } = {}) {
    let url;
    try {
        url = new URL(String(target));
    } catch {
        return null;
    }

    const isSteamLink = steam && url.protocol === "steam:" && STEAM_LINKS.some((link) => link.test(url.href));
    if (!WEB_PROTOCOLS.includes(url.protocol) && !isSteamLink) return null;
    if (url.username || url.password) return null;
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.hostname) return null;
    return url.href;
}

/*
 * The one place a link leaves the app, and waits for the system to take it: rejects when
 * the link is refused or nothing opens it (so Play can say Steam didn't start).
 */
async function openExternalChecked(target, options) {
    const href = externalLink(target, options);
    if (!href) throw new Error("Refusing to open that link.");
    // The app's only call that opens anything outside it, reached only after the checks
    // above. Electronegativity reports it (it reports every openExternal whose argument
    // isn't a fixed string); security.md lists it as the one reviewed finding.
    await shell.openExternal(href);
}

/* Opens a link without waiting. -> whether it was allowed. */
function openExternalSafely(target, options) {
    const href = externalLink(target, options);
    if (!href) return false;
    openExternalChecked(href, options).catch((err) => console.warn("Couldn't open a link:", err.message));
    return true;
}

/* ---------------- who may send what ---------------- */

/*
 * Where a message to the main process may come from: the launcher's own page, in a
 * launcher window, for the launcher's messages; Blockbench's page, in its own view, for
 * its four bridge messages. Only a page's top frame, never one inside it.
 */
function trustedSender(channel, event) {
    const frame = event.senderFrame;
    if (!frame || frame.parent) return false;

    const origin = originOf(frame.url);

    if (channel.startsWith("blockbench-bridge:")) {
        return origin === BLOCKBENCH_ORIGIN && blockbenchSession !== null && event.sender.session === blockbenchSession;
    }

    return (
        LAUNCHER_ORIGINS.includes(origin) &&
        event.sender.session === session.defaultSession &&
        BrowserWindow.fromWebContents(event.sender) !== null
    );
}

/*
 * Checks the sender of every message before its handler runs, for every handler any
 * file registers, now or later (so a new one can't be added without the check).
 * A refused request is rejected, and the refusal logged.
 */
function guardIpc() {
    for (const method of ["handle", "handleOnce", "on", "once"]) {
        const register = ipcMain[method].bind(ipcMain);
        const replies = method === "handle" || method === "handleOnce";

        ipcMain[method] = (channel, listener) =>
            register(channel, (event, ...args) => {
                if (!trustedSender(String(channel), event)) {
                    console.warn(`Refused "${channel}" from ${event.senderFrame?.url || "a page that has gone"}.`);
                    if (replies) throw new Error("That page isn't allowed to ask the launcher for this.");
                    return undefined;
                }
                return listener(event, ...args);
            });
    }
}

/* ---------------- paths a page may hand back ---------------- */

/*
 * Files and folders the main process has shown the page, kept by what they were offered
 * for: "game-download" (a game's Downloads list), "import-zip" (the import dialog),
 * "cloud-backup" (the cloud backup list), "import-folder" (other launchers' instances and
 * the folder dialog) and "cloud-folder" (cloud folders found on this computer). Where a
 * page sends a path back, it has to be one offered for that same purpose: a page can't name
 * any other file or folder, nor use one offered for something else.
 */
const PURPOSES = ["game-download", "import-zip", "cloud-backup", "import-folder", "cloud-folder"];
const granted = new Map(PURPOSES.map((purpose) => [purpose, new Set()]));
const MAX_GRANTED = 5000;

const pathKey = (value) => path.resolve(String(value));

function grantPaths(purpose, ...values) {
    const set = granted.get(purpose);
    if (!set) throw new Error(`Unknown purpose "${purpose}".`);
    for (const value of values.flat()) {
        if (typeof value !== "string" || !value) continue;
        if (set.size >= MAX_GRANTED) set.delete(set.values().next().value);
        set.add(pathKey(value));
    }
}

/* Whether a path was offered for one of these purposes. */
const isGranted = (purposes, value) =>
    typeof value === "string" && value !== "" && [purposes].flat().some((purpose) => granted.get(purpose)?.has(pathKey(value)));

function assertGranted(purposes, value) {
    if (!isGranted(purposes, value)) throw new Error("Choose that again: the launcher didn't offer it for this.");
    return pathKey(value);
}

/* Everything above that needs the app to be ready. */
function protectApp() {
    protectLauncherSession();
    protectBlockbenchSession();
    serveLauncher();
}

if (inElectron) limitEveryPage();

module.exports = {
    APP_ORIGIN,
    APP_START_URL,
    DEV_SERVER_URL,
    BLOCKBENCH_SCHEME,
    BLOCKBENCH_ORIGIN,
    BLOCKBENCH_PARTITION,
    BASE_HEADERS,
    LAUNCHER_ORIGINS,
    contentType,
    fileInside,
    notFound,
    originOf,
    isLauncherUrl,
    guardIpc,
    protectApp,
    protectBlockbenchSession,
    openExternalSafely,
    openExternalChecked,
    trustedSender,
    grantPaths,
    isGranted,
    assertGranted,
};
