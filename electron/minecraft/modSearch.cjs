const { fetchJson } = require("./net.cjs");
const { curseforgeJson } = require("../curseforge.cjs");
const { createCatalog } = require("../shared/catalog.mjs");
const {
    CF_LOADER_TYPES,
    CONTENT_LABELS,
    curseForgeType,
    modrinthType,
    targetTypeFor,
    usesLoader,
} = require("./contentTypes.cjs");

/*
 * Browsing both sites, and resolving the exact file to download for an instance's
 * Minecraft version (and mod loader, for mods). Modrinth and CurseForge follow the
 * same rules here, so an item behaves the same whichever source it came from.
 */

const MODRINTH = "https://api.modrinth.com/v2";

/* =========================================================
   BROWSING
========================================================= */

const catalog = createCatalog({
    modrinth: path => fetchJson(`${MODRINTH}${path}`),
    curseforge: path => curseforgeJson(path),
});

const browse = options => catalog.browse(options);
const resetCatalog = () => catalog.reset();
const resolveProjectLink = link => catalog.resolveProjectLink(link);

/* =========================================================
   FILE RESOLUTION
========================================================= */

function noBuildError(type, mcVersion, loader) {
    const label = CONTENT_LABELS[type] ?? "project";
    const onLoader = usesLoader(type) && loader && loader !== "vanilla" ? ` on ${loader}` : "";
    const err = new Error(`No version of this ${label} supports Minecraft ${mcVersion}${onLoader}.`);
    err.code = "NO_BUILD";
    return err;
}

async function modrinthVersions(projectId, mcVersion, loaders) {
    const url = new URL(`${MODRINTH}/project/${projectId}/version`);

    url.searchParams.set("game_versions", JSON.stringify([mcVersion]));

    if (loaders.length) {
        url.searchParams.set("loaders", JSON.stringify(loaders));
    }

    return (await fetchJson(url.toString())) ?? [];
}

/*
 * Picks the newest release matching this instance. Only mods filter by the
 * instance's loader: Modrinth lists resource packs under "minecraft", shaders under
 * their shader mod and data packs under "datapack", so asking for "fabric" would
 * find none of them.
 */
async function resolveModrinthFile(projectId, mcVersion, loader, type = "mod") {
    const instanceLoaders = loader && loader !== "vanilla" ? [loader] : [];

    let versions;

    if (type === "mod") {
        versions = await modrinthVersions(projectId, mcVersion, instanceLoaders);
    } else if (type === "datapack") {
        // Prefer the plain data pack. Some only come as a mod that carries one.
        versions = await modrinthVersions(projectId, mcVersion, ["datapack"]);
        if (!versions.length && instanceLoaders.length) {
            versions = await modrinthVersions(projectId, mcVersion, instanceLoaders);
        }
    } else {
        versions = await modrinthVersions(projectId, mcVersion, []);
    }

    if (!versions.length) throw noBuildError(type, mcVersion, loader);

    // Prefer a stable release over beta/alpha.
    const release = versions.find(v => v.version_type === "release") ?? versions[0];
    const file = release.files.find(f => f.primary) ?? release.files[0];

    if (!file?.url) throw new Error(`That ${CONTENT_LABELS[type] ?? "project"} has no downloadable file.`);

    // Iris and OptiFine read shaderpacks. Modrinth's other "shaders" (vanilla core
    // shaders, Canvas pipelines) are really resource packs, and load from there.
    const isShaderPack = (release.loaders ?? []).some(l => l === "iris" || l === "optifine");
    const contentType = type === "shader" && !isShaderPack ? "resourcepack" : type;

    return {
        url: file.url,
        fileName: file.filename,
        sha1: file.hashes?.sha1 ?? null,
        versionNumber: release.version_number,
        published: release.date_published ?? null,
        channel: release.version_type ?? "release",
        targetType: targetTypeFor(contentType, file.filename),
        dependencies: await requiredProjects(release.dependencies),
    };
}

/*
 * The projects a Modrinth version requires. Some name only the exact version they need,
 * not the project, so those are looked up.
 */
async function requiredProjects(dependencies = []) {
    const required = dependencies.filter(d => d.dependency_type === "required" && (d.project_id || d.version_id));
    const ids = await Promise.all(
        required.map(async d => {
            if (d.project_id) return d.project_id;
            try {
                return (await fetchJson(`${MODRINTH}/version/${d.version_id}`))?.project_id ?? null;
            } catch {
                return null;
            }
        })
    );
    return [...new Set(ids.filter(Boolean))];
}

