const fs = require("fs");
const path = require("path");
const { ipcMain, shell, dialog, BrowserWindow } = require("electron");
const { assertGranted, openExternalSafely } = require("../security.cjs");

const { detectGames } = require("./gameDetector.cjs");
const { getGame } = require("./gameRegistry.cjs");
const modLibrary = require("./modLibrary.cjs");
const installer = require("./installer.cjs");
const settings = require("./settings.cjs");

const curseforge = require("./providers/curseforge.cjs");
const nexus = require("./providers/nexus.cjs");
const { getSecret, setSecret } = require("../secrets.cjs");
const curseforgeAccess = require("../curseforge.cjs");

const PROVIDERS = [curseforge, nexus];

/* ---------------- helpers ---------------- */

// Detection is filesystem-heavy; cache it and refresh on demand.
let gameCache = null;

function games({ refresh = false } = {}) {
    if (!gameCache || refresh) gameCache = detectGames();
    return gameCache;
}

function findDetected(gameId) {
    const detected = games().find(g => g.id === gameId);

    if (!detected) {
        throw new Error(`"${gameId}" is not currently detected on this machine.`);
    }

    const definition = getGame(gameId);

    if (!definition) {
        throw new Error(`Unknown game "${gameId}".`);
    }

    return { detected, definition };
}

function providersFor(definition) {
    return PROVIDERS.filter(p => p.supports(definition));
}

/* ---------------- registration ---------------- */

