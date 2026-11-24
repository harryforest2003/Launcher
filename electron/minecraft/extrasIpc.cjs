const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, dialog, ipcMain, nativeImage } = require("electron");

const instanceManager = require("../instanceManager.cjs");
const servers = require("./servers.cjs");
const worldBackups = require("./worldBackups.cjs");
const { shareLog } = require("./shareLog.cjs");
const discord = require("./discord.cjs");
const modpackUpdate = require("./modpackUpdate.cjs");
const packExports = require("./packExports.cjs");
const instanceShare = require("./instanceShare.cjs");
const platformPacks = require("./platformPacks.cjs");
const { fetchJson, sha1 } = require("./net.cjs");
const { desktopShortcut } = require("./shortcuts.cjs");

/*
 * IPC for an instance's servers, world backups, picture, shared logs and desktop
 * shortcuts, and the Discord status. Every handler looks the instance up by name, so a page can't name a folder.
 */

function registerExtrasIpc() {
    /* ---------------- servers ---------------- */

    ipcMain.handle("servers:list", (_e, name) => servers.listServers(instanceManager.getInstance(name)));

    ipcMain.handle("servers:add", (_e, name, server) =>
        servers.addServer(instanceManager.getInstance(name), { name: server?.name, address: server?.address })
    );

    ipcMain.handle("servers:remove", (_e, name, server) =>
        servers.removeServer(instanceManager.getInstance(name), { index: Number(server?.index), address: String(server?.address ?? "") })
    );

    ipcMain.handle("servers:ping", (_e, address) => servers.pingServer(String(address ?? "")));

    ipcMain.handle("servers:search", (_e, options = {}) =>
        servers.searchServers({ query: String(options?.query ?? ""), sort: options?.sort, page: Number(options?.page) || 0 })
    );

    /* ---------------- world backups ---------------- */

    // A world open in the game is being written to, so it's backed up or put back only once it's closed.
    const closed = (name, doing) => {
        if (instanceManager.isRunning(name)) throw new Error(`Close Minecraft before ${doing}: the game keeps writing to its worlds while it's open.`);
        return instanceManager.getInstance(name);
    };

    ipcMain.handle("backups:list", (_e, name) => worldBackups.listBackups(instanceManager.getInstance(name)));

    ipcMain.handle("backups:create", (_e, name, folder) => worldBackups.backupWorld(closed(name, "backing up a world"), String(folder ?? "")));

    ipcMain.handle("backups:restore", (_e, name, folder, file) =>
        worldBackups.restoreBackup(closed(name, "restoring a world"), String(folder ?? ""), String(file ?? ""))
    );

    ipcMain.handle("backups:delete", (_e, name, folder, file) =>
        worldBackups.deleteBackup(instanceManager.getInstance(name), String(folder ?? ""), String(file ?? ""))
    );

    ipcMain.handle("backups:open", (_e, name, folder) => worldBackups.openBackups(instanceManager.getInstance(name), folder ? String(folder) : null));

    /* ---------------- the instance's picture ---------------- */

    // picture.png in the instance's folder, so it moves, copies and goes with the instance.
    const pictureFile = (name) => {
        instanceManager.getInstance(name);
        return path.join(instanceManager.instanceFolder(name), "picture.png");
    };
    const asDataUrl = (buffer) => `data:image/png;base64,${buffer.toString("base64")}`;

    ipcMain.handle("instance:picture", (_e, name) => {
        const file = pictureFile(name);
        return fs.existsSync(file) ? asDataUrl(fs.readFileSync(file)) : null;
    });

    // The page sends the picture already cut to a square PNG; it's read and written out
    // again here, so only a real picture ends up in the folder.
    ipcMain.handle("instance:setPicture", (_e, name, dataUrl) => {
        const file = pictureFile(name);
        const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ""));
        const buffer = match ? Buffer.from(match[1], "base64") : null;
        if (!buffer || buffer.length > 4 * 1024 * 1024) throw new Error("That picture couldn't be used. Try a PNG or JPEG.");
        let image = nativeImage.createFromBuffer(buffer);
        if (image.isEmpty()) throw new Error("That picture couldn't be used. Try a PNG or JPEG.");
        const { width, height } = image.getSize();
        if (Math.max(width, height) > 512) image = image.resize(width >= height ? { width: 512, quality: "best" } : { height: 512, quality: "best" });
        const png = image.toPNG();
        fs.writeFileSync(file, png);
        return asDataUrl(png);
    });

    ipcMain.handle("instance:clearPicture", (_e, name) => {
        fs.rmSync(pictureFile(name), { force: true });
        return null;
    });

    /* ---------------- sharing the log ---------------- */

    ipcMain.handle("log:share", (_e, name) => {
        instanceManager.getInstance(name);
        const lines = instanceManager.getLog(name)?.lines ?? [];
        if (!lines.length) throw new Error("There's no log to share yet. Start the game first.");
        return shareLog(lines);
    });

    /* ---------------- desktop shortcuts ---------------- */

    ipcMain.handle("instance:desktopShortcut", (_e, name) => {
        const instance = instanceManager.getInstance(name);
        const folder = instanceManager.instanceFolder(instance.name);
        return desktopShortcut({ name: instance.name, folder, picture: path.join(folder, "picture.png") });
    });

    /* ---------------- modpack updates ---------------- */

    ipcMain.handle("modpack:remember", (_e, name, pack) => modpackUpdate.rememberModpack(String(name ?? ""), pack));

    // A .mrpack added from a file: Modrinth knows which pack it is by its hash.
    ipcMain.handle("modpack:identifyFile", async (_e, name, file) => {
        instanceManager.getInstance(name);
        const chosen = String(file ?? "");
        if (!/\.mrpack$/i.test(chosen) || !fs.existsSync(chosen)) return null;
        try {
            const version = await fetchJson(`https://api.modrinth.com/v2/version_file/${await sha1(chosen)}?algorithm=sha1`);
            if (!version?.project_id) return null;
            return modpackUpdate.rememberModpack(name, { source: "modrinth", projectId: version.project_id, versionId: version.id, versionName: version.version_number || version.name, name: "" });
        } catch {
            return null; // Not on Modrinth (or offline): it just can't be updated from here.
        }
    });

    ipcMain.handle("modpack:update", (event, name, versionId) =>
        modpackUpdate.updateModpack(String(name ?? ""), String(versionId ?? ""), {
            onProgress: (progress) => event.sender.send("instance:progress", { name, ...progress }),
        })
    );

    ipcMain.handle("modpack:lastUpdate", (_e, name) => modpackUpdate.lastModpackUpdate(String(name ?? "")));

    ipcMain.handle("modpack:undo", (event, name) =>
        modpackUpdate.undoModpackUpdate(String(name ?? ""), {
            onProgress: (progress) => event.sender.send("instance:progress", { name, ...progress }),
        })
    );

    /* ---------------- CurseForge and server pack exports ---------------- */

    const safeName = (name) => String(name).replace(/[/\\:*?"<>|]/g, "-");
    const askWhere = async (event, title, file, filter) => {
        const picked = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
            title,
            defaultPath: path.join(app.getPath("downloads"), file),
            filters: [filter],
        });
        return picked.canceled || !picked.filePath ? null : picked.filePath;
    };

    // Asks where to save it, then writes a CurseForge modpack zip. Null if cancelled.
    ipcMain.handle("instance:exportCurseForge", async (event, name, options = {}) => {
        const instance = instanceManager.getInstance(name);
        const target = await askWhere(event, `Export ${name} for CurseForge`, `${safeName(name)}-curseforge.zip`, { name: "CurseForge modpack", extensions: ["zip"] });
        if (!target) return null;
        return packExports.exportCurseForge(instance, instanceManager.instanceFolder(name), target, {
            name: instance.name,
            worlds: Boolean(options.worlds),
            options: Boolean(options.options),
        });
    });

    // Asks where to save it, then writes a server pack zip. Null if cancelled.
    ipcMain.handle("instance:exportServerPack", async (event, name) => {
        const instance = instanceManager.getInstance(name);
        if (String(instance.loader || "vanilla").toLowerCase() === "vanilla") {
            throw new Error("A vanilla instance needs no server pack: Minecraft's own server runs it.");
        }
        const target = await askWhere(event, `Export a server pack of ${name}`, `${safeName(name)}-server.zip`, { name: "Server pack", extensions: ["zip"] });
        if (!target) return null;
        return packExports.exportServerPack(instance, instanceManager.instanceFolder(name), target);
    });

    /* ---------------- share codes ---------------- */

    // The instance as a share code: { code, linked, missing }.
    ipcMain.handle("share:instanceCode", (_event, name) => instanceShare.instanceShareCode(name));
    // What a pasted code holds, without making anything.
    ipcMain.handle("share:readInstanceCode", (_event, code) => instanceShare.readInstanceCode(code));
    // A new instance from a pasted code, with its files downloaded.
    ipcMain.handle("share:importInstance", (event, code, name) =>
        instanceShare.importInstanceCode(code, {
            name: typeof name === "string" ? name : undefined,
            onProgress: (progress) => {
                if (!event.sender.isDestroyed()) event.sender.send("instance:progress", progress);
            },
        })
    );

    /* ---------------- Discord status ---------------- */

    discord.startDiscordStatus();
    ipcMain.handle("discord:test", (_e, clientId) => discord.testDiscord(clientId));
    ipcMain.handle("discord:state", () => discord.discordState());

    /* ---------------- FTB, Technic and ATLauncher modpacks ---------------- */

    ipcMain.handle("platformPacks:search", (_e, platform, options = {}) =>
        platformPacks.search(String(platform ?? ""), {
            query: String(options?.query ?? ""),
            page: Number(options?.page) || 1,
            mcVersion: typeof options?.mcVersion === "string" ? options.mcVersion : null,
            loader: typeof options?.loader === "string" ? options.loader : null,
            perPage: Number(options?.perPage) || undefined,
        })
    );

    ipcMain.handle("platformPacks:versions", (_e, platform, id) => platformPacks.versions(String(platform ?? ""), String(id ?? "")));

    ipcMain.handle("platformPacks:install", (event, platform, id, versionId, name) =>
        platformPacks.install(String(platform ?? ""), String(id ?? ""), String(versionId ?? ""), name ? String(name) : "", {
            createInstanceFrom: instanceManager.createInstanceFrom,
            uniqueName: instanceManager.uniqueName,
            onProgress: (progress) => {
                if (!event.sender.isDestroyed()) event.sender.send("instance:progress", progress);
            },
        })
    );

    /* ---------------- offline test accounts ---------------- */

    // A player name without Microsoft, for testing; it becomes the active account.
    ipcMain.handle("account:addOffline", (_e, name) => {
        const account = require("./account.cjs");
        account.addOfflineAccount(name);
        const accounts = account.listAccounts();
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send("account:changed", accounts);
        return accounts;
    });
}

module.exports = { registerExtrasIpc };
