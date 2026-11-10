const path = require("path");
const shared = require("../shared/contentTypes.mjs");

const { CONTENT_FOLDERS, curseForgeType } = shared;

/*
 * Where a file from a CurseForge modpack goes. Its manifest lists only ids, unlike
 * Modrinth's, which spells out each path, so the project's class decides.
 */
function curseForgePackPath(classId, fileName) {
    const folder = /\.jar$/i.test(fileName)
        ? CONTENT_FOLDERS.mod
        : CONTENT_FOLDERS[curseForgeType(classId)] ?? CONTENT_FOLDERS.mod;

    return path.join(folder, fileName);
}

module.exports = { ...shared, curseForgePackPath };
