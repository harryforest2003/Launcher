const { BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { GAMES, getGame } = require("./registry.cjs");
const { readSettings, writeSettings } = require("./storage.cjs");
const detect = require("./detect.cjs");
const store = require("./store.cjs");
const protect = require("./protect.cjs");
const downloads = require("./downloads.cjs");
const nexus = require("./nexus.cjs");
const { launch } = require("./launch.cjs");
const { installFromUrl } = require("./remote.cjs");
const updates = require("./updates.cjs");
const saves = require("./saves.cjs");
const plugins = require("./plugins.cjs");
const requirements = require("./requirements.cjs");
const sets = require("./sets.cjs");
const finder = require("./finder.cjs");
const loot = require("./loot.cjs");
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
        loadOrder: Boolean(game.bethesda),
    };
}

/*
 * After an install, what the mod needs that isn't there yet, sure enough to fetch
 * straight away (the page gets them all, as Update all does).
 */
async function withMissing(gameId, result) {
    if (!result?.mod?.name) return result;
    try {
        result.missing = remember(gameId, (await requirements.missingFor(gameId, result.mod.name)).filter((entry) => entry.auto));
    } catch {
        result.missing = [];
    }
    return result;
}

/*
 * Requirements worked out here, by key. A requirement's page (which can be any site a mod's
 * author named) is opened only from these, never from a link the page passes back.
 */
const known = new Map();
function remember(gameId, entries) {
    for (const entry of entries) known.set(`${gameId}|${entry.key}`, entry);
    return entries;
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
        send("games:nxm", { status: "installed", gameId: game.id, modId: parsed.modId, name, result: await withMissing(game.id, result) });
    } catch (err) {
        send("games:nxm", { status: "failed", gameId: game.id, modId: parsed.modId, name, error: err.message, notes: err.notes ?? [] });
    }
}

/*
 * Adult mods on Nexus Mods: offered only for an account Nexus says is age-verified, and
 * shown only once turned on here. Checked here, not by the page, on every search.
 * -> { hasKey, verified, on, blur, error }
 */
