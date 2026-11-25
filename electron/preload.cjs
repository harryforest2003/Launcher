const { contextBridge, ipcRenderer, webFrame } = require("electron");

/*
 * The launcher's bridge. main.cjs registers this for its session (not for one window), so
 * it hands its functions only to the launcher's own page, app://unity (or Vite's dev
 * server when run from source): any other page in the session gets nothing. The main
 * process checks every message's sender as well (security.cjs).
 */
const LAUNCHER_ORIGINS = ["app://unity", "http://localhost:5174"];
const trusted = window.top === window && LAUNCHER_ORIGINS.includes(`${location.protocol}//${location.host}`);

const expose = (name, api) => {
    if (trusted) contextBridge.exposeInMainWorld(name, api);
};


expose("launcherAPI", {
    // ---------- Authentication ----------
    loginMicrosoft: () =>
        ipcRenderer.invoke("auth:login"),

    // ---------- Instances ----------
    getInstances: () =>
        ipcRenderer.invoke("instances:get"),

    launchInstance: (instance, accountId) =>
        ipcRenderer.invoke("minecraft:launch", instance, accountId),

    getInstancesStorage: () =>
        ipcRenderer.invoke("instances:storage"),

    // ---------- Minecraft ----------
    getMinecraftVersions: () =>
        ipcRenderer.invoke("minecraft:getVersions"),

    getFabricVersions: (version) =>
        ipcRenderer.invoke("minecraft:getFabricVersions", version),

    getQuiltVersions: (version) =>
        ipcRenderer.invoke("minecraft:getQuiltVersions", version),

    getForgeVersions: (version) =>
        ipcRenderer.invoke("minecraft:getForgeVersions", version),

    getNeoForgeVersions: (version) =>
        ipcRenderer.invoke("minecraft:getNeoForgeVersions", version),

    getLoaders: () =>
        ipcRenderer.invoke("minecraft:getLoaders"),

    getLoaderVersions: (loader, version) =>
        ipcRenderer.invoke("minecraft:getLoaderVersions", loader, version),

    getLoaderGameVersions: (loader) =>
        ipcRenderer.invoke("minecraft:getLoaderGameVersions", loader),

    // ---------- Project API ----------
    getProject: (source, id) =>
        ipcRenderer.invoke("project:get", source, id),

    // What one modpack version contains.
    packContents: (source, projectId, versionId) =>
        ipcRenderer.invoke("pack:contents", source, projectId, versionId),

    // ---------- Search ----------
    browseCatalog: (options) =>
        ipcRenderer.invoke("catalog:browse", options),

    resolveProjectLink: (link) =>
        ipcRenderer.invoke("project:resolveLink", link),

    searchPlayers: (query) =>
        ipcRenderer.invoke("minecraft:searchPlayers", query),
});

// ---------------- MINECRAFT INSTANCES ----------------

