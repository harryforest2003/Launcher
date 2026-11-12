const fs = require("fs");
const path = require("path");
const { tempDir } = require("./archive.cjs");
const { downloadFile } = require("../minecraft/net.cjs");
const store = require("./store.cjs");

/* Downloads a mod's file to a temporary folder, named as the site names it. */
async function fetchToTemp(url, fallbackName) {
    const dir = tempDir("unity-game-download-");
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || fallbackName).replace(/[/\\:*?"<>|]/g, "_") || fallbackName;
    const file = path.join(dir, name);
    await downloadFile(url, file);
    return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/* Downloads a mod and installs it. meta as store.install takes it. */
async function installFromUrl(game, url, meta, progress) {
    progress?.(`Downloading ${meta.name}`);
    const fetched = await fetchToTemp(url, `${meta.name}.zip`);
    try {
        progress?.(`Installing ${meta.name}`);
        return await store.install(game.id, fetched.file, meta);
    } finally {
        fetched.cleanup();
    }
}

module.exports = { installFromUrl };
