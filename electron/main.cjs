console.log("MAIN.CJS LOADED");

// First, because it decides where everything after it keeps its data.
require("./paths.cjs");
// Next, because the app's schemes have to exist before ready, and every message handler
// registered after this has its sender checked (see security.cjs).
const security = require("./security.cjs");
security.guardIpc();
const { registerBlockbenchIpc } = require("./blockbench/index.cjs");
const { registerDashboardIpc } = require("./dashboard/index.cjs");

const {
    getInstances,
    getInstancesStorage
} = require("./instanceManager.cjs");

const { registerModIpc } = require("./mods/index.cjs");
const { registerGamesIpc, handleNxm } = require("./games/ipc.cjs");
const { registerInstanceIpc, launchAs, saveAccount } = require("./minecraft/ipc.cjs");
const { registerSkinBuilderIpc } = require("./skinBuilder/ipc.cjs");

const { app, BrowserWindow, ipcMain, session } = require("electron");
const fs = require("fs");
const path = require("path");

const minecraftAPI = require("./minecraftApi.cjs");
const loaderInstall = require("./minecraft/loaders.cjs");

const { curseforgeFetch } = require("./curseforge.cjs");
const { browse, resolveProjectLink } = require("./minecraft/modSearch.cjs");
const { packContents } = require("./minecraft/packContents.cjs");
const { curseForgeType, modrinthType } = require("./minecraft/contentTypes.cjs");


// ---------------- MODRINTH NORMALIZER ----------------

function normalizeModrinthProject(project, versions = [], members = []) {
    const page = `https://modrinth.com/project/${project.slug}`;

    return {
        source: "modrinth",
        installable: true,
        url: page,
        id: project.id,
        title: project.title,
        description: project.description,
        body: project.body,
        icon: project.icon_url,
        downloads: project.downloads,
        followers: project.followers,
        type: modrinthType(project),
        created: project.published,
        updated: project.updated,

        website:
            project.link_urls?.homepage ||
            project.link_urls?.source ||
            page,

        authors: Array.isArray(members)
            ? members
                .map(m => m.user?.username)
                .filter(Boolean)
            : [],

        gallery: project.gallery ?? [],

        minecraftVersions: [
            ...new Set(versions.flatMap(v => v.game_versions ?? []))
        ],

        loaders: [
            ...new Set(versions.flatMap(v => v.loaders ?? []))
        ],

        versions,
    };
}

// ---------------- CURSEFORGE NORMALIZER ----------------

function normalizeCurseForgeProject(project, files = [], description = null) {
    const minecraftVersions = new Set();
    const loaders = new Set();

    for (const file of files) {
        for (const gv of file.sortableGameVersions ?? []) {
            if (/^\d+\.\d+/.test(gv.gameVersionName)) {
                minecraftVersions.add(gv.gameVersionName);
            }
        }

        for (const cat of file.gameVersions ?? []) {
            const lower = cat.toLowerCase();
            if (
                lower === "forge" ||
                lower === "fabric" ||
                lower === "quilt" ||
                lower === "neoforge" ||
                lower === "liteloader"
            ) {
                loaders.add(cat);
            }
        }
    }

    const normalizedVersions = files.map(file => ({
        id: file.id,
        name: file.displayName,
        version_number: file.fileName,
        // Modrinth's words for the same thing, so both read alike everywhere.
        version_type:
            file.releaseType === 2
                ? "beta"
                : file.releaseType === 3
                ? "alpha"
                : "release",

        game_versions: (file.sortableGameVersions ?? [])
            .map(v => v.gameVersionName)
            .filter(v => /^\d+\.\d+/.test(v)),

        loaders: (file.gameVersions ?? []).filter(v =>
            ["Forge", "Fabric", "NeoForge", "Quilt"].includes(v)
        ),

        downloads: file.downloadCount,
        date_published: file.fileDate,
    }));

    return {
        source: "curseforge",
        // Authors can forbid third-party downloads.
        installable: project.allowModDistribution !== false,
        url: project.links?.websiteUrl ?? null,
        id: project.id,
        title: project.name,
        description: project.summary,
        // The summary is one line. The full page comes from its own endpoint.
        body: description || project.summary,
        icon: project.logo?.url,
        downloads: project.downloadCount,
        followers: project.thumbsUpCount,
        type: curseForgeType(project.classId),
        created: project.dateCreated,
        updated: project.dateModified,
        website: project.links?.websiteUrl ?? null,
        authors: (project.authors ?? []).map(a => a.name),
        gallery: project.screenshots ?? [],
        minecraftVersions: [...minecraftVersions].sort(),
        loaders: [...loaders].sort(),
        versions: normalizedVersions,
    };
}