expose("instanceAPI", {
    list: () => ipcRenderer.invoke("instance:list"),
    get: (name) => ipcRenderer.invoke("instance:get", name),

    create: (config) => ipcRenderer.invoke("instance:create", config),

    // The mods added to every new instance.
    starterModsList: () => ipcRenderer.invoke("starterMods:list"),
    starterModsSave: (list) => ipcRenderer.invoke("starterMods:save", list),
    starterModsAdd: (input) => ipcRenderer.invoke("starterMods:add", input),
    starterModsReset: () => ipcRenderer.invoke("starterMods:reset"),
    repair: (name) => ipcRenderer.invoke("instance:repair", name),
    remove: (name) => ipcRenderer.invoke("instance:delete", name),

    // accountId: a signed-in account's id, to play as it; left out, the active account.
    // options.quickPlay: { world } or { server } to open straight away.
    launch: (name, accountId, options) => ipcRenderer.invoke("instance:launch", name, accountId, options),
    stop: (name) => ipcRenderer.invoke("instance:stop", name),
    playing: () => ipcRenderer.invoke("instance:playing"),

    openFolder: (name) => ipcRenderer.invoke("instance:openFolder", name),
    worlds: (name) => ipcRenderer.invoke("instance:worlds", name),
    screenshots: (name) => ipcRenderer.invoke("instance:screenshots", name),
    fileAction: (name, request) => ipcRenderer.invoke("instance:fileAction", name, request),
    duplicate: (name, newName) => ipcRenderer.invoke("instance:duplicate", name, newName),

    // ----- servers: the instance's list, whether each is up, and finding more -----
    servers: (name) => ipcRenderer.invoke("servers:list", name),
    addServer: (name, server) => ipcRenderer.invoke("servers:add", name, server),
    removeServer: (name, server) => ipcRenderer.invoke("servers:remove", name, server),
    pingServer: (address) => ipcRenderer.invoke("servers:ping", address),
    searchServers: (options) => ipcRenderer.invoke("servers:search", options),
    worldBackups: (name) => ipcRenderer.invoke("backups:list", name),
    backupWorld: (name, folder) => ipcRenderer.invoke("backups:create", name, folder),
    restoreBackup: (name, folder, file) => ipcRenderer.invoke("backups:restore", name, folder, file),
    deleteBackup: (name, folder, file) => ipcRenderer.invoke("backups:delete", name, folder, file),
    openBackups: (name, folder) => ipcRenderer.invoke("backups:open", name, folder),
    shareLog: (name) => ipcRenderer.invoke("log:share", name),
    picture: (name) => ipcRenderer.invoke("instance:picture", name),
    setPicture: (name, dataUrl) => ipcRenderer.invoke("instance:setPicture", name, dataUrl),
    clearPicture: (name) => ipcRenderer.invoke("instance:clearPicture", name),
    downloadPicture: (url) => ipcRenderer.invoke("instance:downloadPicture", url),
    desktopShortcut: (name) => ipcRenderer.invoke("instance:desktopShortcut", name),
    // ----- modpack updates -----
    rememberModpack: (name, pack) => ipcRenderer.invoke("modpack:remember", name, pack),
    identifyModpackFile: (name, file) => ipcRenderer.invoke("modpack:identifyFile", name, file),
    updateModpack: (name, versionId) => ipcRenderer.invoke("modpack:update", name, versionId),
    lastModpackUpdate: (name) => ipcRenderer.invoke("modpack:lastUpdate", name),
    undoModpackUpdate: (name) => ipcRenderer.invoke("modpack:undo", name),
    exportCurseForge: (name, options) => ipcRenderer.invoke("instance:exportCurseForge", name, options),
    exportServerPack: (name) => ipcRenderer.invoke("instance:exportServerPack", name),
    shareCode: (name) => ipcRenderer.invoke("share:instanceCode", name),
    readShareCode: (code) => ipcRenderer.invoke("share:readInstanceCode", code),
    importShareCode: (code, name) => ipcRenderer.invoke("share:importInstance", code, name),
    safetyCheck: (name, only) => ipcRenderer.invoke("safety:check", name, only),
    sharedPublish: (name, options) => ipcRenderer.invoke("shared:publish", name, options),
    sharedChooseFile: () => ipcRenderer.invoke("shared:chooseFile"),
    sharedRead: (source) => ipcRenderer.invoke("shared:read", source),
    sharedJoin: (source, name) => ipcRenderer.invoke("shared:join", source, name),
    sharedCheck: (name) => ipcRenderer.invoke("shared:check", name),
    sharedUpdate: (name) => ipcRenderer.invoke("shared:update", name),
    sharedLeave: (name) => ipcRenderer.invoke("shared:leave", name),
    usage: (name) => ipcRenderer.invoke("instance:usage", name),
    // A desktop shortcut asked for this instance to be played.
    onShortcutLaunch: (cb) => {
        const h = (_e, name) => cb(name);
        ipcRenderer.on("shortcut:launch", h);
        return () => ipcRenderer.removeListener("shortcut:launch", h);
    },

    // ----- adding worlds: from this computer, a link, or CurseForge -----
    importWorldFile: (name) => ipcRenderer.invoke("worlds:importFile", name),
    importWorldFolder: (name) => ipcRenderer.invoke("worlds:importFolder", name),
    importWorldLink: (name, url) => ipcRenderer.invoke("worlds:importLink", name, url),
    searchWorlds: (name, options) => ipcRenderer.invoke("worlds:search", name, options),
    installWorld: (name, projectId) => ipcRenderer.invoke("worlds:install", name, projectId),
    onWorldProgress: (callback) => {
        const h = (_event, progress) => callback(progress);
        ipcRenderer.on("worlds:progress", h);
        return () => ipcRenderer.removeListener("worlds:progress", h);
    },


    // ----- mods, resource packs, shaders and data packs for one instance -----
    content: (name) => ipcRenderer.invoke("instance:content", name),

    contentToggle: (name, item, enabled) =>
        ipcRenderer.invoke("instance:contentToggle", { name, item, enabled }),

    contentDelete: (name, item) =>
        ipcRenderer.invoke("instance:contentDelete", { name, item }),

    copyDatapack: (name, fileName, world) =>
        ipcRenderer.invoke("instance:copyDatapack", { name, fileName, world }),

    githubReleases: (input, type) => ipcRenderer.invoke("github:releases", { input, type }),
    githubInstall: (request) => ipcRenderer.invoke("github:install", request),

    modSearch: (name, options) =>
        ipcRenderer.invoke("instance:modSearch", { name, ...options }),

    modInstall: (payload) =>
        ipcRenderer.invoke("instance:modInstall", payload),

    // ----- per-instance settings -----
    update: (name, patch) =>
        ipcRenderer.invoke("instance:update", { name, patch }),

    // ----- modpacks -----
    installModpack: (payload) =>
        ipcRenderer.invoke("instance:installModpack", payload),

    searchPlatformPacks: (platform, options) => ipcRenderer.invoke("platformPacks:search", platform, options),
    platformPackVersions: (platform, id) => ipcRenderer.invoke("platformPacks:versions", platform, id),
    installPlatformPack: (platform, id, versionId, name) => ipcRenderer.invoke("platformPacks:install", platform, id, versionId, name),

    // ----- importing -----
    scanLaunchers: () => ipcRenderer.invoke("import:scan"),
    pickFolder: () => ipcRenderer.invoke("import:pickFolder"),
    pickZip: () => ipcRenderer.invoke("import:pickZip"),

    importInstance: (payload) =>
        ipcRenderer.invoke("import:instance", payload),

    importModpackFile: (file, name) =>
        ipcRenderer.invoke("import:modpackFile", { file, name }),

    // ----- cloud -----
    cloudDetect: () => ipcRenderer.invoke("cloud:detect"),
    cloudPickFolder: () => ipcRenderer.invoke("cloud:pickFolder"),
    cloudSetFolder: (folder) => ipcRenderer.invoke("cloud:setFolder", folder),
    cloudList: () => ipcRenderer.invoke("cloud:list"),
    cloudExport: (name) => ipcRenderer.invoke("cloud:export", name),
    cloudImport: (file) => ipcRenderer.invoke("cloud:import", file),

    // ----- launcher settings -----
    getSettings: () => ipcRenderer.invoke("settings:get"),
    setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
    pickJava: () => ipcRenderer.invoke("settings:pickJava"),
    javaRuntimes: () => ipcRenderer.invoke("settings:javaRuntimes"),
    getApiKeys: () => ipcRenderer.invoke("settings:apiKeys"),
    setApiKey: (name, value) => ipcRenderer.invoke("settings:setApiKey", { name, value }),
    testDiscord: (clientId) => ipcRenderer.invoke("discord:test", clientId),
    discordState: () => ipcRenderer.invoke("discord:state"),

    // ----- account -----
    getAccount: () => ipcRenderer.invoke("account:get"),
    clearAccount: () => ipcRenderer.invoke("account:clear"),
    listAccounts: () => ipcRenderer.invoke("account:list"),
    switchAccount: (uuid) => ipcRenderer.invoke("account:switch", uuid),
    removeAccount: (uuid) => ipcRenderer.invoke("account:remove", uuid),
    // A test account without Microsoft; it becomes the active one.
    addOfflineAccount: (name) => ipcRenderer.invoke("account:addOffline", name),
    elySignIn: (login, password, code) => ipcRenderer.invoke("account:elySignIn", login, password, code),
    onAccountsChanged: (cb) => {
        const h = (_e, list) => cb(list);
        ipcRenderer.on("account:changed", h);
        return () => ipcRenderer.removeListener("account:changed", h);
    },

    // ----- events (each returns an unsubscribe function) -----
    onProgress: (cb) => {
        const h = (_e, d) => cb(d);
        ipcRenderer.on("instance:progress", h);
        return () => ipcRenderer.removeListener("instance:progress", h);
    },

    pickInstanceJava: (name) => ipcRenderer.invoke("instance:pickJava", name),
    javaInfo: (name) => ipcRenderer.invoke("instance:javaInfo", name),
    exportModpack: (name, options) => ipcRenderer.invoke("instance:exportModpack", name, options),
    contentDetails: (name) => ipcRenderer.invoke("instance:contentDetails", name),
    checkUpdates: (name) => ipcRenderer.invoke("instance:checkUpdates", name),
    applyUpdates: (name, keys, options) => ipcRenderer.invoke("instance:applyUpdates", name, keys, options),
    versions: (name, key) => ipcRenderer.invoke("instance:versions", name, key),
    versionChangelog: (name, key, versionId) => ipcRenderer.invoke("instance:versionChangelog", name, key, versionId),
    installVersion: (name, key, versionId, force) => ipcRenderer.invoke("instance:installVersion", name, key, versionId, force),
    lastUpdate: (name) => ipcRenderer.invoke("instance:lastUpdate", name),
    undoUpdate: (name) => ipcRenderer.invoke("instance:undoUpdate", name),
    optimiseCheck: (name) => ipcRenderer.invoke("instance:optimiseCheck", name),
    optimiseApply: (name, ids) => ipcRenderer.invoke("instance:optimiseApply", name, ids),
    optimiseUndo: (name) => ipcRenderer.invoke("instance:optimiseUndo", name),
    loaderVersions: (name) => ipcRenderer.invoke("instance:loaderVersions", name),
    planLoader: (name, version) => ipcRenderer.invoke("instance:planLoader", name, version),
    applyLoader: (name, version, options) => ipcRenderer.invoke("instance:applyLoader", name, version, options),
    log: (name) => ipcRenderer.invoke("instance:log", name),
    crashHelp: (name) => ipcRenderer.invoke("instance:crashHelp", name),
    openLogFile: (name, file) => ipcRenderer.invoke("instance:openLogFile", name, file),

    onLog: (cb) => {
        const h = (_e, d) => cb(d);
        ipcRenderer.on("instance:log", h);
        return () => ipcRenderer.removeListener("instance:log", h);
    },

    onExit: (cb) => {
        const h = (_e, d) => cb(d);
        ipcRenderer.on("instance:exit", h);
        return () => ipcRenderer.removeListener("instance:exit", h);
    },

    onStarted: (cb) => {
        const h = (_e, d) => cb(d);
        ipcRenderer.on("instance:started", h);
        return () => ipcRenderer.removeListener("instance:started", h);
    },
});

