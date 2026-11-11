const fs = require("fs");
const path = require("path");
const { withZip } = require("./zipFile.cjs");
const { nativeImage } = require("electron");
const instanceMods = require("./instanceMods.cjs");
const { modInfo } = require("./modInfo.cjs");

/*
 * What the content list shows for files the sites know nothing about: each item's own
 * icon (a mod's from inside its jar, a pack's pack.png) shrunk to a thumbnail, and the
 * authors a mod names. Read once per file version, then kept.
 */

const ICON_SIZE = 64;
const cache = new Map();

const keyOf = (item) => `${item.type}/${item.world ?? ""}/${item.fileName}`;

/* A PNG as a small data URL, or null. */
function thumbnail(buffer) {
    if (!buffer?.length) return null;
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) return null;
    const { width, height } = image.getSize();
    const scaled = width > ICON_SIZE || height > ICON_SIZE ? image.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: "good" }) : image;
    return scaled.toDataURL();
}

function zipEntry(file, name) {
    return withZip(file, (directory) => {
        const entry = directory.files.find((e) => e.path === name.replace(/^\//, ""));
        return entry ? entry.buffer() : null;
    });
}

async function detailsFor(file, item) {
    if (item.kind === "folder") {
        const png = path.join(file, "pack.png");
        return { icon: fs.existsSync(png) ? thumbnail(fs.readFileSync(png)) : null, authors: [] };
    }
    if (item.type === "mod") {
        const info = await modInfo(file);
        const icon = info?.icon ? thumbnail(await zipEntry(file, info.icon).catch(() => null)) : null;
        return { icon, authors: info?.authors ?? [] };
    }
    // Resource packs and data packs carry a pack.png; shader packs rarely have one.
    return { icon: thumbnail(await zipEntry(file, "pack.png").catch(() => null)), authors: [] };
}

/* { "mod//sodium.jar": { icon, authors } } for everything in the instance. */
async function contentDetails(folder) {
    const content = instanceMods.listContent(folder);
    const items = ["mod", "resourcepack", "shader", "datapack"].flatMap((type) => content[type] ?? []);
    const out = {};

    await Promise.all(
        items.map(async (item) => {
            let file = instanceMods.resolveItem(folder, item);
            if (!item.enabled) file += ".disabled";
            let stat;
            try {
                stat = fs.statSync(file);
            } catch {
                return;
            }
            const cacheKey = `${file}:${stat.size}:${stat.mtimeMs}`;
            if (!cache.has(cacheKey)) cache.set(cacheKey, detailsFor(file, item).catch(() => ({ icon: null, authors: [] })));
            out[keyOf(item)] = await cache.get(cacheKey);
        })
    );

    return out;
}

module.exports = { contentDetails };
