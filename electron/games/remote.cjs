const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { tempDir } = require("./archive.cjs");
const { downloadFile } = require("../minecraft/net.cjs");
const store = require("./store.cjs");

/*
 * Downloads a mod's file to a temporary folder, named as the site names it, over https
 * only, and checked against the site's SHA-1 (or MD5) of it when the site gives one.
 * fileName, when the site gives one, beats the name at the end of the link.
 */
async function fetchToTemp(url, fallbackName, { sha1, md5, fileName } = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("That download isn't from a secure (https) address.");
    const dir = tempDir("unity-game-download-");
    const fallback = String(fallbackName).replace(/[/\\:*?"<>|]/g, "_");
    let name = fallback;
    if (fileName) {
        name = String(fileName).replace(/[/\\:*?"<>|]/g, "_") || fallback;
    } else {
        try {
            name = decodeURIComponent(parsed.pathname.split("/").pop() || fallback).replace(/[/\\:*?"<>|]/g, "_") || fallback;
        } catch {
            // A name that isn't valid URL encoding: the fallback name.
        }
    }
    if (name === "." || name === "..") name = fallback;
    const file = path.join(dir, name);
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    await downloadFile(url, file, { sha1: sha1 || undefined });
    if (md5 && !sha1 && crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex") !== String(md5).toLowerCase()) {
        cleanup();
        throw new Error(`${name} didn't download properly (it doesn't match the site's checksum). Try again.`);
    }
    return { file, cleanup };
}

/* Downloads a mod and installs it. meta as store.install takes it; sha1 or md5 the site's hash of the file, fileName its name. */
async function installFromUrl(game, url, meta, progress, { sha1, md5, fileName } = {}) {
    progress?.(`Downloading ${meta.name}`);
    const fetched = await fetchToTemp(url, `${meta.name}.zip`, { sha1, md5, fileName });
    try {
        progress?.(`Installing ${meta.name}`);
        return await store.install(game.id, fetched.file, meta);
    } finally {
        fetched.cleanup();
    }
}

module.exports = { installFromUrl };