// ---------------- SKIN BUILDER ----------------

// Opens Blockbench, inside the launcher, to edit something and bring it back.
expose("blockbenchAPI", {
    available: () => ipcRenderer.invoke("blockbench:available"),
    prepare: () => ipcRenderer.invoke("blockbench:prepare"),
    editSkin: (skin, slim, name, savedId) => ipcRenderer.invoke("blockbench:editSkin", { skin, slim, name, savedId }),
    setBounds: (rect) => ipcRenderer.invoke("blockbench:setBounds", rect),
    save: () => ipcRenderer.invoke("blockbench:save"),
    close: (choice) => ipcRenderer.invoke("blockbench:close", choice),
    unsaved: () => ipcRenderer.invoke("blockbench:unsaved"),
    hide: (hidden) => ipcRenderer.invoke("blockbench:hide", Boolean(hidden)),
    onSaved: (callback) => {
        const listener = (_event, message) => callback(message);
        ipcRenderer.on("blockbench:saved", listener);
        return () => ipcRenderer.removeListener("blockbench:saved", listener);
    },
});

// Changes the signed-in player's real skin and cape.
expose("skinAPI", {
    profile: () => ipcRenderer.invoke("skins:profile"),
    applyUrl: (url, slim) => ipcRenderer.invoke("skins:applyUrl", { url, slim }),
    pickFile: () => ipcRenderer.invoke("skins:pickFile"),
    upload: (id, slim) => ipcRenderer.invoke("skins:upload", { id, slim }),
    reset: () => ipcRenderer.invoke("skins:reset"),
    setCape: (capeId) => ipcRenderer.invoke("skins:setCape", capeId),
    download: (url, name) => ipcRenderer.invoke("skins:download", { url, name }),
    saved: () => ipcRenderer.invoke("skins:saved"),
    save: (request) => ipcRenderer.invoke("skins:save", request),
    useSaved: (id, slim) => ipcRenderer.invoke("skins:useSaved", { id, slim }),
    deleteSaved: (id) => ipcRenderer.invoke("skins:deleteSaved", id),
});

