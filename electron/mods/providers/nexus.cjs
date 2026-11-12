/*
 * Nexus Mods provider.
 *
 * Two hard limits come from Nexus itself, not from this code:
 *
 *   1. The public API has NO keyword search endpoint. It exposes
 *      trending / latest_added / latest_updated / mod-by-id only.
 *      So "search" here filters a browse list client-side, and exact
 *      mod IDs (or a pasted mod URL) are the precise way in.
 *
 *   2. Download links require a PREMIUM account. Free accounts get
 *      403 from the download_link endpoint, and must download through
 *      the website and use Install from File.
 *
 * Everything needs a personal API key from
 * nexusmods.com -> Account Settings -> API Keys.
 */

const API = "https://api.nexusmods.com/v1";

const id = "nexus";
const label = "Nexus Mods";

let apiKey = null;

function setApiKey(key) {
    apiKey = key || null;
}

function hasApiKey() {
    return !!apiKey;
}

function headers() {
    if (!apiKey) {
        const err = new Error(
            "Nexus Mods needs an API key. Add one in Settings " +
            "(nexusmods.com -> Account Settings -> API Keys)."
        );
        err.code = "NO_API_KEY";
        throw err;
    }

    return {
        apikey: apiKey,
        Accept: "application/json",
        "User-Agent": "UnityLauncher/1.0",
    };
}

function supports(game) {
    return typeof game.providers?.nexus === "string";
}

function normalize(mod, domain) {
    return {
        provider: id,
        providerLabel: label,
        id: String(mod.mod_id),
        name: mod.name,
        summary: (mod.summary || "").replace(/<[^>]*>/g, ""),
        author: mod.author || mod.uploaded_by || "",
        downloads: mod.mod_downloads ?? 0,
        icon: mod.picture_url ?? null,
        url: `https://www.nexusmods.com/${domain}/mods/${mod.mod_id}`,
        updated: mod.updated_time ?? null,
        // Only premium accounts can pull a download link from the API.
        installable: false,
    };
}

async function get(endpoint) {
    const res = await fetch(`${API}${endpoint}`, { headers: headers() });

    if (res.status === 401) {
        throw new Error("Nexus rejected the API key (401). Check it in Settings.");
    }

    if (!res.ok) {
        throw new Error(`Nexus request failed (HTTP ${res.status}).`);
    }

    return res.json();
}

/*
 * Best-effort search: pull the browse lists and filter locally. This
 * cannot match Nexus's own site search — it only sees trending and
 * recent mods — so the UI tells the user as much.
 */
async function search(game, query, { limit = 40 } = {}) {
    const domain = game.providers.nexus;

    // Fail loudly here. The allSettled below would otherwise swallow the
    // missing-key error and return an empty list with no explanation.
    if (!apiKey) {
        const err = new Error(
            "Nexus Mods needs an API key. Add one in Settings " +
            "(nexusmods.com -> Account Settings -> API Keys)."
        );
        err.code = "NO_API_KEY";
        throw err;
    }

    const lists = await Promise.allSettled([
        get(`/games/${domain}/mods/trending.json`),
        get(`/games/${domain}/mods/latest_added.json`),
        get(`/games/${domain}/mods/latest_updated.json`),
    ]);

    // Every list failing means the key is bad or Nexus is down — surface
    // that rather than reporting "no results".
    if (lists.every(l => l.status === "rejected")) {
        throw lists[0].reason ?? new Error("Nexus Mods is unreachable.");
    }

    const seen = new Set();
    const mods = [];

    for (const result of lists) {
        if (result.status !== "fulfilled") continue;

        for (const mod of result.value ?? []) {
            if (!mod?.mod_id || seen.has(mod.mod_id)) continue;
            if (mod.available === false) continue;

            seen.add(mod.mod_id);
            mods.push(normalize(mod, domain));
        }
    }

    const q = (query || "").trim().toLowerCase();

    const filtered = q
        ? mods.filter(m =>
            m.name.toLowerCase().includes(q) ||
            m.summary.toLowerCase().includes(q)
        )
        : mods;

    return filtered.slice(0, limit);
}

// Exact lookup — the reliable path, since browse-and-filter is partial.
async function getMod(game, modId) {
    const domain = game.providers.nexus;
    const mod = await get(`/games/${domain}/mods/${modId}.json`);

    return normalize(mod, domain);
}

async function getFiles(game, modId) {
    const domain = game.providers.nexus;
    const json = await get(`/games/${domain}/mods/${modId}/files.json`);

    return (json.files ?? []).map(f => ({
        id: String(f.file_id),
        name: f.name,
        fileName: f.file_name,
        size: (f.size_kb ?? 0) * 1024,
        date: f.uploaded_time,
        downloadUrl: null,   // resolved separately, premium only
    }));
}

/*
 * Premium-only. Free accounts get 403 here; the caller should fall back
 * to opening the website.
 */
async function resolveDownload(game, modId, fileId) {
    const domain = game.providers.nexus;

    const res = await fetch(
        `${API}/games/${domain}/mods/${modId}/files/${fileId}/download_link.json`,
        { headers: headers() }
    );

    if (res.status === 403) {
        const err = new Error(
            "Nexus only issues API download links to Premium accounts. " +
            "Download the file from the website, then use Install from File."
        );
        err.code = "PREMIUM_REQUIRED";
        throw err;
    }

    if (!res.ok) {
        throw new Error(`Could not get a download link (HTTP ${res.status}).`);
    }

    const links = await res.json();

    if (!links?.length) throw new Error("Nexus returned no download link.");

    return { downloadUrl: links[0].URI };
}

// Accepts https://www.nexusmods.com/<domain>/mods/<id>
function parseModUrl(url) {
    const m = String(url).match(
        /nexusmods\.com\/([a-z0-9]+)\/mods\/(\d+)/i
    );

    return m ? { domain: m[1], modId: m[2] } : null;
}

module.exports = {
    apiHeaders: headers,
    id,
    label,
    supports,
    search,
    getMod,
    getFiles,
    resolveDownload,
    setApiKey,
    hasApiKey,
    parseModUrl,
};