async function resolveCurseForgeFile(projectId, mcVersion, loader, type = "mod") {
    const params = new URLSearchParams({
        gameVersion: mcVersion,
        pageSize: "50",
    });

    if (usesLoader(type) && CF_LOADER_TYPES[loader] !== undefined) {
        params.set("modLoaderType", String(CF_LOADER_TYPES[loader]));
    }

    const data = await curseforgeJson(`/mods/${projectId}/files?${params}`);

    // A server pack is for running a server, not for this client instance.
    const files = (data.data ?? []).filter(f => !f.isServerPack && f.isAvailable !== false);

    if (!files.length) throw noBuildError(type, mcVersion, loader);

    // releaseType 1 = release, 2 = beta, 3 = alpha
    const chosen = files.find(f => f.releaseType === 1) ?? files[0];

    if (!chosen.downloadUrl) {
        const err = new Error(
            "This author has disabled third-party downloads. " +
            "Get it from the CurseForge site instead."
        );
        err.code = "DISTRIBUTION_DENIED";
        throw err;
    }

    return {
        url: chosen.downloadUrl,
        fileName: chosen.fileName,
        // algo 1 is SHA-1, the same check Modrinth files get.
        sha1: chosen.hashes?.find(h => h.algo === 1)?.value ?? null,
        versionNumber: chosen.displayName,
        channel: { 1: "release", 2: "beta", 3: "alpha" }[chosen.releaseType] ?? "release",
        targetType: targetTypeFor(type, chosen.fileName),
        dependencies: (chosen.dependencies ?? [])
            .filter(d => d.relationType === 3)      // required
            .map(d => String(d.modId)),
    };
}

async function resolveModFile(source, projectId, mcVersion, loader, type = "mod") {
    if (source === "modrinth") {
        return resolveModrinthFile(projectId, mcVersion, loader, type);
    }

    if (source === "curseforge") {
        return resolveCurseForgeFile(projectId, mcVersion, loader, type);
    }

    throw new Error(`Unknown source "${source}".`);
}

/* ---------------- project metadata ---------------- */

async function getModrinthProject(projectId) {
    const p = await fetchJson(`${MODRINTH}/project/${projectId}`);

    return {
        source: "modrinth",
        id: p.id,
        name: p.title,
        icon: p.icon_url || null,
        type: modrinthType(p),
    };
}

async function getCurseForgeProject(projectId) {
    const data = await curseforgeJson(`/mods/${projectId}`);
    const mod = data.data ?? {};

    return {
        source: "curseforge",
        id: String(mod.id ?? projectId),
        name: mod.name ?? `Project ${projectId}`,
        icon: mod.logo?.url ?? null,
        type: curseForgeType(mod.classId),
    };
}

async function getProject(source, projectId) {
    if (source === "modrinth") return getModrinthProject(projectId);
    if (source === "curseforge") return getCurseForgeProject(projectId);

    throw new Error(`Unknown source "${source}".`);
}

/*
 * Walks the required-dependency graph.
 *
 * Dependencies frequently have dependencies of their own (a mod needs an API,
 * which needs a core library), so this recurses rather than taking only the first
 * level. Each one is resolved by its own type, because a dependency isn't always a
 * mod. `visited` stops cycles and avoids resolving the same project twice.
 */
async function collectDependencies(
    source,
    projectId,
    mcVersion,
    loader,
    type = "mod",
    { visited = new Set(), depth = 0, maxDepth = 5 } = {}
) {
    if (depth >= maxDepth) return [];

    const key = `${source}:${projectId}`;
    if (visited.has(key)) return [];
    visited.add(key);

    let file;

    try {
        file = await resolveModFile(source, projectId, mcVersion, loader, type);
    } catch {
        // A dependency with no build for this version/loader is skipped
        // rather than failing the whole install.
        return [];
    }

    const out = [];

    for (const depId of file.dependencies ?? []) {
        const depKey = `${source}:${depId}`;
        if (visited.has(depKey)) continue;

        let info;
        let depFile;

        try {
            info = await getProject(source, depId);
            const depType = info.type === "other" ? "mod" : info.type;
            if (depType === "modpack" || depType === "plugin") continue;
            depFile = await resolveModFile(source, depId, mcVersion, loader, depType);
        } catch {
            continue;
        }

        out.push({ source, projectId: String(depId), info, file: depFile });

        // Recurse into the dependency's own requirements.
        const nested = await collectDependencies(
            source, depId, mcVersion, loader, info.type === "other" ? "mod" : info.type,
            { visited, depth: depth + 1, maxDepth }
        );

        out.push(...nested);
    }

    return out;
}

module.exports = {
    browse,
    resetCatalog,
    resolveProjectLink,
    resolveModFile,
    getModrinthProject,
    getCurseForgeProject,
    getProject,
    collectDependencies,
};
