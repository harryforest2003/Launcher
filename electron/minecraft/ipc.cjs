const launchReservations = require("./launchReservations.cjs").createLaunchReservations();
const fs = require("fs");
const path = require("path");
const { app, ipcMain, shell, dialog, BrowserWindow } = require("electron");

const instanceManager = require("../instanceManager.cjs");
const instanceMods = require("./instanceMods.cjs");
const instanceFiles = require("./instanceFiles.cjs");
const worlds = require("./worlds.cjs");
const javaRuntime = require("./javaRuntime.cjs");
const modUpdates = require("./modUpdates.cjs");
const worldBackups = require("./worldBackups.cjs");
const loaderUpdates = require("./loaderUpdates.cjs");
const modpackExport = require("./modpackExport.cjs");
const modSearch = require("./modSearch.cjs");
const modDependencies = require("./modDependencies.cjs");
const optimise = require("./optimise.cjs");
const { contentDetails } = require("./contentDetails.cjs");
const account = require("./account.cjs");
const modpack = require("./modpack.cjs");
const importer = require("./importer.cjs");
const cloud = require("./cloud.cjs");
const skins = require("./skins.cjs");
const github = require("./github.cjs");
const starterMods = require("./starterMods.cjs");
const curseforge = require("../curseforge.cjs");
const launcherSettings = require("./settings.cjs");
const { clearSecret, getSecret, isPersonal, secretStatus, setSecret } = require("../secrets.cjs");
const { assertGranted, grantPaths } = require("../security.cjs");

/*
 * IPC for instance management and per-instance mods.
 */

function send(event, channel, payload) {
    BrowserWindow.fromWebContents(event.sender)
        ?.webContents.send(channel, payload);
}

/*
 * A modpack description carries its full file manifest (485 entries for
 * a big pack). The renderer only needs the summary, so drop the heavy
 * fields before sending it across IPC.
 */
function stripHeavy(info) {
    const { index, manifest, ...rest } = info;
    void index;
    void manifest;

    return rest;
}

/*
 * Asks each service whether a key works before it's saved, so a saved key is one
 * that's known to work. Only the service the key belongs to ever sees it.
 */
const KEY_CHECKS = {
    modrinth: (key) => ["https://api.modrinth.com/v2/user", { Authorization: key }],
    nexus: (key) => ["https://api.nexusmods.com/v1/users/validate.json", { apikey: key }],
    github: (key) => ["https://api.github.com/rate_limit", { Authorization: `Bearer ${key}` }],
    modio: (key) => [`https://api.mod.io/v1/games?${new URLSearchParams({ api_key: key, _limit: "1" })}`, {}],
    steam: (key) => [`https://api.steampowered.com/ISteamWebAPIUtil/GetSupportedAPIList/v1/?${new URLSearchParams({ key })}`, {}],
    // Saved as "username:token"; the portal checks both together.
    factorio: (key) => {
        const at = key.indexOf(":");
        if (at <= 0 || at === key.length - 1) throw new Error("Enter your Factorio username, a colon, then your token (both are on factorio.com/profile).");
        const body = JSON.stringify({ username: key.slice(0, at).trim(), token: key.slice(at + 1).trim(), query: "", page_size: 1 });
        return ["https://mods.factorio.com/api/search", { "Content-Type": "application/json" }, { method: "POST", body }];
    },
};

const KEY_LABELS = { modrinth: "Modrinth", nexus: "Nexus Mods", github: "GitHub", modio: "mod.io", steam: "Steam", factorio: "Factorio" };

async function checkKey(name, key) {
    const check = KEY_CHECKS[name];
    if (!check) throw new Error(`"${name}" is not an API key this app uses.`);

    const label = KEY_LABELS[name];
    const [url, headers, init] = check(key);

    let res;
    try {
        res = await fetch(url, {
            ...init,
            headers: { ...headers, Accept: "application/json", "User-Agent": "UnityLauncher/1.0" },
            signal: AbortSignal.timeout(15 * 1000),
        });
    } catch {
        throw new Error(`Couldn't reach ${label} to check that. Check your internet connection and try again.`);
    }

    if (res.ok) return;

    if (res.status === 401 || res.status === 403) {
        throw new Error(`${label} didn't accept that. Check it was copied in full, and try again.`);
    }

    throw new Error(`${label} couldn't check it just now (HTTP ${res.status}). Try again in a minute.`);
}

/* CurseForge counts as set up when it can be reached, by a key here or the proxy. */
function withCurseForge(statuses) {
    return { ...statuses, curseforge: { set: curseforge.available(), fromEnvironment: false, hint: null } };
}

/* Whatever holds a key in memory, or results found with it, starts again. */
function keyChanged(name) {
    modSearch.resetCatalog();
    if (name === "nexus") require("../mods/providers/nexus.cjs").setApiKey(getSecret("nexus"));
    // Which games mod.io and the Workshop have was asked with the old key.
    require("../games/sources/http.cjs").forget(`${name === "steam" ? "workshop" : name}:`);
}