// ---------------- BROWSING ----------------

ipcMain.handle("catalog:browse", (_event, options) => browse(options));
// A link to a project, as src/utils/projectLinks.ts reads one: { source, slug | id, type }.
const LINK_SLUG = /^[\w.-]{1,100}$/;
ipcMain.handle("project:resolveLink", async (_event, link) => {
    if (!link || typeof link !== "object") return null;
    const { source, slug, id, type } = link;
    if (source !== "modrinth" && source !== "curseforge") return null;
    const clean = {
        source,
        slug: typeof slug === "string" && LINK_SLUG.test(slug) ? slug : undefined,
        id: (typeof id === "string" || typeof id === "number") && /^\d{1,12}$/.test(String(id)) ? String(id) : undefined,
        type: typeof type === "string" && /^[a-z]{1,20}$/.test(type) ? type : undefined,
    };
    if (!clean.slug && !clean.id) return null;
    if (source === "modrinth" && !clean.slug) return null;
    try {
        return await resolveProjectLink(clean);
    } catch {
        return null;
    }
});

// ---------------- PROJECT GET ----------------

// A project id or slug, as the sites use them: never a path to another part of their API.
const PROJECT_ID = /^[\w.-]{1,100}$/;

// What one modpack version contains. Version ids as the sites write them: Modrinth's
// base62, CurseForge's numbers.
ipcMain.handle("pack:contents", (_event, source, projectId, versionId) => {
    const project = String(projectId ?? "");
    const version = String(versionId ?? "");
    const valid = source === "modrinth"
        ? PROJECT_ID.test(project) && /^[A-Za-z0-9]{1,32}$/.test(version)
        : source === "curseforge" && /^\d{1,12}$/.test(project) && /^\d{1,12}$/.test(version);
    if (!valid) throw new Error("That isn't a modpack version.");
    return packContents(source, project, version);
});

