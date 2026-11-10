const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app, dialog } = require("electron");
const account = require("./account.cjs");

/*
 * Changes the signed-in player's real skin and cape through Mojang's API, so a skin
 * chosen in the launcher is the one other players see in game.
 */

const PROFILE = "https://api.minecraftservices.com/minecraft/profile";

// Skins applied by address, or downloaded, only ever come from Mojang's texture server.
const TEXTURE_HOST = "textures.minecraft.net";

const PNG_SIGNATURE = "89504e470d0a1a0a";

function friendlyError(status, failure) {
    const reason = failure?.errorMessage ?? "";

    if (status === 401 || (status === 403 && /auth token/i.test(reason))) {
        return "Your Minecraft sign-in has expired. Sign in again on the Minecraft page.";
    }

    if (status === 429) {
        return "Mojang is limiting skin changes right now. Wait a minute, then try again.";
    }

    if (status === 400 || status === 403) {
        return reason ? `Mojang didn't accept that: ${reason}` : "Mojang didn't accept that change.";
    }

    return `Changing your skin failed (HTTP ${status}).`;
}

async function call(method, suffix, body) {
    const headers = { Authorization: `Bearer ${await account.minecraftAccessToken()}` };
    let payload;

    if (body instanceof FormData) {
        payload = body;
    } else if (body) {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
    }

    const res = await fetch(PROFILE + suffix, { method, headers, body: payload });

    if (!res.ok) {
        throw new Error(friendlyError(res.status, await res.json().catch(() => null)));
    }

    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

const secure = (url) => (url ? url.replace(/^http:\/\//, "https://") : null);

function describe(profile) {
    const skins = profile.skins ?? [];
    const skin = skins.find((entry) => entry.state === "ACTIVE") ?? skins[0];

    return {
        name: profile.name,
        uuid: profile.id,
        skin: skin ? { url: secure(skin.url), slim: skin.variant === "SLIM" } : null,
        capes: (profile.capes ?? []).map((cape) => ({
            id: cape.id,
            name: cape.alias ?? "Cape",
            url: secure(cape.url),
            active: cape.state === "ACTIVE",
        })),
    };
}

/* The changes answer with the profile. If one ever answers with nothing, it's fetched. */
async function settle(changed) {
    const profile = describe(changed ?? (await call("GET", "")));
    if (profile.skin) account.updateSkin(profile.skin.url);
    return profile;
}

async function getProfile() {
    if (!account.readAccount()) return null;
    return settle(await call("GET", ""));
}

const variant = (slim) => (slim ? "slim" : "classic");

function textureUrl(url) {
    const parsed = new URL(url);

    if (parsed.hostname !== TEXTURE_HOST) {
        throw new Error("Only skins from Minecraft's own texture server can be used this way.");
    }

    return parsed.href;
}

function checkSkinImage(buffer) {
    if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) {
        throw new Error("A skin has to be a PNG image.");
    }

    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);

    if (width !== 64 || (height !== 64 && height !== 32)) {
        throw new Error(`A skin has to be 64×64 pixels, or the older 64×32. That image is ${width}×${height}.`);
    }
}

function applyFromUrl(url, slim) {
    return call("POST", "/skins", { variant: variant(slim), url: textureUrl(url) }).then(settle);
}

// Files chosen in the dialog, so the page refers to them by number rather than by path.
const pickedFiles = new Map();
let nextPick = 1;

async function pickFile(window) {
    const result = await dialog.showOpenDialog(window, {
        title: "Choose a skin",
        filters: [{ name: "Skin images", extensions: ["png"] }],
        properties: ["openFile"],
    });

    const file = result.filePaths?.[0];
    if (result.canceled || !file) return null;

    const buffer = fs.readFileSync(file);
    checkSkinImage(buffer);

    const id = String(nextPick++);
    pickedFiles.set(id, file);

    return {
        id,
        name: path.basename(file, path.extname(file)),
        dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    };
}

async function uploadImage(buffer, fileName, slim) {
    checkSkinImage(buffer);

    const form = new FormData();
    form.append("variant", variant(slim));
    form.append("file", new Blob([buffer], { type: "image/png" }), fileName);

    return settle(await call("POST", "/skins", form));
}

function uploadPicked(id, slim) {
    const file = pickedFiles.get(id);
    if (!file) throw new Error("Choose the skin file again.");

    return uploadImage(fs.readFileSync(file), path.basename(file), slim);
}

const resetSkin = async () => settle(await call("DELETE", "/skins/active"));

const setCape = async (capeId) =>
    settle(capeId ? await call("PUT", "/capes/active", { capeId }) : await call("DELETE", "/capes/active"));

async function download(window, url, name) {
    const source = secure(textureUrl(url));

    const result = await dialog.showSaveDialog(window, {
        title: "Save skin",
        defaultPath: path.join(app.getPath("downloads"), `${String(name || "skin").replace(/[^\w.-]+/g, "_")}.png`),
        filters: [{ name: "PNG image", extensions: ["png"] }],
    });

    if (result.canceled || !result.filePath) return null;

    const res = await fetch(source);
    if (!res.ok) throw new Error(`Couldn't download that skin (HTTP ${res.status}).`);

    const buffer = Buffer.from(await res.arrayBuffer());
    checkSkinImage(buffer);
    fs.writeFileSync(result.filePath, buffer);

    return result.filePath;
}

/* ---------------- editing in Blockbench ---------------- */

const PNG_DATA_URL = /^data:image\/png;base64,/;

/* The image for a skin the page is showing, whichever way it was loaded. */
async function skinImage(skin) {
    let buffer;

    if (PNG_DATA_URL.test(skin)) {
        buffer = Buffer.from(skin.replace(PNG_DATA_URL, ""), "base64");
    } else {
        const res = await fetch(secure(textureUrl(skin)));
        if (!res.ok) throw new Error(`Couldn't download that skin (HTTP ${res.status}).`);
        buffer = Buffer.from(await res.arrayBuffer());
    }

    checkSkinImage(buffer);
    return buffer;
}

/* An edited skin, kept like a chosen file so it can be previewed, applied or saved. */
function keepEditedSkin(buffer, name) {
    checkSkinImage(buffer);

    const folder = path.join(app.getPath("temp"), "unity-launcher-skins");
    fs.mkdirSync(folder, { recursive: true });

    const file = path.join(folder, `${crypto.randomUUID()}.png`);
    fs.writeFileSync(file, buffer);

    const id = String(nextPick++);
    pickedFiles.set(id, file);

    return { id, name, dataUrl: `data:image/png;base64,${buffer.toString("base64")}` };
}

/* ---------------- saved skins ---------------- */

/*
 * Skins kept in the launcher to switch back to later. Each is the image itself, since
 * Mojang keeps no copy of a skin once another replaces it.
 */
const savedFolder = () => path.join(app.getPath("userData"), "saved-skins");
const savedList = () => path.join(savedFolder(), "saved-skins.json");
const savedImage = (id) => path.join(savedFolder(), `${id}.png`);

function readSaved() {
    try {
        return JSON.parse(fs.readFileSync(savedList(), "utf8"));
    } catch {
        return [];
    }
}

function writeSaved(list) {
    fs.mkdirSync(savedFolder(), { recursive: true });
    fs.writeFileSync(savedList(), JSON.stringify(list, null, 2));
}

function savedEntry(id) {
    const entry = readSaved().find((saved) => saved.id === id);
    if (!entry) throw new Error("That saved skin isn't there any more.");
    return entry;
}

function listSaved() {
    return readSaved().flatMap((entry) => {
        try {
            const data = fs.readFileSync(savedImage(entry.id)).toString("base64");
            return [{ ...entry, dataUrl: `data:image/png;base64,${data}` }];
        } catch {
            return [];
        }
    });
}

async function saveSkin({ url, pickedId, savedId, name, slim }) {
    let buffer;

    if (pickedId) {
        const file = pickedFiles.get(pickedId);
        if (!file) throw new Error("Choose the skin file again.");
        buffer = fs.readFileSync(file);
    } else if (savedId) {
        buffer = fs.readFileSync(savedImage(savedEntry(savedId).id));
    } else {
        const res = await fetch(secure(textureUrl(url)));
        if (!res.ok) throw new Error(`Couldn't download that skin (HTTP ${res.status}).`);
        buffer = Buffer.from(await res.arrayBuffer());
    }

    checkSkinImage(buffer);

    const id = crypto.randomUUID();
    fs.mkdirSync(savedFolder(), { recursive: true });
    fs.writeFileSync(savedImage(id), buffer);

    writeSaved([
        {
            id,
            name: String(name || "Skin").trim().slice(0, 60) || "Skin",
            slim: Boolean(slim),
            savedAt: new Date().toISOString(),
        },
        ...readSaved(),
    ]);

    return listSaved();
}

function useSaved(id, slim) {
    const entry = savedEntry(id);
    return uploadImage(fs.readFileSync(savedImage(entry.id)), `${entry.name}.png`, slim ?? entry.slim);
}

function deleteSaved(id) {
    const entry = savedEntry(id);
    writeSaved(readSaved().filter((saved) => saved.id !== entry.id));
    fs.rmSync(savedImage(entry.id), { force: true });
    return listSaved();
}

module.exports = {
    skinImage,
    keepEditedSkin,
    listSaved,
    saveSkin,
    useSaved,
    deleteSaved,
    getProfile,
    applyFromUrl,
    pickFile,
    uploadPicked,
    resetSkin,
    setCape,
    download,
};
