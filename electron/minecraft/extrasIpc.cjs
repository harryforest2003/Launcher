const fs = require("fs");
const path = require("path");
const { ipcMain, nativeImage } = require("electron");

const instanceManager = require("../instanceManager.cjs");
const servers = require("./servers.cjs");
const worldBackups = require("./worldBackups.cjs");
const { shareLog } = require("./shareLog.cjs");
const discord = require("./discord.cjs");
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

    /* ---------------- Discord status ---------------- */

    discord.startDiscordStatus();
    ipcMain.handle("discord:test", (_e, clientId) => discord.testDiscord(clientId));
    ipcMain.handle("discord:state", () => discord.discordState());
}

module.exports = { registerExtrasIpc };
