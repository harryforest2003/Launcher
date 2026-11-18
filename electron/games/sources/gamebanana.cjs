const { getJson, remembered, plain } = require("./http.cjs");

/*
 * GameBanana: skins, sounds and maps for thousands of games, many no other site has.
 * No key. Its record counts can be short of the real number, so paging goes on while
 * a page comes back full.
 */

const API = "https://gamebanana.com/apiv11";
const LABEL = "GameBanana";
const DAY = 24 * 60 * 60 * 1000;

const SORTS = { popular: "Generic_MostDownloaded", downloads: "Generic_MostDownloaded", updated: "Generic_LatestModified", new: "Generic_Newest", rated: "Generic_MostLiked" };

/* -> { gameId } for a game GameBanana has, matched by its name. */
async function supports(game) {
    const wanted = plain(game.name);
    if (!wanted) return null;
    return remembered(`gamebanana:game:${wanted}`, DAY, async () => {
        const json = await getJson(`${API}/Util/Game/NameMatch?${new URLSearchParams({ _sName: game.name })}`, { label: LABEL });
        const found = (json._aRecords ?? []).find((g) => plain(g._sName) === wanted);
        return found ? { gameId: found._idRow } : null;
    });
}

function picture(media, size = "_sFile220") {
    const image = media?._aImages?.[0];
    return image ? `${image._sBaseUrl}/${image[size] ?? image._sFile}` : null;
}

const iso = (seconds) => (seconds ? new Date(seconds * 1000).toISOString() : null);

function brief(record) {
    return {
        provider: "gamebanana",
        id: String(record._idRow),
        name: record._sName,
        summary: record._aRootCategory?._sName ?? "",
        picture: picture(record._aPreviewMedia),
        author: record._aSubmitter?._sName ?? "",
        downloads: record._nDownloadCount ?? 0,
        endorsements: record._nLikeCount ?? null,
        version: record._sVersion ?? "",
        updated: iso(record._tsDateModified ?? record._tsDateAdded),
        adult: Boolean(record._bHasContentRatings),
        url: record._sProfileUrl ?? `https://gamebanana.com/mods/${record._idRow}`,
        installable: record._bHasFiles !== false,
    };
}

async function search(ctx, { query = "", sort, page = 0, size = 24, adult = false }) {
    let json;
    if (query) {
        // Search answers 15 at a time, whatever's asked for.
        json = await getJson(`${API}/Util/Search/Results?${new URLSearchParams({ _sModelName: "Mod", _sOrder: "best_match", _idGameRow: String(ctx.gameId), _sSearchString: query, _nPage: String(page + 1) })}`, { label: LABEL });
        size = 15;
    } else {
        const params = new URLSearchParams({ _nPage: String(page + 1), _nPerpage: String(size), "_aFilters[Generic_Game]": String(ctx.gameId) });
        if (SORTS[sort]) params.set("_sSort", SORTS[sort]);
        json = await getJson(`${API}/Mod/Index?${params}`, { label: LABEL });
    }
    const records = (json._aRecords ?? []).filter((record) => record._sModelName === "Mod" && (adult || !record._bHasContentRatings));
    const counted = json._aMetadata?._nRecordCount ?? 0;
    // Short counts: at least one more page while this one's full and it says there's more.
    const more = json._aMetadata?._bIsComplete === false && (json._aRecords ?? []).length >= size;
    return { total: Math.max(counted, page * size + records.length + (more ? 1 : 0)), mods: records.map(brief), perPage: size };
}

function profile(modId) {
    return remembered(`gamebanana:mod:${modId}`, 10 * 60 * 1000, () => getJson(`${API}/Mod/${encodeURIComponent(modId)}/ProfilePage`, { label: LABEL }));
}

async function details(_ctx, modId) {
    const mod = await profile(modId);
    const images = (mod._aPreviewMedia?._aImages ?? []).map((image) => `${image._sBaseUrl}/${image._sFile}`);
    const files = mod._aFiles ?? [];
    return {
        ...brief(mod),
        summary: mod._sDescription || brief(mod).summary,
        picture: picture(mod._aPreviewMedia, "_sFile530"),
        downloads: mod._nDownloadCount ?? 0,
        html: mod._sText || mod._sDescription || "",
        images: images.slice(0, 12),
        hasKey: true,
        premium: true,
        installable: files.length > 0,
        files: files.map((file, i) => ({
            id: String(file._idRow),
            name: file._sFile,
            version: file._sVersion ?? "",
            category: i === 0 ? "Main" : "File",
            size: file._nFilesize ?? 0,
            fileName: file._sFile,
            date: iso(file._tsDateAdded) ?? "",
            description: file._sDescription ?? "",
        })),
    };
}

async function download(_ctx, modId, fileId) {
    const mod = await profile(modId);
    const files = mod._aFiles ?? [];
    const file = (fileId && files.find((f) => String(f._idRow) === String(fileId))) || files[0];
    if (!file) {
        const err = new Error(`${mod._sName} has no files to download.`);
        err.code = "WEBSITE_ONLY";
        err.page = mod._sProfileUrl;
        throw err;
    }
    // GameBanana checks every upload for viruses; a file that failed isn't fetched.
    if (file._sAvResult && !["clean", "pending"].includes(String(file._sAvResult).toLowerCase())) {
        throw new Error(`GameBanana's virus check flagged ${file._sFile}, so the launcher won't install it.`);
    }
    return {
        url: file._sDownloadUrl,
        fileName: file._sFile,
        md5: file._sMd5Checksum || null,
        version: file._sVersion || mod._sVersion || "",
        fileId: String(file._idRow),
        name: mod._sName,
        page: mod._sProfileUrl,
        requires: [],
    };
}

async function latest(_ctx, modId) {
    const mod = await getJson(`${API}/Mod/${encodeURIComponent(modId)}/ProfilePage`, { label: LABEL });
    const file = [...(mod._aFiles ?? [])].sort((a, b) => (b._tsDateAdded ?? 0) - (a._tsDateAdded ?? 0))[0];
    return file ? { fileId: String(file._idRow), version: file._sVersion || mod._sVersion || file._sFile, date: iso(file._tsDateAdded), size: file._nFilesize ?? 0 } : null;
}

module.exports = { id: "gamebanana", label: LABEL, site: "https://gamebanana.com/", primary: false, supports, search, details, download, latest };
