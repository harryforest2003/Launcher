/*
 * What kinds of content Modrinth and CurseForge offer, and where each belongs in
 * an instance. Every search, install and modpack goes through these, so the two
 * sources cannot disagree about what something is or where it goes.
 */

// CurseForge's classes for Minecraft, from /v1/categories?gameId=432&classesOnly=true
export const CF_CLASS_IDS = {
    mod: 6,
    modpack: 4471,
    resourcepack: 12,
    shader: 6552,
    datapack: 6945,
};

const CF_CLASS_TYPES = Object.fromEntries(
    Object.entries(CF_CLASS_IDS).map(([type, id]) => [id, type])
);

// CurseForge modLoaderType values.
export const CF_LOADER_TYPES = {
    forge: 1,
    liteloader: 3,
    fabric: 4,
    "legacy-fabric": 4,
    babric: 4,
    quilt: 5,
    neoforge: 6,
};

// Folders inside the game directory. Data packs really belong to one world, under
// saves/<world>/datapacks. This folder holds any that have no world yet.
export const CONTENT_FOLDERS = {
    mod: "mods",
    resourcepack: "resourcepacks",
    shader: "shaderpacks",
    datapack: "datapacks",
};

export const CONTENT_LABELS = {
    mod: "mod",
    modpack: "modpack",
    resourcepack: "resource pack",
    shader: "shader",
    datapack: "data pack",
};

// Modrinth lists these for server plugins, which a client instance cannot use.
const PLUGIN_LOADERS = new Set([
    "bukkit", "spigot", "paper", "purpur", "folia",
    "bungeecord", "velocity", "waterfall", "sponge",
]);

/*
 * Only mods and modpacks are tied to a mod loader. Both APIs return nothing for a
 * resource pack, shader or data pack if a loader filter is sent with the search,
 * because those files are not tagged with one.
 */
export function usesLoader(type) {
    return type === "mod" || type === "modpack";
}

export function curseForgeType(classId) {
    return CF_CLASS_TYPES[classId] ?? "other";
}

/*
 * Modrinth calls data packs and plugins project_type "mod", so that field alone
 * would show them as mods. all_project_types (search) or loaders (project pages)
 * say what they really are. A project that is also a mod stays a mod.
 */
export function modrinthType(project) {
    const type = (project.project_type || "mod").toLowerCase();
    if (type !== "mod") return type;

    const kinds = project.all_project_types;
    if (Array.isArray(kinds) && kinds.length > 0) {
        if (kinds.includes("mod")) return "mod";
        if (kinds.includes("datapack")) return "datapack";
        if (kinds.includes("plugin")) return "plugin";
        return "mod";
    }

    const loaders = project.loaders;
    if (Array.isArray(loaders) && loaders.length > 0) {
        if (loaders.every(l => l === "datapack")) return "datapack";
        if (loaders.every(l => PLUGIN_LOADERS.has(l))) return "plugin";
    }

    return "mod";
}

/*
 * The content type a downloaded file really is. A data pack sold as a .jar is a
 * mod that carries it, and so it belongs with the mods.
 */
export function targetTypeFor(type, fileName) {
    if (/\.jar$/i.test(fileName)) return "mod";

    if (type === "mod") {
        throw new Error(`"${fileName}" is not a .jar mod file.`);
    }

    if (!/\.zip$/i.test(fileName)) {
        throw new Error(`"${fileName}" is not a file this launcher can install.`);
    }

    return type;
}