async function adultStatus() {
    let access = null;
    let error = null;
    try {
        access = await nexus.adultAccess();
    } catch (err) {
        error = err.message;
    }
    const verified = access?.verified === true;
    return { hasKey: nexus.hasKey(), verified, on: verified && readSettings().adultMods === true, blur: access?.blur !== false, error };
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
            return await withMissing(id, await store.install(id, file));
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

    // Before a risky play (the game's updated, the mods have changed, or it's the first
    // from here) the saves are backed up. While finding a broken mod, its start did that.
    ipcMain.handle("games:launch", async (_e, id, options) => {
        const game = need(id);
        const loc = detect.locate(id);
        const played = protect.lastPlayed(id);
        const changedAt = Date.parse(store.readState(id).changedAt ?? "") || 0;
        const reason = !played?.at
            ? "Before the first play from the launcher"
            : protect.updatedSince(game, loc)
              ? "Before the first play after a game update"
              : changedAt > played.at
                ? "Before playing with changed mods"
                : null;
        let backedUp = null;
        let backupError = null;
        if (reason && !finder.read(id)) {
            try {
                backedUp = await saves.backup(game, loc, reason);
            } catch (err) {
                backupError = err.message;
            }
        }
        const started = await launch(game, loc, { safe: options?.safe === true, open: (url) => shell.openExternal(url) });
        return { ...started, backedUp, backupError };
    });

    // Saves and their backups.
    ipcMain.handle("games:saves", (_e, id) => {
        const game = need(id);
        return { dir: saves.savesDir(game, detect.locate(id)), backups: saves.list(id) };
    });
    ipcMain.handle("games:backupSaves", async (_e, id) => {
        const game = need(id);
        const made = await saves.backup(game, detect.locate(id), "Backed up from Settings");
        if (!made) throw new Error("There are no saves to back up yet.");
        return made;
    });
    ipcMain.handle("games:restoreSaves", (_e, id, backupId) => saves.restore(need(id), detect.locate(id), String(backupId)));
    ipcMain.handle("games:deleteBackup", (_e, id, backupId) => saves.remove(need(id).id, String(backupId)));
    ipcMain.handle("games:chooseSaves", async (event, id) => {
        const game = need(id);
        const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: `${game.name}'s saves folder`, properties: ["openDirectory"] });
        if (picked.canceled || !picked.filePaths.length) return null;
        saves.chooseSavesDir(id, picked.filePaths[0]);
        return picked.filePaths[0];
    });
    ipcMain.handle("games:forgetSaves", (_e, id) => saves.chooseSavesDir(need(id).id, null));
    ipcMain.handle("games:openSaves", async (_e, id) => {
        const dir = saves.savesDir(need(id), detect.locate(id));
        if (!dir) throw new Error("The saves folder wasn't found.");
        const failed = await shell.openPath(dir);
        if (failed) throw new Error(failed);
    });

    // Skyrim's and Fallout 4's load order.
    // The order, and what fixing it would change (nothing, when it's fine).
    const withFix = (game, loc) => {
        const order = plugins.loadOrder(game, loc);
        const plan = plugins.fixPlan(game, loc);
        return { ...order, fix: { turnOn: plan.turnOn, turnOff: plan.turnOff, moved: plan.moved } };
    };
    ipcMain.handle("games:loadOrder", (_e, id) => {
        const game = need(id);
        if (!game.bethesda) throw new Error(`${game.name} has no load order to set.`);
        return withFix(game, detect.locate(id));
    });
    ipcMain.handle("games:fixLoadOrder", (_e, id) => {
        const game = need(id);
        const loc = detect.locate(id);
        const plan = plugins.fixPlan(game, loc);
        plugins.setOrder(game, loc, plan.order);
        store.touch(id);
        return { ...withFix(game, loc), done: { turnOn: plan.turnOn, turnOff: plan.turnOff, moved: plan.moved } };
    });
    ipcMain.handle("games:setLoadOrder", (_e, id, entries) => {
        const game = need(id);
        const loc = detect.locate(id);
        plugins.setOrder(game, loc, (entries ?? []).map((e) => ({ name: String(e.name), active: e.active === true })));
        store.touch(id);
        return withFix(game, loc);
    });

    // Sorting by LOOT's community masterlist: what it'd move, and doing it (with the order before, for Undo).
    ipcMain.handle("games:lootPlan", async (_e, id) => {
        const game = need(id);
        if (!game.bethesda) throw new Error(`${game.name} has no load order to sort.`);
        const planned = await loot.plan(game, detect.locate(id));
        return { moved: planned.moved, fetchedAt: planned.fetchedAt, loops: planned.loops };
    });
    ipcMain.handle("games:lootSort", async (_e, id) => {
        const game = need(id);
        const loc = detect.locate(id);
        const previous = plugins.loadOrder(game, loc).plugins.map((p) => ({ name: p.name, active: p.active }));
        const planned = await loot.plan(game, loc);
        plugins.setOrder(game, loc, planned.order);
        store.touch(id);
        return { ...withFix(game, loc), previous, moved: planned.moved };
    });

    // What mods need that isn't installed, and getting it.
    ipcMain.handle("games:requirements", async (_e, id) => remember(id, await requirements.missing(need(id).id)));
    ipcMain.handle("games:requirementsBefore", async (_e, id, modId) => {
        try {
            return remember(id, await requirements.missingBeforeInstall(need(id).id, String(modId)));
        } catch {
            return [];
        }
    });
    // -> an install result; { needsWebsite, modId } for a Nexus page to finish on; { opened } for another site's.
    ipcMain.handle("games:getRequirement", async (event, id, key) => {
        need(id);
        const entry = known.get(`${id}|${key}`);
        if (!entry) return { failed: "That requirement has changed since: check again." };
        try {
            const result = await requirements.get(id, entry, (detail) => event.sender.send("games:progress", { gameId: id, detail }));
            if (result.external) {
                if (!/^https?:\/\//i.test(String(result.needsWebsite ?? ""))) return { failed: `${entry.name} has no page to get it from.` };
                await shell.openExternal(result.needsWebsite);
                return { opened: entry.name };
            }
            return result.mod ? await withMissing(id, result) : result;
        } catch (err) {
            return { failed: err.message, notes: err.notes ?? [] };
        }
    });

    // Sets of mods.
    ipcMain.handle("games:sets", (_e, id) => sets.list(need(id).id));
    ipcMain.handle("games:saveSet", (_e, id, set) => sets.save(need(id).id, { id: set?.id ?? null, name: set?.name }));
    ipcMain.handle("games:deleteSet", (_e, id, setId) => sets.remove(need(id).id, String(setId)));
    ipcMain.handle("games:setMember", (_e, id, setId, key, member) => sets.setMember(need(id).id, String(setId), String(key), member === true));
    ipcMain.handle("games:useSet", (_e, id, setId) => {
        const set = sets.list(need(id).id).find((s) => s.id === setId);
        if (!set) throw new Error("That set isn't there any more.");
        const keys = new Set(set.keys);
        let changed = 0;
        for (const mod of store.list(id).mods) {
            const want = keys.has(mod.key);
            if (mod.enabled !== want) {
                store.setModEnabled(id, mod.key, want);
                changed += 1;
            }
        }
        return { changed };
    });

    // Finding the mod that breaks the game.
    ipcMain.handle("games:finder", (_e, id) => finder.status(need(id).id));
    ipcMain.handle("games:finderStart", async (_e, id) => {
        const game = need(id);
        let backedUp = null;
        try {
            backedUp = await saves.backup(game, detect.locate(id), "Before finding a broken mod");
        } catch {
            // Saves can't always be found; the finder still works.
        }
        return { ...finder.start(id), backedUp };
    });
    ipcMain.handle("games:finderAnswer", (_e, id, happened) => finder.answer(need(id).id, happened === true));
    ipcMain.handle("games:finderStop", (_e, id, keepOff) => finder.stop(need(id).id, { keepOff: keepOff ? String(keepOff) : null }));

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
                : nexus.search(game.nexus, { query, sort: options?.sort, page, count: size, adult });
        const adult = sources.includes("nexus") ? (await adultStatus()).on : false;
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
                return await withMissing(id, await installFromUrl(game, file.downloadUrl, { name: String(name || file.name), source: { provider, modId: String(modId), fileId: file.id } }, progress));
            }
            const url = await nexus.downloadUrl(game.nexus, String(modId), String(fileId));
            return await withMissing(id, await installFromUrl(game, url, { name: String(name || `Nexus mod ${modId}`), source: { provider: "nexus", modId: String(modId), fileId: String(fileId) } }, progress));
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

    ipcMain.handle("games:adultStatus", async (_e, recheck) => {
        if (recheck) nexus.forgetAccount();
        return adultStatus();
    });
    ipcMain.handle("games:setAdult", async (_e, on) => {
        const status = await adultStatus();
        if (on && !status.verified) throw new Error("Nexus Mods hasn't age-verified this account, so adult mods stay hidden.");
        const settings = readSettings();
        settings.adultMods = on === true;
        writeSettings(settings);
        return adultStatus();
    });

    ipcMain.handle("games:nexusAccount", async () => {
        nexus.forgetAccount();
        try {
            return await nexus.whoAmI();
        } catch {
            return null;
        }
    });

    ipcMain.handle("games:openUrl", (_e, url) => {
        const allowed = /^https:\/\/(www\.)?(nexusmods\.com|curseforge\.com|dev-c\.com|smapi\.io|skse\.silverlock\.org|f4se\.silverlock\.org|openiv\.com|modcollective\.gg|thesimsresource\.com|gta5-mods\.com)\//i;
        // Script Hook V's own site, and Script Hook V .NET's releases (requirements of GTA V mods).
        const frameworks = /^(http:\/\/www\.dev-c\.com\/gtav\/|https:\/\/github\.com\/scripthookvdotnet\/)/i;
        if (allowed.test(String(url)) || frameworks.test(String(url))) return shell.openExternal(String(url));
        throw new Error("That link isn't one the launcher opens.");
    });
}

module.exports = { registerGamesIpc, handleNxm };
