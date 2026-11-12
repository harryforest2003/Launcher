const { BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { GAMES, getGame } = require("./registry.cjs");
const detect = require("./detect.cjs");
const store = require("./store.cjs");
const protect = require("./protect.cjs");
const downloads = require("./downloads.cjs");
const nexus = require("./nexus.cjs");
const { launch } = require("./launch.cjs");
const { installFromUrl } = require("./remote.cjs");
const updates = require("./updates.cjs");
const curseforge = require("../mods/providers/curseforge.cjs");
const { curseforgeFetch } = require("../curseforge.cjs");

/*
 * The game sections (The Sims 4, GTA V, Skyrim, Fallout 4, Cyberpunk 2077, Stardew Valley):
 * where each is, its mods, installing them from Downloads or Nexus Mods and CurseForge,
 * and playing it.
 */

const send = (channel, payload) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, payload);
};

const need = (id) => {
    const game = getGame(id);
    if (!game) throw new Error(`Unknown game "${id}".`);
    return game;
};

/* When the game last changed under its mods: now, if it's updated since it was last played. */
function updateTime(game, loc) {
    const pending = protect.updatedSince(game, loc);
    if (pending) return protect.fingerprint(game, loc)?.at ?? Date.now();
    return protect.lastPlayed(game.id)?.updatedAt ?? null;
}

function summary(game) {
    const loc = detect.locate(game.id);
    let mods = 0;
    try {
        mods = store.list(game.id).mods.filter((mod) => mod.enabled).length;
    } catch {
        // Not found yet.
    }
    return {
        id: game.id,
        name: game.name,
        tagline: game.tagline,
        colour: game.colour,
        found: loc.found,
        gameDir: loc.gameDir,
        docsDir: loc.docsDir,
        source: loc.source,
        chosen: loc.chosen,
        windowsOnly: Boolean(game.windowsOnly),
        nexus: game.nexus ?? null,
        curseforge: game.curseforge ?? null,
        modCount: mods,
        updated: protect.updatedSince(game, loc),
    };
}

/* A Nexus "Mod Manager Download" link (nxm://), from the website's button. */
async function handleNxm(link) {
    const parsed = nexus.parseNxm(link);
    if (!parsed) return;
    const game = GAMES.find((g) => g.nexus === parsed.domain);
    if (!game) {
        send("games:nxm", { status: "failed", error: `Unity Launcher doesn't have a section for that game (${parsed.domain}) yet.` });
        return;
    }
    let name = `Nexus mod ${parsed.modId}`;
    try {
        send("games:nxm", { status: "started", gameId: game.id, modId: parsed.modId, name });
        name = (await nexus.details(parsed.domain, parsed.modId).catch(() => null))?.name ?? name;
        const url = await nexus.downloadUrl(parsed.domain, parsed.modId, parsed.fileId, parsed);
        const result = await installFromUrl(game, url, { name, source: { provider: "nexus", modId: parsed.modId, fileId: parsed.fileId } }, (detail) =>
            send("games:nxm", { status: "working", gameId: game.id, modId: parsed.modId, name, detail })
        );
        send("games:nxm", { status: "installed", gameId: game.id, modId: parsed.modId, name, result });
    } catch (err) {
        send("games:nxm", { status: "failed", gameId: game.id, modId: parsed.modId, name, error: err.message, notes: err.notes ?? [] });
    }
}

/* A page of CurseForge's mods for a game. */
async function searchCurseForge(game, { query, sort, page, size }) {
    const params = new URLSearchParams({
        gameId: String(game.curseforge),
        searchFilter: query,
        pageSize: String(size),
        // CurseForge reaches the first 10,000 results only.
        index: String(Math.min(page * size, 10000 - size)),
        sortField: sort === "updated" ? "3" : sort === "new" ? "11" : sort === "downloads" ? "6" : "2",
        sortOrder: "desc",
    });
    const res = await curseforgeFetch(`/mods/search?${params}`);
    if (!res.ok) throw new Error(`CurseForge search failed (HTTP ${res.status}).`);
    const json = await res.json();
    return {
        total: json.pagination?.totalCount ?? 0,
        mods: (json.data ?? []).map((mod) => ({
            provider: "curseforge",
            id: String(mod.id),
            name: mod.name,
            summary: mod.summary ?? "",
            picture: mod.logo?.thumbnailUrl ?? mod.logo?.url ?? null,
            author: (mod.authors ?? []).map((a) => a.name).join(", "),
            downloads: mod.downloadCount ?? 0,
            endorsements: null,
            version: "",
            updated: mod.dateModified ?? null,
            adult: false,
            url: mod.links?.websiteUrl ?? null,
            installable: mod.allowModDistribution !== false,
        })),
    };
}

