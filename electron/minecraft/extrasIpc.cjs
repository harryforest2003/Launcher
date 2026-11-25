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
const sharedInstances = require("./sharedInstances.cjs");
const gameUsage = require("./gameUsage.cjs");
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

    // A modpack's icon from its site, for the page to cut square and save as the instance's
    // picture. The page can't download it itself (its connections stay on the launcher), so
    // it comes through here: https only, a picture type, at most 4 MB.
    const PICTURE_TYPES = /^image\/(png|jpeg|webp|gif)$/;
    ipcMain.handle("instance:downloadPicture", async (_e, url) => {
        const address = new URL(String(url ?? ""));
        if (address.protocol !== "https:") throw new Error("Pack icons only come over https.");
        const res = await fetch(address, { signal: AbortSignal.timeout(20 * 1000) });
        if (!res.ok) throw new Error(`${address.host} answered HTTP ${res.status}.`);
        const type = String(res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!PICTURE_TYPES.test(type)) throw new Error("That address isn't a picture.");
        const buffer = Buffer.from(await res.arrayBuffer());
        if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw new Error("That picture is too big to use.");
        return `data:${type};base64,${buffer.toString("base64")}`;
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

    /* ---------------- shared instances ---------------- */

    const sendProgress = (event) => (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send("instance:progress", progress);
    };

    // Publishes the instance's current state. The file's place is only ever picked in a save
    // dialog here, never named by the page. Null if cancelled.
    ipcMain.handle("shared:publish", async (event, name, options = {}) => {
        const instance = instanceManager.getInstance(name);
        let target = instance.shared?.role === "owner" ? instance.shared.path : null;
        if (!target || options?.choose) {
            const picked = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
                title: `Share ${instance.name} live`,
                defaultPath:
                    target ||
                    sharedInstances.suggestedPath(instance.name) ||
                    path.join(app.getPath("downloads"), `${safeName(instance.name)}${sharedInstances.EXTENSION}`),
                filters: [{ name: "Shared instance", extensions: [sharedInstances.EXTENSION.slice(1)] }],
            });
            if (picked.canceled || !picked.filePath) return null;
            target = picked.filePath;
        }
        return sharedInstances.publish(name, { target });
    });
    // Picks a shared file to join. Null if cancelled.
    ipcMain.handle("shared:chooseFile", async (event) => {
        const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
            title: "Join a shared instance",
            properties: ["openFile"],
            filters: [{ name: "Shared instance", extensions: [sharedInstances.EXTENSION.slice(1)] }],
        });
        return picked.canceled ? null : (picked.filePaths[0] ?? null);
    });
    // What a shared file holds, before joining it.
    ipcMain.handle("shared:read", async (_event, source) => {
        const remote = await sharedInstances.readShareFile(source);
        const { files, missing } = instanceShare.readInstanceCode(remote.code);
        return { name: remote.name, version: remote.version, loader: remote.loader, revision: remote.revision, updated: remote.updated, files, missing };
    });
    ipcMain.handle("shared:join", (event, source, name) =>
        sharedInstances.join(source, { name: typeof name === "string" && name.trim() ? name.trim() : undefined, onProgress: sendProgress(event) })
    );
    ipcMain.handle("shared:check", (_event, name) => sharedInstances.check(name));
    ipcMain.handle("shared:update", (event, name) => sharedInstances.update(name, { onProgress: sendProgress(event) }));
    ipcMain.handle("shared:leave", (_event, name) => sharedInstances.leave(name));

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

    /* ---------------- Ely.by accounts ---------------- */

    // Signs in at Ely.by (with the authenticator code when it asks for one); the account
    // becomes the active one. The password goes to Ely.by only and isn't kept.
    ipcMain.handle("account:elySignIn", async (_e, login, password, code) => {
        const account = require("./account.cjs");
        const elyBy = require("../auth/elyBy.cjs");
        try {
            account.saveElyAccount(await elyBy.signIn(login, password, code));
        } catch (err) {
            // The page asks for the code when the message starts with this.
            if (err?.code === "ELY_NEEDS_CODE") throw new Error(`ELY_NEEDS_CODE: ${err.message}`);
            throw err;
        }
        const accounts = account.listAccounts();
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send("account:changed", accounts);
        return accounts;
    });

    /* ---------------- malware check ---------------- */

    // The instance's mods looked up on Modrinth and CurseForge and read for signs of malware,
    // and this computer checked for fractureiser's files. only: just these file names.
    // Memory and CPU of an instance's running game, or null when it isn't running.
    ipcMain.handle("instance:usage", (_e, name) => {
        const pid = instanceManager.runningPid(String(name ?? ""));
        return pid ? gameUsage.usage(pid) : null;
    });

    ipcMain.handle("safety:check", (_e, name, only) => {
        const instance = instanceManager.getInstance(name);
        if (!instance) throw new Error("No such instance.");
        return require("./safetyCheck.cjs").checkInstance(instanceManager.instanceFolder(name), {
            version: instance.version,
            only: Array.isArray(only) ? only.filter((file) => typeof file === "string") : undefined,
        });
    });
}

module.exports = { registerExtrasIpc };