expose("skinBuilderAPI", {
    getLibrary: () => ipcRenderer.invoke("skinBuilder:getLibrary"),
    saveSkin: (meta, files) => ipcRenderer.invoke("skinBuilder:saveSkin", { meta, files }),
    readSkinFile: (id, file) => ipcRenderer.invoke("skinBuilder:readSkinFile", { id, file }),
    updateSkin: (id, patch) => ipcRenderer.invoke("skinBuilder:updateSkin", { id, patch }),
    deleteSkin: (id) => ipcRenderer.invoke("skinBuilder:deleteSkin", id),

    createGroup: (name) => ipcRenderer.invoke("skinBuilder:createGroup", name),
    renameGroup: (id, name) => ipcRenderer.invoke("skinBuilder:renameGroup", { id, name }),
    deleteGroup: (id) => ipcRenderer.invoke("skinBuilder:deleteGroup", id),

    getOutputFolder: () => ipcRenderer.invoke("skinBuilder:getOutputFolder"),
    pickOutputFolder: () => ipcRenderer.invoke("skinBuilder:pickOutputFolder"),
    writePack: (fileName, bytes, overwrite) =>
        ipcRenderer.invoke("skinBuilder:writePack", { fileName, bytes, overwrite }),

    revealPath: (target) => ipcRenderer.invoke("skinBuilder:revealPath", target),
    editInBlockbench: (id) => ipcRenderer.invoke("skinBuilder:editInBlockbench", id),
});