function registerGamesIpc() {
    ipcMain.handle("games:list", () => GAMES.map(summary));

    ipcMain.handle("games:get", (_e, id) => {
        const game = need(id);
        const loc = detect.locate(id);
        const played = protect.lastPlayed(id);
        return {
            ...summary(game),
            platform: process.platform,
            updated: protect.updatedSince(game, loc),
            version: (() => {
                const print = protect.fingerprint(game, loc);
                return print?.version ?? print?.label ?? null;
            })(),
            lastPlayed: played?.at ? new Date(played.at).toISOString() : null,
            simsOptions: game.id === "sims4" ? protect.simsOptions(loc) : null,
            problems: game.id === "sims4" ? protect.simsProblems(loc, played?.at ? played.at - 60 * 60 * 1000 : 0) : [],
        };
    });

    ipcMain.handle("games:mods", (_e, id) => {
        const game = need(id);
        const loc = detect.locate(id);
        const threshold = updateTime(game, loc);
        const { mods } = store.list(id);
        return mods.map((mod) => ({ ...mod, mayNeedUpdate: Boolean(threshold && mod.hooks && mod.since && Date.parse(mod.since) < threshold) }));
    });

    ipcMain.handle("games:setEnabled", (_e, id, key, enabled) => store.setModEnabled(need(id).id, String(key), enabled === true));
    ipcMain.handle("games:remove", (_e, id, key) => store.deleteMod(need(id).id, String(key)));

    ipcMain.handle("games:downloads", async (_e, id) => {
        const installed = new Set(store.readState(need(id).id).mods.map((mod) => mod.source?.fileName).filter(Boolean));
        return (await downloads.recent(id)).map((file) => ({ ...file, installed: installed.has(file.name) }));
    });

    // From a file: one given (Downloads, a dropped file), or chosen in a dialog.
    ipcMain.handle("games:install", async (event, id, filePath) => {
        const game = need(id);
        let file = filePath ? String(filePath) : null;
        if (!file) {
            const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
                title: `Install a mod for ${game.name}`,
                properties: ["openFile"],
                filters: [{ name: "Mods", extensions: ["zip", "7z", "rar", "package", "ts4script", "asi", "dll", "oiv", "esp", "esm", "esl", "archive", "reds"] }, { name: "All files", extensions: ["*"] }],
            });
            if (picked.canceled || !picked.filePaths.length) return null;
            file = picked.filePaths[0];
        }
        try {
            return await store.install(id, file);
        } catch (err) {
            // The notes say what to do instead (an OpenIV package, say).
            return { failed: err.message, notes: err.notes ?? [] };
        }
    });

    ipcMain.handle("games:chooseFolder", async (event, id) => {
        const game = need(id);
        const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
            title: `Where is ${game.name}?`,
            message: process.platform === "darwin" ? `Choose ${game.name}'s folder (or its app).` : undefined,
            properties: process.platform === "darwin" ? ["openDirectory", "openFile", "treatPackageAsDirectory"] : ["openDirectory"],
        });
        if (picked.canceled || !picked.filePaths.length) return null;
        return detect.chooseFolder(id, picked.filePaths[0]);
    });
    ipcMain.handle("games:forgetFolder", (_e, id) => detect.chooseFolder(need(id).id, null));

    ipcMain.handle("games:chooseDocs", async (event, id) => {
        const game = need(id);
        const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: `${game.name}'s folder in Documents`, properties: ["openDirectory", "createDirectory"] });
        if (picked.canceled || !picked.filePaths.length) return null;
        return detect.chooseDocsFolder(id, picked.filePaths[0]);
    });

    ipcMain.handle("games:openFolder", async (_e, id, which) => {
        const loc = detect.locate(need(id).id);
        const dir = which === "docs" ? loc.docsDir : loc.gameDir;
        if (!dir) throw new Error("That folder wasn't found.");
        const failed = await shell.openPath(dir);
        if (failed) throw new Error(failed);
    });

    ipcMain.handle("games:launch", (_e, id, options) => {
        const game = need(id);
        return launch(game, detect.locate(id), { safe: options?.safe === true, open: (url) => shell.openExternal(url) });
    });

    ipcMain.handle("games:setSimsOptions", (_e, options) => protect.setSimsOptions(detect.locate("sims4"), { mods: options?.mods, scripts: options?.scripts }));

    // One site, or (for a game on both) Nexus Mods and CurseForge together, as Minecraft's Discover mixes its sources.
    ipcMain.handle("games:search", async (_e, id, options) => {
        const game = need(id);
        const query = String(options?.query ?? "");
        const page = Math.max(0, Number(options?.page) || 0);
        const wanted = options?.provider === "curseforge" || options?.provider === "nexus" ? options.provider : "any";
        const sources = [...(game.nexus && wanted !== "curseforge" ? ["nexus"] : []), ...(game.curseforge && wanted !== "nexus" ? ["curseforge"] : [])];
        if (!sources.length) throw new Error(`${game.name} has no mods on ${wanted === "curseforge" ? "CurseForge" : "Nexus Mods"}.`);
        // Mixed, each gives half a page.
        const size = sources.length > 1 ? 12 : 24;
        const run = (source) =>
            source === "curseforge"
                ? searchCurseForge(game, { query, sort: options?.sort, page, size })
                : nexus.search(game.nexus, { query, sort: options?.sort, page, count: size, adult: options?.adult === true });
        const answers = await Promise.allSettled(sources.map(run));
        const totals = {};
        const lists = [];
        const warnings = [];
        answers.forEach((answer, i) => {
            const label = sources[i] === "curseforge" ? "CurseForge" : "Nexus Mods";
            if (answer.status === "fulfilled") {
                totals[sources[i]] = answer.value.total;
                lists.push(answer.value.mods);
            } else {
                totals[sources[i]] = 0;
                warnings.push(`${label}: ${answer.reason?.message ?? "couldn't be searched"}`);
            }
        });
        if (warnings.length === sources.length) throw new Error(warnings.join(" "));
        // Taking turns, so both sites' best results are near the top.
        const mods = [];
        for (let i = 0; lists.some((list) => i < list.length); i++) for (const list of lists) if (i < list.length) mods.push(list[i]);
        const capped = (source) => (source === "curseforge" ? Math.min(totals[source], 10000) : totals[source]);
        const pageCount = Math.max(1, ...sources.map((source) => Math.ceil(capped(source) / size)));
        return { total: sources.reduce((sum, source) => sum + totals[source], 0), totals, pageCount, mods, warnings };
    });

    ipcMain.handle("games:details", async (_e, id, provider, modId) => {
        const game = need(id);
        if (provider === "curseforge") {
            const [projectRes, descriptionRes, files] = await Promise.all([
                curseforgeFetch(`/mods/${encodeURIComponent(modId)}`),
                curseforgeFetch(`/mods/${encodeURIComponent(modId)}/description`),
                curseforge.getFiles(String(modId)),
            ]);
            if (!projectRes.ok) throw new Error(`CurseForge answered ${projectRes.status}.`);
            const project = (await projectRes.json()).data;
            const html = descriptionRes.ok ? (await descriptionRes.json()).data : project.summary;
            return {
                provider,
                id: String(project.id),
                name: project.name,
                summary: project.summary ?? "",
                picture: project.logo?.url ?? null,
                author: (project.authors ?? []).map((a) => a.name).join(", "),
                downloads: project.downloadCount ?? 0,
                endorsements: null,
                version: "",
                updated: project.dateModified ?? null,
                url: project.links?.websiteUrl ?? null,
                html,
                images: (project.screenshots ?? []).map((shot) => shot.url).slice(0, 12),
                hasKey: true,
                premium: true,
                installable: project.allowModDistribution !== false,
                files: files.slice(0, 20).map((file) => ({ id: file.id, name: file.name, version: "", category: file.downloadUrl ? "File" : "Website only", size: file.size, fileName: file.fileName, date: file.date, description: "" })),
            };
        }
        return { provider: "nexus", ...(await nexus.details(game.nexus, String(modId))) };
    });

    // From a site: straight in where it can be downloaded; otherwise the page to download it from.
    ipcMain.handle("games:installRemote", async (event, id, provider, modId, fileId, name) => {
        const game = need(id);
        const progress = (detail) => event.sender.send("games:progress", { gameId: id, detail });
        try {
            if (provider === "curseforge") {
                const file = await curseforge.resolveDownload(String(modId), fileId ? String(fileId) : null);
                return await installFromUrl(game, file.downloadUrl, { name: String(name || file.name), source: { provider, modId: String(modId), fileId: file.id } }, progress);
            }
            const url = await nexus.downloadUrl(game.nexus, String(modId), String(fileId));
            return await installFromUrl(game, url, { name: String(name || `Nexus mod ${modId}`), source: { provider: "nexus", modId: String(modId), fileId: String(fileId) } }, progress);
        } catch (err) {
            if (err.code === "PREMIUM_REQUIRED" || err.code === "DISTRIBUTION_DENIED") {
                const page = provider === "curseforge" ? null : `https://www.nexusmods.com/${game.nexus}/mods/${modId}?tab=files&file_id=${fileId}&nmm=1`;
                return { needsWebsite: page, reason: err.message };
            }
            return { failed: err.message, notes: err.notes ?? [] };
        }
    });

    // Newer versions of installed mods, updating them, and going back.
    ipcMain.handle("games:checkUpdates", (_e, id) => updates.check(need(id).id));
    ipcMain.handle("games:update", async (event, id, key) => {
        need(id);
        try {
            return await updates.update(id, String(key), (detail) => event.sender.send("games:progress", { gameId: id, detail }));
        } catch (err) {
            return { failed: err.message, notes: err.notes ?? [] };
        }
    });
    ipcMain.handle("games:undoUpdate", (_e, id, key) => store.undoReplace(need(id).id, String(key)));

    ipcMain.handle("games:nexusAccount", async () => {
        nexus.forgetAccount();
        try {
            return await nexus.whoAmI();
        } catch {
            return null;
        }
    });

    ipcMain.handle("games:openUrl", (_e, url) => {
        if (/^https:\/\/(www\.)?(nexusmods\.com|curseforge\.com|dev-c\.com|smapi\.io|skse\.silverlock\.org|f4se\.silverlock\.org|openiv\.com|modcollective\.gg|thesimsresource\.com|gta5-mods\.com)\//i.test(String(url))) return shell.openExternal(String(url));
        throw new Error("That link isn't one the launcher opens.");
    });
}

module.exports = { registerGamesIpc, handleNxm };