ipcMain.handle("project:get", async (_event, source, rawId) => {
    const id = String(rawId ?? "");
    if (!PROJECT_ID.test(id) || (source !== "modrinth" && source !== "curseforge")) return null;

    try {
        if (source === "modrinth") {
            const [projectRes, versionsRes, membersRes] = await Promise.all([
                fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(id)}`),
                fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(id)}/version`),
                fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(id)}/members`)
            ]);

            const project = await projectRes.json();
            const versions = await versionsRes.json();
            const members = await membersRes.json();

            return normalizeModrinthProject(project, versions, members);
        }

        const [projectRes, filesRes, descriptionRes] = await Promise.all([
            curseforgeFetch(`/mods/${encodeURIComponent(id)}`),
            curseforgeFetch(`/mods/${encodeURIComponent(id)}/files?pageSize=100`),
            curseforgeFetch(`/mods/${encodeURIComponent(id)}/description`)
        ]);

        const project = (await projectRes.json()).data;
        const firstPage = await filesRes.json();
        const files = firstPage.data ?? [];

        // Long-lived packs have hundreds of versions, and an older one may be the one wanted.
        const total = Math.min(firstPage.pagination?.totalCount ?? 0, 500);
        const more = [];
        for (let index = 100; index < total; index += 100) {
            more.push(curseforgeFetch(`/mods/${encodeURIComponent(id)}/files?pageSize=100&index=${index}`)
                .then((res) => (res.ok ? res.json() : { data: [] }))
                .then((json) => json.data ?? [])
                .catch(() => []));
        }
        files.push(...(await Promise.all(more)).flat());
        // Only the summary shows if this one call fails, not an error page.
        const description = descriptionRes.ok ? (await descriptionRes.json()).data : null;

        return normalizeCurseForgeProject(project, files, description);

    } catch (err) {
        // These say what's wrong better than "couldn't be loaded" would.
        if (err?.code === "CURSEFORGE_BUSY" || err?.code === "NO_API_KEY") throw err;
        console.error(err);
        return null;
    }
});

// ---------------- MINECRAFT + INSTANCES ----------------

ipcMain.handle("minecraft:getVersions", () => minecraftAPI.getVersions());
ipcMain.handle("minecraft:getFabricVersions", (_, v) => minecraftAPI.getFabricVersions(v));
ipcMain.handle("minecraft:getQuiltVersions", (_, v) => minecraftAPI.getQuiltVersions(v));
ipcMain.handle("minecraft:getForgeVersions", (_, v) => minecraftAPI.getForgeVersions(v));
ipcMain.handle("minecraft:getNeoForgeVersions", (_, v) => minecraftAPI.getNeoForgeVersions(v));
ipcMain.handle("minecraft:getLoaders", () => [
    { id: "vanilla", name: "Vanilla" },
    { id: "fabric", name: "Fabric" },
    { id: "forge", name: "Forge" },
    { id: "neoforge", name: "NeoForge" },
    { id: "quilt", name: "Quilt" },
    { id: "legacy-fabric", name: "Legacy Fabric" },
    { id: "babric", name: "Babric" },
    { id: "liteloader", name: "LiteLoader" }
]);
// Builds of any loader for a Minecraft version, and the versions an old-only loader works with.
ipcMain.handle("minecraft:getLoaderVersions", (_, loader, v) => loaderInstall.listLoaderVersions(loader, v));
ipcMain.handle("minecraft:getLoaderGameVersions", (_, loader) => loaderInstall.loaderGameVersions(loader));

/*
 * The launcher's window in or out of full screen (F11, the controller's View button, the
 * Settings switch). Passing nothing only asks. The page hears the change from the window's
 * own events, which a Mac sends once its animation ends.
 */
ipcMain.handle("window:fullScreen", (event, on) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    if (typeof on === "boolean") win.setFullScreen(on);
    return win.isFullScreen();
});

ipcMain.handle("instances:get", () => getInstances());
ipcMain.handle("instances:storage", () => getInstancesStorage());

// Exposed in preload.cjs but previously unhandled, so the Launch button
// rejected with "No handler registered for 'minecraft:launch'".
// As instance:launch: as the account with this id, or the active one.
ipcMain.handle("minecraft:launch", (_, name, accountId) => launchAs(name, accountId));


// ---------------- MICROSOFT LOGIN (FIXED FLOW) ----------------

const { loginMicrosoft } = require("./auth/index.cjs");

// Only what the page displays. Tokens stay in this process.
ipcMain.handle("auth:login", async () => {
    const result = await loginMicrosoft();
    const account = saveAccount(result);
    const { listAccounts } = require("./minecraft/account.cjs");
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("account:changed", listAccounts());

    return { name: account.name, uuid: account.uuid, skin: account.skin };
});

ipcMain.handle("minecraft:searchPlayers", async (_event, query) => {
    return await minecraftAPI.searchPlayers(query);
});

// ---------------- WINDOW ----------------

const isDev = !app.isPackaged;

/*
 * Nexus Mods' "Mod Manager Download" button opens an nxm:// link, which the system hands
 * to this app: on a Mac as an open-url event, elsewhere as an argument to a second copy
 * of the app, which passes it here and quits. Links that arrive before the window has
 * loaded wait for it, so the page can show the download.
 */
const pendingNxm = [];
let pageReady = false;

// Only a link the size of a real one, in the form Nexus Mods sends (checked again by parseNxm).
const isNxmLink = (link) => typeof link === "string" && link.length <= 2048 && /^nxm:\/\/[\w-]+\/mods\/\d+\/files\/\d+\/?(\?[^\s#]*)?$/i.test(link);

function takeNxm(link) {
    if (!isNxmLink(link)) return;
    if (pageReady) handleNxm(link);
    else if (pendingNxm.length < 20) pendingNxm.push(link);
}

/*
 * A desktop shortcut starts the app with --launch-instance=<name> (see minecraft/shortcuts.cjs).
 * The page plays it as the Library's Play button would; one asked for before the page has
 * loaded waits for it.
 */
const { launchArg } = require("./minecraft/shortcuts.cjs");
let pendingLaunch = null;

function takeLaunch(argv) {
    const name = launchArg(argv);
    if (!name) return;
    const win = BrowserWindow.getAllWindows()[0];
    if (pageReady && win) win.webContents.send("shortcut:launch", name);
    else pendingLaunch = name;
}

// Only the installed app handles these links: run from source, it would claim them for Electron.
// A copy started on a throwaway profile (scripts/check-app-starts.cjs) leaves them to the real one.
// A second copy of the installed app hands its link to the first and quits, without a window.
const secondCopy = app.isPackaged && !app.requestSingleInstanceLock();
if (app.isPackaged) {
    if (secondCopy) {
        app.quit();
    } else {
        // The system sends nxm:// links here because the installed app declares them, so
        // the app changes no system setting itself: the Mac app's Info.plist and Linux's
        // .desktop file list the scheme (package.json build.protocols), and the Windows
        // installer registers it (scripts/nxm-protocol.nsh). Links reach only takeNxm.
        app.on("second-instance", (_event, argv) => {
            argv.filter(isNxmLink).forEach(takeNxm);
            takeLaunch(argv);
            const win = BrowserWindow.getAllWindows()[0];
            if (win) {
                if (win.isMinimized()) win.restore();
                win.focus();
            }
        });
        process.argv.filter(isNxmLink).forEach(takeNxm);
        takeLaunch(process.argv);
    }
}
app.on("open-url", (event, url) => {
    if (!/^nxm:/i.test(String(url))) return;
    event.preventDefault();
    takeNxm(url);
});

function createWindow() {
    const win = new BrowserWindow({
        width: 1600,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        autoHideMenuBar: true,
        // Dark from the first frame, so there's no white flash before the page paints its colours.
        backgroundColor: "#141414",
        // Windows and Linux show this in the title bar and taskbar; a Mac uses the app's own icon.
        ...(process.platform === "darwin" ? {} : { icon: path.join(__dirname, "..", "build", "icons", "512x512.png") }),
        webPreferences: {
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
            // A middle click on a link would otherwise try to open it in a new window.
            disableBlinkFeatures: "Auxclick",
        },
    });

    win.maximize();

    win.on("enter-full-screen", () => win.webContents.send("window:fullScreen", true));
    win.on("leave-full-screen", () => win.webContents.send("window:fullScreen", false));

    win.webContents.once("did-finish-load", () => {
        pageReady = true;
        pendingNxm.splice(0).forEach(handleNxm);
        if (pendingLaunch) win.webContents.send("shortcut:launch", pendingLaunch);
        pendingLaunch = null;
    });

    /*
     * Project pages contain links written by strangers. Opening one inside the app
     * would hand that site the launcher's preload APIs, or navigate the launcher
     * away entirely, so links go to the system browser instead (web and mail links
     * only: see security.openExternalSafely).
     */
    win.webContents.setWindowOpenHandler(({ url }) => {
        security.openExternalSafely(url);
        return { action: "deny" };
    });

    win.webContents.on("will-navigate", (event, url) => {
        if (security.isLauncherUrl(url) && security.originOf(url) === security.originOf(win.webContents.getURL())) return;
        event.preventDefault();
        security.openExternalSafely(url);
    });

    if (isDev) {
        win.loadURL(security.DEV_SERVER_URL);
        win.webContents.openDevTools();
    } else {
        // Served by security.cjs from dist/, on the app's own scheme rather than file://.
        win.loadURL(security.APP_START_URL);
    }
}

app.whenReady().then(() => {
    if (secondCopy) return;

    // Run from source, the Dock would show Electron's icon; the installed app has its own.
    const devIcon = path.join(__dirname, "..", "build", "icon.png");
    if (process.platform === "darwin" && !app.isPackaged && fs.existsSync(devIcon)) app.dock?.setIcon(devIcon);

    // Policies, permissions and the app:// scheme for every session, before any page loads.
    security.protectApp();

    // The launcher's bridge (preload.cjs), for its session: it gives functions only to the
    // launcher's own page, and has no Electron or Node object to give.
    session.defaultSession.registerPreloadScript({ type: "frame", id: "unity-launcher", filePath: path.join(__dirname, "preload.cjs") });

    // Sign-in tokens older versions left as plain text go into encrypted storage (once).
    try {
        require("./auth/legacyTokens.cjs").moveLegacyTokens();
    } catch (err) {
        console.warn("Couldn't move old sign-in files into encrypted storage:", err.message);
    }

    // Both need app.getPath("userData"), so they can't run at module load.
    registerModIpc();
    registerGamesIpc();
    registerInstanceIpc();
    // An instance's servers, world backups, picture, shared logs and desktop shortcuts.
    require("./minecraft/extrasIpc.cjs").registerExtrasIpc();
    registerSkinBuilderIpc();
    registerBlockbenchIpc();
    // Home's play time, activity, news and Steam deals.
    registerDashboardIpc();
    // Settings' About, storage, startup, notifications and settings backup.
    require("./launcherApp.cjs").registerLauncherAppIpc();
    // Downloads newer builds from GitHub and puts them in when the launcher quits.
    require("./updater.cjs").registerUpdater();
    createWindow();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});