// ---------------- MOD MANAGER (all games) ----------------

expose("modAPI", {
    // Games
    getGames: (opts) => ipcRenderer.invoke("mods:getGames", opts),
    refreshGames: () => ipcRenderer.invoke("mods:refreshGames"),
    catalog: () => ipcRenderer.invoke("mods:catalog"),

    // Installed mods
    list: (gameId) => ipcRenderer.invoke("mods:list", gameId),

    setEnabled: (gameId, relativePath, enabled) =>
        ipcRenderer.invoke("mods:setEnabled", { gameId, relativePath, enabled }),

    remove: (gameId, relativePath) =>
        ipcRenderer.invoke("mods:delete", { gameId, relativePath }),

    openFolder: (gameId) => ipcRenderer.invoke("mods:openFolder", gameId),

    // Online
    search: (gameId, query, provider) =>
        ipcRenderer.invoke("mods:search", { gameId, query, provider }),

    install: (payload) => ipcRenderer.invoke("mods:install", payload),

    installFromFile: (gameId, filePaths) =>
        ipcRenderer.invoke("mods:installFromFile", { gameId, filePaths }),

    openUrl: (url) => ipcRenderer.invoke("mods:openUrl", url),

    // Settings
    getSettings: () => ipcRenderer.invoke("mods:getSettings"),

    // Download progress. Returns an unsubscribe function.
    onProgress: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on("mods:progress", handler);

        return () => ipcRenderer.removeListener("mods:progress", handler);
    },
});

// ---------------- GAME SECTIONS (The Sims 4, GTA V, Skyrim, Fallout 4, Cyberpunk 2077, Stardew Valley) ----------------

const listen = (channel) => (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
};

