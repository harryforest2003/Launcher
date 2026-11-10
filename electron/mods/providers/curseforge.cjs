/*
 * CurseForge provider — works for any game CurseForge carries.
 *
 * As of writing that is 38 games, including The Sims 4 (78062),
 * Stardew Valley (669), Palworld (85196) and Terraria (431).
 * It does NOT carry GTA V, Skyrim or Cyberpunk 2077.
 */

const { curseforgeFetch } = require("../../curseforge.cjs");

const id = "curseforge";
const label = "CurseForge";

function supports(game) {
    return typeof game.providers?.curseforge === "number";
}

function normalize(mod) {
    return {
        provider: id,
        providerLabel: label,
        id: String(mod.id),
        name: mod.name,
        summary: mod.summary,
        author: (mod.authors ?? []).map(a => a.name).join(", "),
        downloads: mod.downloadCount ?? 0,
        icon: mod.logo?.url ?? null,
        url: mod.links?.websiteUrl ?? null,
        updated: mod.dateModified ?? null,
        // Whether Unity can install it directly. CurseForge lets authors
        // opt out of third-party downloads; those must be fetched manually.
        installable: mod.allowModDistribution !== false,
    };
}

async function search(game, query, { limit = 40 } = {}) {
    const gameId = game.providers.curseforge;

    const params = new URLSearchParams({
        gameId: String(gameId),
        searchFilter: query || "",
        pageSize: String(Math.min(limit, 50)),
        index: "0",
        sortField: "2",       // popularity
        sortOrder: "desc",
    });

    const res = await curseforgeFetch(`/mods/search?${params}`);

    if (!res.ok) {
        throw new Error(`CurseForge search failed (HTTP ${res.status}).`);
    }

    const json = await res.json();

    return (json.data ?? []).map(normalize);
}

// The downloadable files for one project, newest first.
async function getFiles(projectId) {
    const res = await curseforgeFetch(`/mods/${projectId}/files?pageSize=50`);

    if (!res.ok) {
        throw new Error(`Could not list files (HTTP ${res.status}).`);
    }

    const json = await res.json();

    return (json.data ?? []).map(f => ({
        id: String(f.id),
        name: f.displayName,
        fileName: f.fileName,
        size: f.fileLength ?? 0,
        date: f.fileDate,
        downloadUrl: f.downloadUrl,   // null when distribution is disabled
    }));
}

/*
 * Resolve the file to actually download. CurseForge returns
 * downloadUrl: null when the author disallows third-party downloads,
 * in which case the caller must send the user to the website.
 */
async function resolveDownload(projectId, fileId) {
    const files = await getFiles(projectId);

    const file = fileId
        ? files.find(f => f.id === String(fileId))
        : files[0];

    if (!file) throw new Error("No downloadable file found for this mod.");

    if (!file.downloadUrl) {
        const err = new Error(
            "This author has disabled third-party downloads. " +
            "Download it from the CurseForge site, then use Install from File."
        );
        err.code = "DISTRIBUTION_DENIED";
        throw err;
    }

    return file;
}

module.exports = {
    id,
    label,
    supports,
    search,
    getFiles,
    resolveDownload,
};
