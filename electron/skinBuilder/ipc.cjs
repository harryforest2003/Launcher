const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { readSettings, writeSettings } = require("../minecraft/settings.cjs");
const { fitUvToTextures } = require("./uvFit.cjs");

/*
 * Storage and file output for the Skin Builder. All the image and model work
 * happens in the renderer; this side only keeps files safe on disk.
 *
 *   <userData>/skin-builder/library.json          groups, and every skin's details
 *   <userData>/skin-builder/skins/<id>/<file>     the files in SKIN_FILES
 */

const SKIN_FILES = new Set([
    "source.png",
    "mask.png",
    "hints.png",
    "texture.png",
    "model.json",
    "skin.bbmodel",
    "thumb.png",
    "glow.png",
    "glow_still.png",
]);

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const OUTPUT_FOLDER_SETTING = "skinPackFolder";

function rootFolder() {
    return path.join(app.getPath("userData"), "skin-builder");
}

function libraryPath() {
    return path.join(rootFolder(), "library.json");
}

function assertId(id) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
        throw new Error("That skin or group id is not valid.");
    }
    return id;
}

function skinFolder(id) {
    return path.join(rootFolder(), "skins", assertId(id));
}

function skinFile(id, file) {
    if (!SKIN_FILES.has(file)) {
        throw new Error(`"${file}" is not a skin file.`);
    }
    return path.join(skinFolder(id), file);
}

function readLibrary() {
    try {
        const stored = JSON.parse(fs.readFileSync(libraryPath(), "utf8"));
        return {
            groups: Array.isArray(stored.groups) ? stored.groups : [],
            skins: Array.isArray(stored.skins) ? stored.skins : [],
        };
    } catch (err) {
        if (err.code === "ENOENT") return { groups: [], skins: [] };
        // Starting empty here would overwrite the user's library on the next save.
        throw new Error(`The skin library could not be read: ${err.message}`);
    }
}