expose("gamesAPI", {
    list: () => ipcRenderer.invoke("games:list"),
    playing: () => ipcRenderer.invoke("games:playing"),
    playStats: () => ipcRenderer.invoke("games:playStats"),
    onPlaying: (listener) => {
        const relay = (_event, list) => listener(list);
        ipcRenderer.on("games:playing", relay);
        return () => ipcRenderer.removeListener("games:playing", relay);
    },
    findGames: (query, page, source, filters) => ipcRenderer.invoke("games:findGames", query, page, source, filters),
    openGame: (entry) => ipcRenderer.invoke("games:openGame", entry),
    getOnSteam: (steamAppId) => ipcRenderer.invoke("games:getOnSteam", steamAppId),
    storeInfo: (id) => ipcRenderer.invoke("games:storeInfo", id),
    whereToGet: (names) => ipcRenderer.invoke("games:whereToGet", names),
    removeGame: (id) => ipcRenderer.invoke("games:removeGame", id),
    chooseModsDir: (id) => ipcRenderer.invoke("games:chooseModsDir", id),
    forgetModsDir: (id) => ipcRenderer.invoke("games:forgetModsDir", id),
    chooseLaunch: (id) => ipcRenderer.invoke("games:chooseLaunch", id),
    forgetLaunch: (id) => ipcRenderer.invoke("games:forgetLaunch", id),
    art: (ids) => ipcRenderer.invoke("games:art", ids),
    status: (id) => ipcRenderer.invoke("games:status", id),
    get: (id) => ipcRenderer.invoke("games:get", id),

    mods: (id) => ipcRenderer.invoke("games:mods", id),
    setEnabled: (id, key, enabled) => ipcRenderer.invoke("games:setEnabled", id, key, enabled),
    remove: (id, key) => ipcRenderer.invoke("games:remove", id, key),

    downloads: (id) => ipcRenderer.invoke("games:downloads", id),
    install: (id, filePath) => ipcRenderer.invoke("games:install", id, filePath),

    chooseFolder: (id) => ipcRenderer.invoke("games:chooseFolder", id),
    forgetFolder: (id) => ipcRenderer.invoke("games:forgetFolder", id),
    chooseDocs: (id) => ipcRenderer.invoke("games:chooseDocs", id),
    openFolder: (id, which) => ipcRenderer.invoke("games:openFolder", id, which),

    launch: (id, options) => ipcRenderer.invoke("games:launch", id, options),
    onLaunchProgress: (callback) => {
        const handler = (_event, progress) => callback(progress);
        ipcRenderer.on("games:launchProgress", handler);
        return () => ipcRenderer.removeListener("games:launchProgress", handler);
    },
    setSimsOptions: (options) => ipcRenderer.invoke("games:setSimsOptions", options),

    search: (id, options) => ipcRenderer.invoke("games:search", id, options),
    details: (id, provider, modId) => ipcRenderer.invoke("games:details", id, provider, modId),
    collections: (id, options) => ipcRenderer.invoke("games:collections", id, options),
    collection: (id, slug) => ipcRenderer.invoke("games:collection", id, slug),
    installCollection: (id, slug, fileIds) => ipcRenderer.invoke("games:installCollection", id, slug, fileIds),
    installRemote: (id, provider, modId, fileId, name) => ipcRenderer.invoke("games:installRemote", id, provider, modId, fileId, name),
    checkUpdates: (id) => ipcRenderer.invoke("games:checkUpdates", id),
    update: (id, key) => ipcRenderer.invoke("games:update", id, key),
    undoUpdate: (id, key) => ipcRenderer.invoke("games:undoUpdate", id, key),
    keepVersion: (id, key, kept) => ipcRenderer.invoke("games:keepVersion", id, key, kept),
    shareCode: (id) => ipcRenderer.invoke("games:shareCode", id),
    readShareCode: (id, code) => ipcRenderer.invoke("games:readShareCode", id, code),
    nexusAccount: () => ipcRenderer.invoke("games:nexusAccount"),
    account: (id) => ipcRenderer.invoke("games:account", id),
    openAccount: (provider) => ipcRenderer.invoke("games:openAccount", provider),
    adultStatus: (recheck) => ipcRenderer.invoke("games:adultStatus", recheck),

    saves: (id) => ipcRenderer.invoke("games:saves", id),
    backupSaves: (id) => ipcRenderer.invoke("games:backupSaves", id),
    restoreSaves: (id, backupId) => ipcRenderer.invoke("games:restoreSaves", id, backupId),
    deleteBackup: (id, backupId) => ipcRenderer.invoke("games:deleteBackup", id, backupId),
    chooseSaves: (id) => ipcRenderer.invoke("games:chooseSaves", id),
    forgetSaves: (id) => ipcRenderer.invoke("games:forgetSaves", id),
    openSaves: (id) => ipcRenderer.invoke("games:openSaves", id),

    loadOrder: (id) => ipcRenderer.invoke("games:loadOrder", id),
    setLoadOrder: (id, entries) => ipcRenderer.invoke("games:setLoadOrder", id, entries),
    fixLoadOrder: (id) => ipcRenderer.invoke("games:fixLoadOrder", id),
    lootPlan: (id) => ipcRenderer.invoke("games:lootPlan", id),
    lootSort: (id) => ipcRenderer.invoke("games:lootSort", id),
    modOrder: (id) => ipcRenderer.invoke("games:modOrder", id),
    setModOrder: (id, entries) => ipcRenderer.invoke("games:setModOrder", id, entries),
    fixModOrder: (id) => ipcRenderer.invoke("games:fixModOrder", id),

    requirements: (id) => ipcRenderer.invoke("games:requirements", id),
    requirementsBefore: (id, modId) => ipcRenderer.invoke("games:requirementsBefore", id, modId),
    getRequirement: (id, key) => ipcRenderer.invoke("games:getRequirement", id, key),

    sets: (id) => ipcRenderer.invoke("games:sets", id),
    saveSet: (id, set) => ipcRenderer.invoke("games:saveSet", id, set),
    deleteSet: (id, setId) => ipcRenderer.invoke("games:deleteSet", id, setId),
    setMember: (id, setId, key, member) => ipcRenderer.invoke("games:setMember", id, setId, key, member),
    useSet: (id, setId) => ipcRenderer.invoke("games:useSet", id, setId),
    profiles: (id) => ipcRenderer.invoke("games:profiles", id),
    saveProfile: (id, profile) => ipcRenderer.invoke("games:saveProfile", id, profile),
    deleteProfile: (id, profileId) => ipcRenderer.invoke("games:deleteProfile", id, profileId),
    switchProfile: (id, profileId) => ipcRenderer.invoke("games:switchProfile", id, profileId),
    profileMember: (id, profileId, key, member) => ipcRenderer.invoke("games:profileMember", id, profileId, key, member),
    profileSaves: (id, on) => ipcRenderer.invoke("games:profileSaves", id, on),
    iniList: (id) => ipcRenderer.invoke("games:iniList", id),
    iniRead: (id, name) => ipcRenderer.invoke("games:iniRead", id, name),
    iniSave: (id, name, text) => ipcRenderer.invoke("games:iniSave", id, name, text),
    iniRestore: (id, name, copyId) => ipcRenderer.invoke("games:iniRestore", id, name, copyId),
    iniPreset: (id, presetId, on) => ipcRenderer.invoke("games:iniPreset", id, presetId, on),
    openIniFolder: (id) => ipcRenderer.invoke("games:openIniFolder", id),
    tools: (id) => ipcRenderer.invoke("games:tools", id),
    addTool: (id) => ipcRenderer.invoke("games:addTool", id),
    saveTool: (id, toolId, change) => ipcRenderer.invoke("games:saveTool", id, toolId, change),
    removeTool: (id, toolId) => ipcRenderer.invoke("games:removeTool", id, toolId),
    showAllTools: (id) => ipcRenderer.invoke("games:showAllTools", id),
    runTool: (id, toolId) => ipcRenderer.invoke("games:runTool", id, toolId),
    graphics: (id) => ipcRenderer.invoke("games:graphics", id),
    reshadeInstall: (id, options) => ipcRenderer.invoke("games:reshadeInstall", id, options),
    reshadeOn: (id, on) => ipcRenderer.invoke("games:reshadeOn", id, on),
    reshadeRemove: (id) => ipcRenderer.invoke("games:reshadeRemove", id),
    enbInstall: (id, fromDownloads) => ipcRenderer.invoke("games:enbInstall", id, fromDownloads),
    enbOn: (id, on) => ipcRenderer.invoke("games:enbOn", id, on),
    enbRemove: (id) => ipcRenderer.invoke("games:enbRemove", id),
    enbSite: () => ipcRenderer.invoke("games:enbSite"),
    openGraphicsFolder: (id) => ipcRenderer.invoke("games:openGraphicsFolder", id),
    modlists: (id) => ipcRenderer.invoke("games:modlists", id),
    modlistGet: (id, key) => ipcRenderer.invoke("games:modlistGet", id, key),
    modlistOpenFile: (id) => ipcRenderer.invoke("games:modlistOpenFile", id),
    modlistPlan: (key) => ipcRenderer.invoke("games:modlistPlan", key),
    modlistDownload: (key) => ipcRenderer.invoke("games:modlistDownload", key),
    modlistOpenArchive: (key, hash) => ipcRenderer.invoke("games:modlistOpenArchive", key, hash),
    modlistChooseDir: (key) => ipcRenderer.invoke("games:modlistChooseDir", key),
    modlistInstall: (key) => ipcRenderer.invoke("games:modlistInstall", key),
    modlistCancel: (key) => ipcRenderer.invoke("games:modlistCancel", key),
    modlistForget: (key) => ipcRenderer.invoke("games:modlistForget", key),
    modlistRun: (key) => ipcRenderer.invoke("games:modlistRun", key),
    modlistOpenFolder: (key) => ipcRenderer.invoke("games:modlistOpenFolder", key),
    modlistLink: (id, key, which) => ipcRenderer.invoke("games:modlistLink", id, key, which),
    onModlist: listen("games:modlist"),

    finder: (id) => ipcRenderer.invoke("games:finder", id),
    finderStart: (id) => ipcRenderer.invoke("games:finderStart", id),
    finderAnswer: (id, happened) => ipcRenderer.invoke("games:finderAnswer", id, happened),
    finderStop: (id, keepOff) => ipcRenderer.invoke("games:finderStop", id, keepOff),
    setAdult: (on) => ipcRenderer.invoke("games:setAdult", on),
    openUrl: (url) => ipcRenderer.invoke("games:openUrl", url),

    clashes: (id) => ipcRenderer.invoke("games:clashes", id),
    hideClash: (id, clashId, hidden) => ipcRenderer.invoke("games:hideClash", id, clashId, hidden),
    clashLoadAfter: (id, name, after) => ipcRenderer.invoke("games:clashLoadAfter", id, name, after),
    ccList: () => ipcRenderer.invoke("games:ccList"),
    ccPictures: (rels) => ipcRenderer.invoke("games:ccPictures", rels),
    ccReveal: (rel) => ipcRenderer.invoke("games:ccReveal", rel),
    conflicts: (id) => ipcRenderer.invoke("games:conflicts", id),
    chooseConflict: (id, groupId, modId) => ipcRenderer.invoke("games:chooseConflict", id, groupId, modId),
    health: (id) => ipcRenderer.invoke("games:health", id),
    healthFix: (id, issueId) => ipcRenderer.invoke("games:healthFix", id, issueId),
    queue: () => ipcRenderer.invoke("games:queue"),
    queueAdd: (items) => ipcRenderer.invoke("games:queueAdd", items),
    queueControl: (action, id) => ipcRenderer.invoke("games:queueControl", action, id),
    onQueue: listen("games:queue"),
    onModsChanged: listen("games:modsChanged"),

    onProgress: listen("games:progress"),
    onNxm: listen("games:nxm"),
    /* A mod's FOMOD installer asks which options to install; answer with answerFomod. */
    onFomod: listen("games:fomod"),
    answerFomod: (id, choices) => ipcRenderer.invoke("games:fomodAnswer", id, choices),
});