function registerModIpc() {
    // Older versions saved the Nexus key as plain text, so move it to encrypted
    // storage. If this system has no keychain it stays where it is for now.
    const plainNexusKey = settings.readSettings().nexusApiKey;
    if (plainNexusKey) {
        try {
            setSecret("nexus", plainNexusKey);
            settings.writeSettings({ nexusApiKey: undefined });
        } catch (err) {
            console.warn("Could not encrypt the Nexus key:", err.message);
        }
    }

    nexus.setApiKey(getSecret("nexus") ?? plainNexusKey);

    /* ----- games ----- */

    ipcMain.handle("mods:getGames", (_e, opts) => {
        const list = games(opts || {});

        return list.map(g => ({
            ...g,
            // Tell the UI which providers can actually search this game.
            availableProviders: providersFor(getGame(g.id) || {}).map(p => ({
                id: p.id,
                label: p.label,
                ready:
                    p.id === "nexus"
                        ? nexus.hasApiKey()
                        : p.id !== "curseforge" || curseforgeAccess.available(),
            })),
        }));
    });

    ipcMain.handle("mods:refreshGames", () => {
        const list = games({ refresh: true });
        return list.length;
    });

    /* ----- installed mods ----- */

    ipcMain.handle("mods:list", (_e, gameId) => {
        const { detected, definition } = findDetected(gameId);
        return modLibrary.listMods(definition, detected.modDir);
    });

    ipcMain.handle("mods:setEnabled", (_e, { gameId, relativePath, enabled }) => {
        const { detected, definition } = findDetected(gameId);
        return modLibrary.setModEnabled(
            definition, detected.modDir, relativePath, enabled
        );
    });

    ipcMain.handle("mods:delete", (_e, { gameId, relativePath }) => {
        const { detected, definition } = findDetected(gameId);
        return modLibrary.deleteMod(definition, detected.modDir, relativePath);
    });

    ipcMain.handle("mods:openFolder", (_e, gameId) => {
        const { detected } = findDetected(gameId);

        if (!detected.modDir) throw new Error("No mod folder for this game.");

        fs.mkdirSync(detected.modDir, { recursive: true });
        shell.openPath(detected.modDir);

        return detected.modDir;
    });

    /* ----- online search ----- */

    ipcMain.handle("mods:search", async (_e, { gameId, query, provider }) => {
        const { definition } = findDetected(gameId);

        const available = providersFor(definition);

        if (available.length === 0) {
            return {
                results: [],
                warnings: [
                    `No mod site with a public API carries ${definition.name}. ` +
                    `You can still install mods from a downloaded file.`,
                ],
            };
        }

        const chosen = provider
            ? available.filter(p => p.id === provider)
            : available;

        const settled = await Promise.allSettled(
            chosen.map(p => p.search(definition, query))
        );

        const results = [];
        const warnings = [];

        settled.forEach((outcome, i) => {
            if (outcome.status === "fulfilled") {
                results.push(...outcome.value);
            } else {
                warnings.push(
                    `${chosen[i].label}: ${outcome.reason?.message ?? "search failed"}`
                );
            }
        });

        // Nexus has no keyword search endpoint; be explicit about it.
        if (chosen.some(p => p.id === "nexus") && nexus.hasApiKey()) {
            warnings.push(
                "Nexus has no public search API — those results come from " +
                "trending and recently updated mods only. Paste a mod URL for an exact match."
            );
        }

        results.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));

        return { results, warnings };
    });

    /* ----- install ----- */

    ipcMain.handle("mods:install", async (event, payload) => {
        const { gameId, provider, projectId, fileId, name } = payload;
        const { detected, definition } = findDetected(gameId);

        const sender = BrowserWindow.fromWebContents(event.sender);

        const report = (percent) => {
            sender?.webContents.send("mods:progress", {
                gameId, projectId, percent,
            });
        };

        let downloadUrl;
        let fileName;
        let sha1;

        if (provider === "curseforge") {
            const file = await curseforge.resolveDownload(projectId, fileId);
            downloadUrl = file.downloadUrl;
            fileName = file.fileName;
            sha1 = file.sha1;

        } else if (provider === "nexus") {
            const link = await nexus.resolveDownload(definition, projectId, fileId);
            downloadUrl = link.downloadUrl;

        } else {
            throw new Error(`Unknown provider "${provider}".`);
        }

        return installer.installFromUrl(
            definition,
            detected.modDir,
            downloadUrl,
            { name, source: provider, projectId, fileName, sha1 },
            report
        );
    });

    // The primary path for Sims 4 CC and anything Nexus-hosted.
    ipcMain.handle("mods:installFromFile", async (event, { gameId, filePaths }) => {
        const { detected, definition } = findDetected(gameId);

        // Files a page names have to be ones the launcher offered it (see security.cjs);
        // otherwise they're chosen here.
        let files = Array.isArray(filePaths) ? filePaths.map((file) => assertGranted("game-download", file)) : [];

        if (files.length === 0) {
            const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
                title: `Install mods for ${definition.name}`,
                properties: ["openFile", "multiSelections"],
                filters: [
                    {
                        name: "Mod files",
                        extensions: [
                            "zip",
                            ...(definition.modExtensions ?? []).map(e => e.replace(".", "")),
                        ],
                    },
                ],
            });

            if (picked.canceled) return { installed: [], count: 0, canceled: true };

            files = picked.filePaths;
        }

        const installed = [];
        const errors = [];

        for (const file of files) {
            try {
                const result = await installer.installLocalFile(
                    definition,
                    detected.modDir,
                    file,
                    { name: path.basename(file, path.extname(file)), source: "file" }
                );

                installed.push(...result.installed);

            } catch (err) {
                errors.push(`${path.basename(file)}: ${err.message}`);
            }
        }

        return { installed, count: installed.length, errors };
    });

    ipcMain.handle("mods:openUrl", (_e, url) => {
        // Only ever open real web links.
        if (!/^https?:\/\//i.test(url)) {
            throw new Error("Refusing to open a non-http(s) URL.");
        }

        if (!openExternalSafely(url)) throw new Error("Refusing to open that link.");
    });

    /* ----- settings ----- */

    ipcMain.handle("mods:getSettings", () => settings.publicSettings());
}

module.exports = { registerModIpc };