/* Written to a temporary file first, so a crash cannot leave half a library. */
function writeLibrary(library) {
    fs.mkdirSync(rootFolder(), { recursive: true });
    const temporary = `${libraryPath()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(library, null, 2));
    fs.renameSync(temporary, libraryPath());
}

function cleanName(name) {
    const trimmed = String(name ?? "").trim().slice(0, 60);
    if (!trimmed) throw new Error("A name cannot be empty.");
    return trimmed;
}

function findGroup(library, groupId) {
    if (groupId == null) return null;
    const group = library.groups.find((entry) => entry.id === groupId);
    if (!group) throw new Error("That group no longer exists.");
    return group.id;
}

function withThumb(meta) {
    try {
        const bytes = fs.readFileSync(skinFile(meta.id, "thumb.png"));
        return { ...meta, thumb: `data:image/png;base64,${bytes.toString("base64")}` };
    } catch {
        return meta;
    }
}

function outputFolder() {
    return readSettings()[OUTPUT_FOLDER_SETTING] || "";
}

function focusedWindow(event) {
    return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

function registerSkinBuilderIpc() {
    ipcMain.handle("skinBuilder:getLibrary", () => {
        const library = readLibrary();
        return { groups: library.groups, skins: library.skins.map(withThumb) };
    });

    ipcMain.handle("skinBuilder:saveSkin", (_event, { meta, files }) => {
        const id = assertId(meta?.id);
        const library = readLibrary();
        const folder = skinFolder(id);

        const names = Object.keys(files ?? {});
        for (const name of names) {
            if (!SKIN_FILES.has(name)) throw new Error(`"${name}" is not a skin file.`);
        }

        fs.mkdirSync(folder, { recursive: true });
        for (const name of names) {
            fs.writeFileSync(path.join(folder, name), Buffer.from(files[name]));
        }

        const stored = {
            id,
            name: cleanName(meta.name),
            itemId: String(meta.itemId),
            groupId: findGroup(library, meta.groupId),
            createdAt: String(meta.createdAt),
            updatedAt: String(meta.updatedAt),
            textureWidth: Number(meta.textureWidth),
            textureHeight: Number(meta.textureHeight),
            elementCount: Number(meta.elementCount),
            atlasPixels: Number(meta.atlasPixels),
            params: meta.params,
        };

        const index = library.skins.findIndex((skin) => skin.id === id);
        if (index >= 0) library.skins[index] = stored;
        else library.skins.push(stored);
        writeLibrary(library);

        return withThumb(stored);
    });

    ipcMain.handle("skinBuilder:readSkinFile", (_event, { id, file }) => {
        return new Uint8Array(fs.readFileSync(skinFile(id, file)));
    });

    ipcMain.handle("skinBuilder:updateSkin", (_event, { id, patch }) => {
        const library = readLibrary();
        const skin = library.skins.find((entry) => entry.id === assertId(id));
        if (!skin) throw new Error("That skin no longer exists.");

        if (patch?.name !== undefined) skin.name = cleanName(patch.name);
        if (patch?.groupId !== undefined) skin.groupId = findGroup(library, patch.groupId);
        skin.updatedAt = new Date().toISOString();

        writeLibrary(library);
        return withThumb(skin);
    });

    ipcMain.handle("skinBuilder:deleteSkin", (_event, id) => {
        const library = readLibrary();
        library.skins = library.skins.filter((skin) => skin.id !== assertId(id));
        writeLibrary(library);
        fs.rmSync(skinFolder(id), { recursive: true, force: true });
    });

    ipcMain.handle("skinBuilder:createGroup", (_event, name) => {
        const library = readLibrary();
        const group = {
            id: crypto.randomUUID(),
            name: cleanName(name),
            createdAt: new Date().toISOString(),
        };
        library.groups.push(group);
        writeLibrary(library);
        return group;
    });

    ipcMain.handle("skinBuilder:renameGroup", (_event, { id, name }) => {
        const library = readLibrary();
        const group = library.groups.find((entry) => entry.id === assertId(id));
        if (!group) throw new Error("That group no longer exists.");
        group.name = cleanName(name);
        writeLibrary(library);
        return group;
    });

    ipcMain.handle("skinBuilder:deleteGroup", (_event, id) => {
        const library = readLibrary();
        library.groups = library.groups.filter((group) => group.id !== assertId(id));
        for (const skin of library.skins) {
            if (skin.groupId === id) skin.groupId = null;
        }
        writeLibrary(library);
    });

    ipcMain.handle("skinBuilder:getOutputFolder", () => outputFolder());

    ipcMain.handle("skinBuilder:pickOutputFolder", async (event) => {
        const current = outputFolder();
        const result = await dialog.showOpenDialog(focusedWindow(event), {
            title: "Choose where to save resource packs",
            buttonLabel: "Use This Folder",
            defaultPath: current || app.getPath("documents"),
            properties: ["openDirectory", "createDirectory"],
        });

        if (result.canceled || result.filePaths.length === 0) return null;

        writeSettings({ [OUTPUT_FOLDER_SETTING]: result.filePaths[0] });
        return result.filePaths[0];
    });

    ipcMain.handle("skinBuilder:writePack", (_event, { fileName, bytes, overwrite }) => {
        const folder = outputFolder();
        if (!folder) throw new Error("Choose an output folder first.");
        if (!fs.existsSync(folder)) {
            throw new Error(`The output folder no longer exists: ${folder}`);
        }

        // The file goes in the remembered folder, whatever name the page sends.
        const name = path.basename(String(fileName));
        if (!name.toLowerCase().endsWith(".zip") || name.startsWith(".")) {
            throw new Error("A pack file must be a .zip with a normal name.");
        }

        const target = path.join(folder, name);
        if (fs.existsSync(target) && !overwrite) {
            return { written: false, exists: true, path: target };
        }

        fs.writeFileSync(target, Buffer.from(bytes));
        return { written: true, path: target };
    });

    ipcMain.handle("skinBuilder:revealPath", (_event, target) => {
        const folder = outputFolder();
        const resolved = path.resolve(String(target));
        if (!folder || path.dirname(resolved) !== path.resolve(folder)) {
            throw new Error("Only files in the output folder can be shown.");
        }
        shell.showItemInFolder(resolved);
    });

    /*
     * Opens a saved skin's Blockbench file in the editor inside the launcher. Resolves
     * when the editor closes, with what was saved last (or null). The page turns that
     * back into the skin's model and textures, since it holds the code that makes them.
     */
    ipcMain.handle("skinBuilder:editInBlockbench", async (event, id) => {
        const file = skinFile(id, "skin.bbmodel");
        if (!fs.existsSync(file)) throw new Error("This skin has no Blockbench file. Save it again to make one.");

        const meta = readLibrary().skins.find((skin) => skin.id === id);
        const { openEditor } = require("../blockbench/index.cjs");

        // Its UV size is fitted to its textures, so they show in Blockbench exactly as they are.
        let model = fs.readFileSync(file, "utf8");
        try {
            model = JSON.stringify(fitUvToTextures(JSON.parse(model)));
        } catch {
            // Opened as it is: Blockbench says what's wrong with it.
        }

        return openEditor(
            { kind: "model", name: meta?.name ?? "Skin", model },
            async (saved) => {
                if (typeof saved?.model !== "string" || !Array.isArray(saved?.textures)) {
                    throw new Error("Blockbench didn't send the model back.");
                }
                checkJavaRotations(JSON.parse(saved.model));
                return "Saved. Press Done to update the skin.";
            },
            BrowserWindow.fromWebContents(event.sender)
        );
    });
}

/*
 * Minecraft item models turn a box about one axis only, by up to 45 degrees in steps of
 * 22.5. Checked as Blockbench saves, so it can say so while the model is still open.
 */
function checkJavaRotations(project) {
    for (const element of project.elements ?? []) {
        const turned = (element.rotation ?? [0, 0, 0]).filter((angle) => angle);
        const fits =
            turned.length === 0 ||
            (turned.length === 1 && Math.abs(turned[0]) <= 45 && Number.isInteger(turned[0] / 22.5));

        if (!fits) {
            throw new Error(
                `"${element.name ?? "A box"}" is turned in a way Minecraft item models can't show. ` +
                "Turn boxes about one axis only, by -45, -22.5, 22.5 or 45 degrees."
            );
        }
    }
}

module.exports = { registerSkinBuilderIpc };