/* Home's dashboard: play time, recent activity, news (Minecraft or general gaming) and Steam deals. */
// The launcher's own updates (updater.cjs).
expose("appAPI", {
    about: () => ipcRenderer.invoke("app:about"),
    storage: () => ipcRenderer.invoke("app:storage"),
    clearCache: () => ipcRenderer.invoke("app:clearCache"),
    openDataFolder: () => ipcRenderer.invoke("app:openDataFolder"),
    startup: () => ipcRenderer.invoke("app:startup"),
    setStartup: (change) => ipcRenderer.invoke("app:setStartup", change),
    testNotification: () => ipcRenderer.invoke("app:testNotification"),
    exportSettings: (prefs) => ipcRenderer.invoke("app:exportSettings", prefs),
    importSettings: () => ipcRenderer.invoke("app:importSettings"),
});

expose("updaterAPI", {
    state: () => ipcRenderer.invoke("updater:state"),
    check: () => ipcRenderer.invoke("updater:check"),
    restart: () => ipcRenderer.invoke("updater:restart"),
    onState: (listener) => {
        const relay = (_event, state) => listener(state);
        ipcRenderer.on("updater:state", relay);
        return () => ipcRenderer.removeListener("updater:state", relay);
    },
});

// Full screen and Big screen (displayMode.ts).
expose("displayAPI", {
    fullScreen: (on) => ipcRenderer.invoke("window:fullScreen", typeof on === "boolean" ? on : undefined),
    onFullScreen: (listener) => {
        const relay = (_event, on) => listener(Boolean(on));
        ipcRenderer.on("window:fullScreen", relay);
        return () => ipcRenderer.removeListener("window:fullScreen", relay);
    },
    // Chromium's own page zoom, so layouts sized to the window still fit it.
    setZoom: (factor) => {
        const zoom = Number(factor);
        if (Number.isFinite(zoom) && zoom >= 0.5 && zoom <= 2) webFrame.setZoomFactor(zoom);
    },
});

expose("dashboardAPI", {
    stats: () => ipcRenderer.invoke("dashboard:stats"),
    activity: (limit) => ipcRenderer.invoke("dashboard:activity", limit),
    news: (options) => ipcRenderer.invoke("dashboard:news", options),
    deals: (options) => ipcRenderer.invoke("dashboard:deals", options),
});
