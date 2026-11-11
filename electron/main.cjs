console.log("MAIN.CJS LOADED");

// First, because it decides where everything after it keeps its data.
require("./paths.cjs");
// Early, because Blockbench's files are served on a scheme that has to exist before ready.
const { registerBlockbenchIpc } = require("./blockbench/index.cjs");

const {
    getInstances,
    launchInstance,
    getInstancesStorage
} = require("./instanceManager.cjs");

const { registerModIpc } = require("./mods/index.cjs");
const { registerInstanceIpc, saveAccount } = require("./minecraft/ipc.cjs");
const { accountForLaunch } = require("./minecraft/account.cjs");
const { registerSkinBuilderIpc } = require("./skinBuilder/ipc.cjs");

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");

const minecraftAPI = require("./minecraftApi.cjs");

const { curseforgeFetch } = require("./curseforge.cjs");
const { browse, resolveProjectLink } = require("./minecraft/modSearch.cjs");
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
                lower === "neoforge"
            ) {
                loaders.add(cat);
            }
        }
    }

    const normalizedVersions = files.map(file => ({
        id: file.id,
        name: file.displayName,
        version_number: file.fileName,
        version_type:
            file.releaseType === 1
                ? "Release"
                : file.releaseType === 2
                ? "Beta"
                : file.releaseType === 3
                ? "Alpha"
                : "Unknown",

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
ipcMain.handle("project:resolveLink", (_event, link) => resolveProjectLink(link));

// ---------------- PROJECT GET ----------------

ipcMain.handle("project:get", async (_event, source, id) => {
    try {
        if (source === "modrinth") {
            const [projectRes, versionsRes, membersRes] = await Promise.all([
                fetch(`https://api.modrinth.com/v2/project/${id}`),
                fetch(`https://api.modrinth.com/v2/project/${id}/version`),
                fetch(`https://api.modrinth.com/v2/project/${id}/members`)
            ]);

            const project = await projectRes.json();
            const versions = await versionsRes.json();
            const members = await membersRes.json();

            return normalizeModrinthProject(project, versions, members);
        }

        const [projectRes, filesRes, descriptionRes] = await Promise.all([
            curseforgeFetch(`/mods/${id}`),
            curseforgeFetch(`/mods/${id}/files?pageSize=100`),
            curseforgeFetch(`/mods/${id}/description`)
        ]);

        const project = (await projectRes.json()).data;
        const files = (await filesRes.json()).data;
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
    { id: "quilt", name: "Quilt" }
]);

ipcMain.handle("instances:get", () => getInstances());
ipcMain.handle("instances:storage", () => getInstancesStorage());

// Exposed in preload.cjs but previously unhandled, so the Launch button
// rejected with "No handler registered for 'minecraft:launch'".
ipcMain.handle("minecraft:launch", async (_, name) => {
    return launchInstance(name, await accountForLaunch(name));
});


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

function createWindow() {
    const win = new BrowserWindow({
        width: 1600,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        autoHideMenuBar: true,
        // Windows and Linux show this in the title bar and taskbar; a Mac uses the app's own icon.
        ...(process.platform === "darwin" ? {} : { icon: path.join(__dirname, "..", "build", "icons", "512x512.png") }),
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    win.maximize();

    /*
     * Project pages contain links written by strangers. Opening one inside the app
     * would hand that site the launcher's preload APIs, or navigate the launcher
     * away entirely, so links go to the system browser instead.
     */
    const openExternally = (url) => {
        if (/^(https?:\/\/|mailto:)/i.test(url)) shell.openExternal(url);
    };

    win.webContents.setWindowOpenHandler(({ url }) => {
        openExternally(url);
        return { action: "deny" };
    });

    win.webContents.on("will-navigate", (event, url) => {
        if (new URL(url).origin === new URL(win.webContents.getURL()).origin) return;
        event.preventDefault();
        openExternally(url);
    });

    if (isDev) {
        win.loadURL("http://localhost:5174");
        win.webContents.openDevTools();
    } else {
        win.loadFile(path.join(__dirname, "../dist/index.html"));
    }
}

app.whenReady().then(() => {
    // Run from source, the Dock would show Electron's icon; the installed app has its own.
    const devIcon = path.join(__dirname, "..", "build", "icon.png");
    if (process.platform === "darwin" && !app.isPackaged && fs.existsSync(devIcon)) app.dock?.setIcon(devIcon);

    // Both need app.getPath("userData"), so they can't run at module load.
    registerModIpc();
    registerInstanceIpc();
    registerSkinBuilderIpc();
    registerBlockbenchIpc();
    createWindow();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});