/*
 * Starts an instance's game as one signed-in account (its id), or the active one when none
 * is given. The id has to be a saved account's. An account already in another game is
 * refused before its sign-in is renewed, and again, finally, as the game starts.
 */
async function launchAs(name, accountId, { quickPlay = null } = {}) {
    const instance = instanceManager.getInstance(name);
    const id = account.checkAccountId(accountId) ?? account.listAccounts().find((entry) => entry.active)?.uuid ?? null;

    const busy = instanceManager.instanceUsing(id);
    if (busy && busy !== instance.name) {
        const who = account.listAccounts().find((entry) => entry.uuid === id)?.name ?? "That account";
        throw new Error(`${who} is already playing "${busy}". Minecraft allows one game per account at a time, so play this one as another account, or close "${busy}" first.`);
    }

    const release = launchReservations.reserve(instance.name, id);
    try {
        const acct = await account.accountForLaunch(instance.name, id);
        const result = await instanceManager.launchInstance(name, acct, { quickPlay });
        return { ...result, online: acct.online, playerName: acct.name };
    } finally {
        release();
    }
}

function registerInstanceIpc() {

    /* ---------------- instances ---------------- */

    ipcMain.handle("instance:list", () => instanceManager.getInstances());

    // With whether its game is open, and as whom.
    ipcMain.handle("instance:get", (_e, name) => instanceManager.withRunState(instanceManager.getInstance(name)));

    ipcMain.handle("instance:create", async (event, config) => {
        const onProgress = (progress) => send(event, "instance:progress", { name: config.name, ...progress });
        const created = await instanceManager.createInstance(config, { onProgress });

        // Starter mods, unless the page said not to. What couldn't be added is reported.
        const starter = config.starterMods === false
            ? null
            : await starterMods.installStarterMods(created, instanceManager.instanceFolder(created.name), { onProgress });

        return { ...created, starter };
    });

    ipcMain.handle("starterMods:list", () => starterMods.readList());
    ipcMain.handle("starterMods:save", (_e, list) => starterMods.writeList(list));
    ipcMain.handle("starterMods:add", (_e, input) => starterMods.addToList(input));
    ipcMain.handle("starterMods:reset", () => starterMods.resetList());

    ipcMain.handle("instance:repair", async (event, name) => {
        return instanceManager.repairInstance(name, {
            onProgress: (progress) =>
                send(event, "instance:progress", { name, ...progress }),
        });
    });

    ipcMain.handle("instance:delete", (_e, name) =>
        instanceManager.deleteInstance(name)
    );

    // The game's output, exit and Java download progress, to every window, however it
    // was launched.
    const broadcast = (channel, payload) => {
        for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.webContents.send(channel, payload);
        }
    };
    instanceManager.instanceEvents.on("log", (payload) => broadcast("instance:log", payload));
    // A game stopped and started again before it had closed: pages only hear of the newest.
    instanceManager.instanceEvents.on("exit", ({ superseded, ...payload }) => {
        if (!superseded) broadcast("instance:exit", payload);
    });
    instanceManager.instanceEvents.on("started", ({ name, account: player }) => broadcast("instance:started", { name, account: player }));
    instanceManager.instanceEvents.on("progress", (payload) => broadcast("instance:progress", payload));

    // options.quickPlay: { world } or { server } to open straight away.
    ipcMain.handle("instance:launch", (_event, name, accountId, options) =>
        launchAs(name, accountId, { quickPlay: options && typeof options === "object" ? options.quickPlay : null }));

    // Which account each open game plays as: { [instance]: { id, name } | null }.
    ipcMain.handle("instance:playing", () => instanceManager.playing());

    // A Java for this instance alone, chosen in a file dialog. Null if cancelled.
    ipcMain.handle("instance:pickJava", async (event, name) => {
        const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
            title: `Choose a Java for ${name}`,
            properties: ["openFile"],
        });
        if (picked.canceled || !picked.filePaths.length) return null;
        const javaPath = launcherSettings.checkJavaPath(picked.filePaths[0]);
        instanceManager.updateInstance(name, { javaPath });
        return javaPath;
    });

    // Which Java automatic would use for this instance, and whether it's downloaded yet.
    ipcMain.handle("instance:javaInfo", (_e, name) => {
        const instance = instanceManager.getInstance(name);
        const need = javaRuntime.requiredJava(instanceManager.instanceFolder(name), instance);
        const downloaded = javaRuntime.installedRuntimes().some((runtime) => runtime.component === need.component);
        return { ...need, downloaded };
    });

    /* ---------------- export ---------------- */

    // Asks where to save it, then writes the .mrpack. Null if cancelled.
    ipcMain.handle("instance:exportModpack", async (event, name, options = {}) => {
        const instance = instanceManager.getInstance(name);
        const picked = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
            title: `Export ${name} as a modpack`,
            defaultPath: path.join(app.getPath("downloads"), `${name.replace(/[/\\:*?"<>|]/g, "-")}.mrpack`),
            filters: [{ name: "Modrinth modpack", extensions: ["mrpack"] }],
        });
        if (picked.canceled || !picked.filePath) return null;

        return modpackExport.exportModpack(instance, instanceManager.instanceFolder(name), picked.filePath, {
            name: instance.name,
            worlds: Boolean(options.worlds),
            options: Boolean(options.options),
        });
    });

    /* ---------------- updates ---------------- */

    ipcMain.handle("instance:contentDetails", (_e, name) => contentDetails(instanceManager.instanceFolder(name)));

    ipcMain.handle("instance:checkUpdates", (_e, name) =>
        modUpdates.checkUpdates(name, instanceManager.getInstance(name), instanceManager.instanceFolder(name))
    );

    // Installs updates from the latest check, by key; the page never sends download addresses.
    // New versions of mods can need mods the old ones didn't: fetch those too.
    const fetchNewDependencies = async (name, done) => {
        const mods = (done.updated ?? []).filter((entry) => entry.type === "mod").map((entry) => entry.fileName);
        const check = mods.length
            ? await modDependencies.ensureDependencies(instanceManager.getInstance(name), instanceManager.instanceFolder(name), { only: mods })
            : { added: [], notFound: [], disabled: [] };
        return { ...done, dependencies: check.added, missingDependencies: check.notFound, disabledDependencies: check.disabled };
    };

    // Worlds backed up first, when the instance asks for that (its Worlds tab).
    const backupFirst = (event, name) =>
        worldBackups.backupBeforeUpdate(instanceManager.getInstance(name), {
            running: instanceManager.isRunning(name),
            onProgress: (progress) => send(event, "instance:progress", { name, ...progress }),
        });

    ipcMain.handle("instance:applyUpdates", async (event, name, keys, options) => {
        await backupFirst(event, name);
        const done = await modUpdates.applyUpdates(
            name,
            instanceManager.getInstance(name),
            instanceManager.instanceFolder(name),
            Array.isArray(keys) ? keys.map(String) : [],
            { releasesOnly: options?.releasesOnly === true, onProgress: (progress) => send(event, "instance:progress", { name, ...progress }) }
        );
        return fetchNewDependencies(name, done);
    });

    ipcMain.handle("instance:versions", (_e, name, key) => modUpdates.listVersions(name, instanceManager.getInstance(name), String(key)));

    ipcMain.handle("instance:versionChangelog", (_e, name, key, versionId) => modUpdates.versionChangelog(name, String(key), String(versionId)));

    ipcMain.handle("instance:installVersion", async (event, name, key, versionId, force) => {
        await backupFirst(event, name);
        const done = await modUpdates.installVersion(name, instanceManager.getInstance(name), instanceManager.instanceFolder(name), String(key), String(versionId), {
            force: force === true,
            onProgress: (progress) => send(event, "instance:progress", { name, ...progress }),
        });
        return done.needsConfirm ? done : fetchNewDependencies(name, done);
    });

    ipcMain.handle("instance:lastUpdate", (_e, name) => modUpdates.lastUpdate(instanceManager.instanceFolder(name)));

    // Puts back the latest change's files, and the loader it had if the change updated it.
    // Optimise: what's slowing an instance down, the fixes for it, and putting them back.
    const optimiseOptions = (event, name) => ({
        globalJvmArgs: launcherSettings.readSettings().jvmArgs,
        globalJavaTuning: launcherSettings.readSettings().javaTuning,
        updateInstance: (patch) => instanceManager.updateInstance(name, patch),
        onProgress: (progress) => send(event, "instance:progress", { name, ...progress }),
    });
    const notWhileRunning = (name) => {
        if (instanceManager.isRunning(name)) {
            throw new Error("Close Minecraft first: it saves its own settings when it quits, over any changed while it's open.");
        }
    };

    ipcMain.handle("instance:optimiseCheck", (_e, name) =>
        optimise.check(instanceManager.getInstance(name), instanceManager.instanceFolder(name), {
            running: instanceManager.isRunning(name),
            globalJvmArgs: launcherSettings.readSettings().jvmArgs,
            globalJavaTuning: launcherSettings.readSettings().javaTuning,
        })
    );

    ipcMain.handle("instance:optimiseApply", async (event, name, ids) => {
        notWhileRunning(name);
        const chosen = (Array.isArray(ids) ? ids : []).map(String).filter((id) => ["mods", "fps", "shaders", "java", "graphics"].includes(id) || /^fps:\w+$/.test(id));
        return optimise.apply(instanceManager.getInstance(name), instanceManager.instanceFolder(name), chosen, optimiseOptions(event, name));
    });

    ipcMain.handle("instance:optimiseUndo", (event, name) => {
        notWhileRunning(name);
        return optimise.undo(instanceManager.instanceFolder(name), optimiseOptions(event, name));
    });

    ipcMain.handle("instance:undoUpdate", async (event, name) => {
        const done = modUpdates.undoLastUpdate(instanceManager.instanceFolder(name));
        if (done.loader) {
            await instanceManager.restoreLoader(name, done.loader, {
                onProgress: (progress) => send(event, "instance:progress", { name, ...progress, stage: "updates" }),
            });
        }
        return { restored: done.restored };
    });

    // The builds of the instance's loader, each with how many mods wouldn't accept it.
    ipcMain.handle("instance:loaderVersions", (_e, name) =>
        loaderUpdates.loaderVersions(name, instanceManager.getInstance(name), instanceManager.instanceFolder(name))
    );

    // What changing the loader would take: mods to update with it, and what can't work.
    ipcMain.handle("instance:planLoader", (event, name, version) =>
        loaderUpdates.planLoaderChange(name, instanceManager.getInstance(name), instanceManager.instanceFolder(name), String(version), {
            onProgress: (progress) => send(event, "instance:progress", { name, ...progress }),
        })
    );

    ipcMain.handle("instance:applyLoader", async (event, name, version, options) => {
        await backupFirst(event, name);
        const onProgress = (progress) => send(event, "instance:progress", { name, ...progress });
        const done = await loaderUpdates.applyLoaderChange(name, instanceManager.getInstance(name), instanceManager.instanceFolder(name), String(version), {
            force: options?.force === true,
            alsoUpdate: options?.alsoUpdate === true,
            onProgress,
            changeLoader: (target, onLoaderProgress) => instanceManager.changeLoaderVersion(name, target, { onProgress: onLoaderProgress }),
        });
        return done.needsConfirm ? done : fetchNewDependencies(name, done);
    });

    ipcMain.handle("instance:log", (_e, name) => instanceManager.getLog(name));

    ipcMain.handle("instance:crashHelp", (_e, name) => instanceManager.crashHelp(name));

    // A crash report or Java crash file in its default app, or the logs folder.
    ipcMain.handle("instance:openLogFile", async (_e, name, file) => {
        const instance = instanceManager.getInstance(name);
        const gameDir = instanceFiles.gameDirectory(instance);
        const target = file
            ? path.resolve(gameDir, /^hs_err_pid\d+\.log$/.test(file) ? "" : "crash-reports", path.basename(String(file)))
            : path.join(gameDir, "logs");
        if (!target.startsWith(path.resolve(gameDir) + path.sep)) throw new Error("That isn't part of this instance.");
        // A crash report or log opens in its default app; anything else could be a program.
        if (file && !/\.(txt|log)$/i.test(target)) throw new Error("Only crash reports and logs can be opened from here.");
        if (!file) fs.mkdirSync(target, { recursive: true });
        const failed = await shell.openPath(target);
        if (failed) throw new Error(failed);
    });

    ipcMain.handle("instance:stop", (_e, name) =>
        instanceManager.stopInstance(name)
    );

    ipcMain.handle("instance:openFolder", (_e, name) => {
        const folder = instanceManager.instanceFolder(name);
        shell.openPath(folder);
        return folder;
    });

    /* ---------------- worlds, screenshots, copies ---------------- */

    ipcMain.handle("instance:worlds", (_e, name) =>
        instanceFiles.listWorlds(instanceManager.getInstance(name))
    );

    ipcMain.handle("instance:screenshots", (_e, name) =>
        instanceFiles.listScreenshots(instanceManager.getInstance(name))
    );

    ipcMain.handle("instance:fileAction", (_e, name, request) =>
        instanceFiles.fileAction(instanceManager.getInstance(name), request)
    );

    ipcMain.handle("instance:duplicate", (_e, name, newName) =>
        instanceManager.duplicateInstance(name, newName)
    );

    /* ---------------- adding worlds ---------------- */

    // How far an import has got, at most ten times a second (unpacking reports every chunk).
    const worldProgress = (event, name) => {
        let last = 0;
        return (value, detail) => {
            const now = Date.now();
            if (now - last < 100 && value !== 1) return;
            last = now;
            send(event, "worlds:progress", { name, value, detail });
        };
    };

    ipcMain.handle("worlds:importFile", async (event, name) => {
        const instance = instanceManager.getInstance(name);
        const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
            title: "Choose a world .zip",
            properties: ["openFile"],
            filters: [{ name: "Minecraft world", extensions: ["zip"] }],
        });
        if (picked.canceled || !picked.filePaths[0]) return null;
        return worlds.importZip(instance, picked.filePaths[0], { onProgress: worldProgress(event, name) });
    });

    ipcMain.handle("worlds:importFolder", async (event, name) => {
        const instance = instanceManager.getInstance(name);
        const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
            title: "Choose a world folder, or a saves folder",
            properties: ["openDirectory"],
        });
        if (picked.canceled || !picked.filePaths[0]) return null;
        return worlds.importFolder(instance, picked.filePaths[0], { onProgress: worldProgress(event, name) });
    });

    ipcMain.handle("worlds:importLink", (event, name, url) =>
        worlds.importLink(instanceManager.getInstance(name), String(url ?? ""), { onProgress: worldProgress(event, name) })
    );

    ipcMain.handle("worlds:search", (_e, name, options = {}) => {
        const instance = instanceManager.getInstance(name);
        return worlds.search({
            query: String(options.query ?? ""),
            mcVersion: options.anyVersion ? null : instance.version,
            category: options.category ?? null,
            sort: options.sort,
            page: Number(options.page) || 0,
        });
    });

    ipcMain.handle("worlds:install", (event, name, projectId) =>
        worlds.installCurseForge(instanceManager.getInstance(name), projectId, { onProgress: worldProgress(event, name) })
    );


    /* ---------------- instance mods ---------------- */

    ipcMain.handle("instance:content", (_e, name) => {
        const folder = instanceManager.instanceFolder(name);
        return instanceMods.listContent(folder);
    });

    ipcMain.handle("instance:contentToggle", (_e, { name, item, enabled }) => {
        const folder = instanceManager.instanceFolder(name);
        return instanceMods.setEnabled(folder, item, enabled);
    });

    ipcMain.handle("instance:contentDelete", (_e, { name, item }) => {
        const folder = instanceManager.instanceFolder(name);
        return instanceMods.deleteItem(folder, item);
    });

    ipcMain.handle("instance:copyDatapack", (_e, { name, fileName, world }) => {
        const folder = instanceManager.instanceFolder(name);
        return instanceMods.copyDatapackToWorld(folder, fileName, world);
    });

    /* ---------------- API keys: never returned to the page ---------------- */

    ipcMain.handle("settings:apiKeys", () => withCurseForge(secretStatus()));

    ipcMain.handle("settings:setApiKey", async (_e, { name, value }) => {
        // Only a player's own tokens. The launcher's CurseForge key isn't the app's to change.
        if (!isPersonal(name)) throw new Error("That key can't be changed from the app.");

        const key = String(value ?? "").trim();

        if (!key) {
            clearSecret(name);
            keyChanged(name);
            return withCurseForge(secretStatus());
        }

        // Saying so now beats every search or install failing later.
        await checkKey(name, key);

        setSecret(name, key);
        keyChanged(name);
        return withCurseForge(secretStatus());
    });

    /*
     * Search is scoped to the instance, so results are guaranteed to run
     * on its Minecraft version and loader.
     */
    ipcMain.handle("instance:modSearch", async (_e, { name, query, type, source, page }) => {
        const instance = instanceManager.getInstance(name);

        return modSearch.browse({
            query,
            mcVersion: instance.version,
            loader: instance.loader,
            type: type || "mod",
            source,
            page,
            // Nothing typed means browsing, where the most used make the best start.
            sort: query?.trim() ? "relevance" : "downloads",
        });
    });

    ipcMain.handle("github:releases", (_e, { input, type }) => github.listReleases(input, type));

    ipcMain.handle("github:install", async (_e, request) => {
        const instance = instanceManager.getInstance(request.name);
        const folder = instanceManager.instanceFolder(request.name);
        const result = await github.installAsset(instance, folder, instanceMods.installContent, request);
        if (!result.installed || result.installed.type !== "mod") return result;

        // A GitHub release has no page listing what it needs, so the jar is the only guide.
        const check = await modDependencies.ensureDependencies(instance, folder, { only: [result.installed.fileName] });
        return { installed: { ...result.installed, dependencies: check.added, missingDependencies: check.notFound, disabledDependencies: check.disabled } };
    });

    ipcMain.handle("instance:modInstall", async (event, payload) => {
        const { name, source, projectId, modName, iconUrl, world } = payload;

        const instance = instanceManager.getInstance(name);
        const folder = instanceManager.instanceFolder(name);

        // The source says what a project is if the caller doesn't already know.
        const type = payload.type ?? (await modSearch.getProject(source, projectId)).type;

        if (type === "modpack") {
            throw new Error("A modpack creates its own instance, so it can't be added to this one.");
        }

        if (type !== "mod" && type !== "resourcepack" && type !== "shader" && type !== "datapack") {
            throw new Error("This kind of project can't be added to an instance.");
        }

        const file = await modSearch.resolveModFile(
            source, projectId, instance.version, instance.loader, type
        );

        const result = await instanceMods.installContent(
            folder,
            {
                ...file,
                type: file.targetType,
                world,
                name: modName,
                source,
                projectId,
                iconUrl,
            }
        );

        /*
         * Install required dependencies, recursively. A mod often needs
         * an API which itself needs a core library, so one level is not
         * enough — this walks the whole required graph for both
         * Modrinth and CurseForge.
         */
        const installedDeps = [];
        const depFiles = [];

        try {
            const deps = await modSearch.collectDependencies(
                source, projectId, instance.version, instance.loader, type
            );

            for (const dep of deps) {
                try {
                    const added = await instanceMods.installContent(folder, {
                        ...dep.file,
                        type: dep.file.targetType,
                        world,
                        name: dep.info.name,
                        source: dep.source,
                        projectId: dep.projectId,
                        iconUrl: dep.info.icon,
                    });

                    installedDeps.push(dep.info.name);
                    depFiles.push(added.fileName);

                } catch (err) {
                    console.warn(
                        `Could not install dependency ${dep.info.name}:`,
                        err.message
                    );
                }
            }
        } catch (err) {
            console.warn("Dependency resolution failed:", err.message);
        }

        // Then what the jars themselves say they need, which a site's page can miss.
        const check = result.type === "mod"
            ? await modDependencies.ensureDependencies(instance, folder, { only: [result.fileName, ...depFiles] })
            : { added: [], notFound: [], disabled: [] };
        for (const name of check.added) if (!installedDeps.includes(name)) installedDeps.push(name);

        return { ...result, dependencies: installedDeps, missingDependencies: check.notFound, disabledDependencies: check.disabled };
    });

    // Java arguments the launcher won't use are refused here, saying which.
    ipcMain.handle("instance:update", (_e, { name, patch }) => {
        if (patch && typeof patch === "object" && "jvmArgs" in patch) launcherSettings.checkJvmArgs(patch.jvmArgs);
        return instanceManager.updateInstance(name, patch);
    });

    /* ---------------- modpacks ---------------- */

    /*
     * Installs a modpack as a brand new instance: the pack manifest
     * supplies the Minecraft version and loader, so no manual setup.
     */
    ipcMain.handle("instance:installModpack", async (event, payload) => {
        const { source, projectId, fileId, name: requestedName } = payload;

        const report = (progress) =>
            send(event, "instance:progress", {
                name: requestedName ?? "modpack",
                ...progress,
            });

        report({ stage: "pack", percent: 0, detail: "Downloading modpack" });

        let packResult = null;

        const { zipPath, tempDir } = await modpack.downloadPackFile(
            source, projectId, fileId
        );

        try {
            const info = await modpack.inspectModpack(zipPath);

            if (!info.mcVersion) {
                throw new Error("That modpack does not declare a Minecraft version.");
            }

            const instanceName = instanceManager.uniqueName(
                requestedName || info.name
            );

            report({
                stage: "pack",
                percent: 5,
                detail: `${info.name} — Minecraft ${info.mcVersion}, ${info.loader}`,
            });

            const created = await instanceManager.createInstanceFrom(
                {
                    name: instanceName,
                    version: info.mcVersion,
                    loader: info.loader,
                    loaderVersion: info.loaderVersion,
                    // Honour the pack's own RAM recommendation.
                    ram: info.recommendedRam ?? undefined,
                },
                async ({ gameDir }) => {
                    const result = await modpack.applyModpack(
                        zipPath, info, gameDir,
                        (progress) => send(event, "instance:progress", {
                            name: instanceName, ...progress,
                        })
                    );

                    if (result.failed) {
                        console.warn(
                            `${result.failed} pack file(s) failed:`,
                            result.firstError
                        );
                    }

                    packResult = result;
                },
                {
                    onProgress: (progress) =>
                        send(event, "instance:progress", {
                            name: instanceName, ...progress,
                        }),
                }
            );

            return {
                ...created,
                pack: {
                    name: info.name,
                    version: info.packVersion,
                    fileCount: info.fileCount,
                    blocked: packResult?.blocked ?? [],
                    failed: packResult?.failed ?? 0,
                },
            };

        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    /* ---------------- importing ---------------- */

    // Each folder found or chosen here is one the page may then ask to import (see security.cjs).
    ipcMain.handle("import:scan", () => {
        const found = importer.scanLaunchers();
        grantPaths("import-folder", (Array.isArray(found) ? found : []).map((entry) => entry?.gameDir));
        return found;
    });

    ipcMain.handle("import:pickFolder", async (event) => {
        const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
            title: "Choose a Minecraft instance folder",
            properties: ["openDirectory"],
        });

        if (picked.canceled) return null;

        const entry = importer.inspectFolder(picked.filePaths[0]);
        grantPaths("import-folder", entry?.gameDir);
        return entry;
    });

    ipcMain.handle("import:pickZip", async (event) => {
        const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
            title: "Choose a modpack or exported instance",
            properties: ["openFile"],
            filters: [
                { name: "Modpack or instance", extensions: ["zip", "mrpack"] },
            ],
        });

        if (picked.canceled) return null;

        const file = picked.filePaths[0];
        grantPaths("import-zip", file);

        // Could be a modpack or one of our own exports.
        try {
            const info = await modpack.inspectModpack(file);
            return { kind: "modpack", file, info: stripHeavy(info) };
        } catch {
            // fall through
        }

        try {
            const { config } = await cloud.readCloudInstance(file);
            return { kind: "export", file, info: config };
        } catch {
            throw new Error(
                "That zip is neither a modpack nor a Unity instance export."
            );
        }
    });

    /*
     * Creates an instance from a scanned launcher entry or a folder the
     * user pointed at, copying its mods, configs and saves across.
     */
    ipcMain.handle("import:instance", async (event, payload) => {
        const { entry, name: requestedName, version: overrideVersion } = payload ?? {};
        // Only a folder the scan or the folder dialog offered.
        assertGranted("import-folder", entry?.gameDir);

        let mcVersion = overrideVersion || entry.mcVersion;

        if (!mcVersion && entry.floatingVersion) {
            mcVersion = await importer.resolveFloatingVersion(entry.floatingVersion);
        }

        if (!mcVersion) {
            throw new Error(
                "Could not determine the Minecraft version — pick one manually."
            );
        }

        const instanceName = instanceManager.uniqueName(
            requestedName || entry.name
        );

        return instanceManager.createInstanceFrom(
            {
                name: instanceName,
                version: mcVersion,
                loader: entry.loader || "vanilla",
                loaderVersion: entry.loaderVersion || "",
            },
            async ({ gameDir }) => {
                send(event, "instance:progress", {
                    name: instanceName,
                    stage: "import",
                    percent: 95,
                    detail: "Copying mods, configs and saves",
                });

                importer.copyGameContent(entry.gameDir, gameDir, (detail) =>
                    send(event, "instance:progress", {
                        name: instanceName,
                        stage: "import",
                        percent: 97,
                        detail,
                    })
                );
            },
            {
                onProgress: (progress) =>
                    send(event, "instance:progress", {
                        name: instanceName, ...progress,
                    }),
            }
        );
    });

    ipcMain.handle("import:modpackFile", async (event, request) => {
        const { name } = request ?? {};
        // Only a file the import dialog offered.
        const file = assertGranted("import-zip", request?.file);
        const info = await modpack.inspectModpack(file);

        if (!info.mcVersion) {
            throw new Error("That modpack does not declare a Minecraft version.");
        }

        const instanceName = instanceManager.uniqueName(name || info.name);

        let packResult = null;

        const created = await instanceManager.createInstanceFrom(
            {
                name: instanceName,
                version: info.mcVersion,
                loader: info.loader,
                loaderVersion: info.loaderVersion,
                ram: info.recommendedRam ?? undefined,
            },
            async ({ gameDir }) => {
                packResult = await modpack.applyModpack(
                    file, info, gameDir,
                    (progress) => send(event, "instance:progress", {
                        name: instanceName, ...progress,
                    })
                );
            },
            {
                onProgress: (progress) =>
                    send(event, "instance:progress", {
                        name: instanceName, ...progress,
                    }),
            }
        );

        return {
            ...created,
            pack: {
                name: info.name,
                blocked: packResult?.blocked ?? [],
                failed: packResult?.failed ?? 0,
            },
        };
    });

    /* ---------------- cloud ---------------- */

    const cloudFolderInUse = () =>
        launcherSettings.readSettings().cloudFolder || cloud.defaultCloudFolder();

    // Each folder found is one the page may then choose (see security.cjs and settings.cjs checkFolder).
    ipcMain.handle("cloud:detect", () => {
        const found = cloud.detectCloudFolders();
        grantPaths("cloud-folder", (Array.isArray(found) ? found : []).map((entry) => entry?.path));
        return found;
    });

    ipcMain.handle("cloud:pickFolder", async (event) => {
        const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
            title: "Choose a cloud-synced folder",
            properties: ["openDirectory", "createDirectory"],
        });

        if (picked.canceled) return null;

        const folder = picked.filePaths[0];

        launcherSettings.writeSettings({ cloudFolder: folder });

        return folder;
    });

    ipcMain.handle("cloud:setFolder", (_e, folder) => {
        launcherSettings.writeSettings({ cloudFolder: launcherSettings.checkFolder(folder) });
        return launcherSettings.readSettings().cloudFolder;
    });

    // Each backup listed is one the page may then ask to restore (see security.cjs).
    ipcMain.handle("cloud:list", () => {
        const folder = cloudFolderInUse();
        const instances = cloud.listCloudInstances(folder);
        grantPaths("cloud-backup", (Array.isArray(instances) ? instances : []).flatMap((entry) => [entry?.file, entry?.previous?.file]));

        return {
            folder,
            instances,
        };
    });

    ipcMain.handle("cloud:export", (event, name) => {
        const folder = cloudFolderInUse();

        if (!folder) {
            throw new Error(
                "OneDrive isn't set up on this computer. Install it and sign in, then back up again. " +
                "You can also choose a different folder in Settings."
            );
        }

        // A world being saved right now could be caught half written.
        if (instanceManager.isRunning(name)) {
            throw new Error("Close Minecraft first, so the backup can't catch your world halfway through saving.");
        }

        return cloud.exportInstance(
            instanceManager.instanceFolder(name),
            name,
            folder,
            (percent, detail) => send(event, "instance:progress", {
                name, stage: "cloud", percent, detail,
            })
        );
    });

    /*
     * Restores a backup as a new instance, so whatever is already on this device stays
     * as it is. Mods and saves go back first, so they're safe here even if downloading
     * Minecraft then fails: Repair can finish that part later.
     */
    ipcMain.handle("cloud:import", async (event, picked) => {
        // Only a backup the cloud list or the import dialog offered.
        const file = assertGranted(["cloud-backup", "import-zip"], picked);
        const { config } = await cloud.readCloudInstance(file);

        if (!config?.version) {
            throw new Error("That export has no Minecraft version recorded.");
        }

        const instanceName = instanceManager.uniqueName(config.name);
        const folder = instanceManager.instanceFolder(instanceName);

        const report = (percent, detail) => send(event, "instance:progress", {
            name: instanceName, stage: "cloud", percent, detail,
        });

        let restored = false;

        try {
            fs.mkdirSync(folder, { recursive: true });

            await cloud.extractCloudInstance(file, path.join(folder, ".minecraft"), folder, percent =>
                report(percent, "Restoring mods and saves")
            );

            restored = true;

            const created = await instanceManager.createInstance(
                {
                    name: instanceName,
                    version: config.version,
                    loader: config.loader || "vanilla",
                    loaderVersion: config.loaderVersion || "",
                    ram: config.ram,
                },
                {
                    onProgress: (progress) =>
                        send(event, "instance:progress", {
                            name: instanceName, ...progress,
                        }),
                }
            );

            return config.jvmArgs
                ? instanceManager.updateInstance(created.name, { jvmArgs: config.jvmArgs })
                : created;

        } catch (err) {
            if (restored) {
                throw new Error(
                    `${err.message}\nYour mods and saves are back, in "${instanceName}". ` +
                    "Open it and use Repair to finish downloading Minecraft."
                );
            }

            fs.rmSync(folder, { recursive: true, force: true });
            throw new Error(`${err.message}\nYour backup is safe. Nothing was changed, so you can try again.`);
        }
    });

    /* ---------------- launcher settings ---------------- */

    ipcMain.handle("settings:get", () => ({
        ...launcherSettings.readSettings(),
        system: launcherSettings.systemInfo(),
    }));

    ipcMain.handle("settings:set", (_e, patch) => ({
        ...launcherSettings.writeSettings(launcherSettings.settingsFromPage(patch)),
        system: launcherSettings.systemInfo(),
    }));

    ipcMain.handle("settings:javaRuntimes", () => javaRuntime.installedRuntimes());

    ipcMain.handle("settings:pickJava", async (event) => {
        const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
            title: "Choose a Java executable",
            properties: ["openFile"],
        });

        if (picked.canceled || !picked.filePaths.length) return null;

        const javaPath = launcherSettings.checkJavaPath(picked.filePaths[0]);

        launcherSettings.writeSettings({ javaPath });

        return javaPath;
    });

    /* ---------------- account ---------------- */

    ipcMain.handle("account:get", () => account.publicAccount());

    /* ---------------- skin and cape ---------------- */

    const windowOf = (event) => BrowserWindow.fromWebContents(event.sender);

    ipcMain.handle("skins:profile", () => skins.getProfile());
    ipcMain.handle("skins:applyUrl", (_e, { url, slim }) => skins.applyFromUrl(url, slim));
    ipcMain.handle("skins:pickFile", (event) => skins.pickFile(windowOf(event)));
    ipcMain.handle("skins:upload", (_e, { id, slim }) => skins.uploadPicked(id, slim));
    ipcMain.handle("skins:reset", () => skins.resetSkin());
    ipcMain.handle("skins:setCape", (_e, capeId) => skins.setCape(capeId));
    ipcMain.handle("skins:download", (event, { url, name }) => skins.download(windowOf(event), url, name));
    ipcMain.handle("skins:saved", () => skins.listSaved());
    ipcMain.handle("skins:save", (_e, request) => skins.saveSkin(request));
    ipcMain.handle("skins:useSaved", (_e, { id, slim }) => skins.useSaved(id, slim));
    ipcMain.handle("skins:deleteSaved", (_e, id) => skins.deleteSaved(id));

    // Pages showing who is signed in hear when that changes.
    const accountsChanged = () => broadcast("account:changed", account.listAccounts());

    ipcMain.handle("account:clear", () => {
        account.clearAccount();
        accountsChanged();
        return null;
    });

    ipcMain.handle("account:list", () => account.listAccounts());

    ipcMain.handle("account:switch", (_e, uuid) => {
        account.switchAccount(String(uuid));
        accountsChanged();
        return account.listAccounts();
    });

    ipcMain.handle("account:remove", (_e, uuid) => {
        account.removeAccount(String(uuid));
        accountsChanged();
        return account.listAccounts();
    });
}

module.exports = { registerInstanceIpc, launchAs, saveAccount: account.saveAccount };
