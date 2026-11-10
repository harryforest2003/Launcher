const { contextBridge, ipcRenderer } = require("electron");

console.log("🔥 PRELOAD LOADED");

contextBridge.exposeInMainWorld("launcherAPI", {
    // ---------- Generic IPC ----------
    invoke: (channel, data) => ipcRenderer.invoke(channel, data),

    // ---------- Authentication ----------
    loginMicrosoft: () =>
        ipcRenderer.invoke("auth:login"),

    // ---------- Instances ----------
    getInstances: () =>
        ipcRenderer.invoke("instances:get"),

    createInstance: (instance) =>
        ipcRenderer.invoke("instances:create", instance),

    launchInstance: (instance) =>
        ipcRenderer.invoke("minecraft:launch", instance),

    getInstancesStorage: () =>
        ipcRenderer.invoke("instances:storage"),

    // ---------- Minecraft ----------
    getMinecraftDirectory: () =>
        ipcRenderer.invoke("minecraft:getDirectory"),

    getVersions: () =>
        ipcRenderer.invoke("minecraft:getVersions"),

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

    // ---------- Project API ----------
    getProject: (source, id) =>
        ipcRenderer.invoke("project:get", source, id),

    // ---------- Search ----------
    browseCatalog: (options) =>
        ipcRenderer.invoke("catalog:browse", options),

    resolveProjectLink: (link) =>
        ipcRenderer.invoke("project:resolveLink", link),

    searchPlayers: (query) =>
        ipcRenderer.invoke("minecraft:searchPlayers", query),
});

// ---------------- MINECRAFT INSTANCES ----------------

contextBridge.exposeInMainWorld("instanceAPI", {
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

    launch: (name) => ipcRenderer.invoke("instance:launch", name),
    stop: (name) => ipcRenderer.invoke("instance:stop", name),

    openFolder: (name) => ipcRenderer.invoke("instance:openFolder", name),

    latestLoader: (loader, mcVersion) =>
        ipcRenderer.invoke("instance:latestLoader", { loader, mcVersion }),

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
    getApiKeys: () => ipcRenderer.invoke("settings:apiKeys"),
    setApiKey: (name, value) => ipcRenderer.invoke("settings:setApiKey", { name, value }),

    // ----- account -----
    getAccount: () => ipcRenderer.invoke("account:get"),
    clearAccount: () => ipcRenderer.invoke("account:clear"),

    // ----- events (each returns an unsubscribe function) -----
    onProgress: (cb) => {
        const h = (_e, d) => cb(d);
        ipcRenderer.on("instance:progress", h);
        return () => ipcRenderer.removeListener("instance:progress", h);
    },

    onModProgress: (cb) => {
        const h = (_e, d) => cb(d);
        ipcRenderer.on("instance:modProgress", h);
        return () => ipcRenderer.removeListener("instance:modProgress", h);
    },

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
});

// ---------------- SKIN BUILDER ----------------

// Opens Blockbench, inside the launcher, to edit something and bring it back.
contextBridge.exposeInMainWorld("blockbenchAPI", {
    available: () => ipcRenderer.invoke("blockbench:available"),
    prepare: () => ipcRenderer.invoke("blockbench:prepare"),
    editSkin: (skin, slim, name) => ipcRenderer.invoke("blockbench:editSkin", { skin, slim, name }),
    setBounds: (rect) => ipcRenderer.invoke("blockbench:setBounds", rect),
    save: () => ipcRenderer.invoke("blockbench:save"),
    close: () => ipcRenderer.invoke("blockbench:close"),
    onSaved: (callback) => {
        const listener = (_event, message) => callback(message);
        ipcRenderer.on("blockbench:saved", listener);
        return () => ipcRenderer.removeListener("blockbench:saved", listener);
    },
});

// Changes the signed-in player's real skin and cape.
contextBridge.exposeInMainWorld("skinAPI", {
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

contextBridge.exposeInMainWorld("skinBuilderAPI", {
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

contextBridge.exposeInMainWorld("modAPI", {
    // Games
    getGames: (opts) => ipcRenderer.invoke("mods:getGames", opts),
    refreshGames: () => ipcRenderer.invoke("mods:refreshGames"),

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

    getFiles: (gameId, provider, projectId) =>
        ipcRenderer.invoke("mods:getFiles", { gameId, provider, projectId }),

    install: (payload) => ipcRenderer.invoke("mods:install", payload),

    installFromFile: (gameId, filePaths) =>
        ipcRenderer.invoke("mods:installFromFile", { gameId, filePaths }),

    openUrl: (url) => ipcRenderer.invoke("mods:openUrl", url),

    // Settings
    getSettings: () => ipcRenderer.invoke("mods:getSettings"),
    setNexusKey: (key) => ipcRenderer.invoke("mods:setNexusKey", key),

    // Download progress. Returns an unsubscribe function.
    onProgress: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on("mods:progress", handler);

        return () => ipcRenderer.removeListener("mods:progress", handler);
    },
});