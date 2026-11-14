const fs = require("fs");
const path = require("path");
const { tempDir } = require("./archive.cjs");
const { downloadFile } = require("../minecraft/net.cjs");
const store = require("./store.cjs");

/*
 * Downloads a mod's file to a temporary folder, named as the site names it, over https
 * only, and checked against the site's SHA-1 of it when the site gives one.
 */
async function fetchToTemp(url, fallbackName, sha1) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("That download isn't from a secure (https) address.");
    const dir = tempDir("unity-game-download-");
    const fallback = String(fallbackName).replace(/[/\\:*?"<>|]/g, "_");
    let name = fallback;
    try {
        name = decodeURIComponent(parsed.pathname.split("/").pop() || fallback).replace(/[/\\:*?"<>|]/g, "_") || fallback;
    } catch {
        // A name that isn't valid URL encoding: the fallback name.
    }
    if (name === "." || name === "..") name = fallback;
    const file = path.join(dir, name);
    await downloadFile(url, file, { sha1: sha1 || undefined });
    return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/* Downloads a mod and installs it. meta as store.install takes it; sha1 the site's hash of the file, if it has one. */
async function installFromUrl(game, url, meta, progress, { sha1 } = {}) {
    progress?.(`Downloading ${meta.name}`);
    const fetched = await fetchToTemp(url, `${meta.name}.zip`, sha1);
    try {
        progress?.(`Installing ${meta.name}`);
        return await store.install(game.id, fetched.file, meta);
    } finally {
        fetched.cleanup();
    }
}

module.exports = { installFromUrl };
