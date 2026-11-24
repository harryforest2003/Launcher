const { getJson, plain } = require("./http.cjs");

/*
 * ficsit.app, Satisfactory's mod repository (the one Satisfactory Mod Manager uses). No key.
 * Mods go by their reference ("SML", "RefinedPower"), which is also how they name what
 * they need, so needs install the same way. A download is a .smod: a zip of one Unreal
 * plugin, which goes into FactoryGame/Mods/<reference>/.
 */

const API = "https://api.ficsit.app";
const SITE = "https://ficsit.app";
const LABEL = "ficsit.app";
const STEAM = "526870";

async function supports(game) {
    const steam = (game.steamAppIds ?? []).map(String);
    return steam.includes(STEAM) || plain(game.name) === "satisfactory" ? {} : null;
}

async function query(text, variables) {
    const json = await getJson(`${API}/v2/query`, {
        label: LABEL,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, variables }),
    });
    if (!json.data && json.errors?.length) throw new Error(`${LABEL}: ${json.errors[0].message}`);
    return json.data ?? {};
}

const SORTS = { popular: "popularity", downloads: "downloads", updated: "last_version_date", new: "created_at" };
const pageOf = (mod) => `${SITE}/mod/${encodeURIComponent(mod.mod_reference)}`;
const authorOf = (mod) => (mod.authors ?? []).find((a) => a.role === "creator")?.user?.username ?? mod.authors?.[0]?.user?.username ?? "";

function brief(mod) {
    return {
        provider: "ficsit",
        id: mod.mod_reference,
        name: mod.name,
        summary: mod.short_description ?? "",
        picture: mod.logo || null,
        author: authorOf(mod),
        downloads: mod.downloads ?? 0,
        endorsements: null,
        version: "",
        updated: mod.last_version_date ?? mod.updated_at ?? null,
        adult: false,
        url: pageOf(mod),
        installable: true,
    };
}

const FIELDS = "id mod_reference name short_description logo downloads updated_at last_version_date hidden authors { role user { username } }";

async function search(_ctx, { query: text = "", sort, page = 0, size = 24 }) {
    const limit = Math.min(50, size);
    const filter = { limit, offset: page * limit, order: "desc", order_by: text ? "search" : (SORTS[sort] ?? SORTS.popular) };
    if (text) filter.search = text;
    const data = await query(`query ($filter: ModFilter) { getMods(filter: $filter) { count mods { ${FIELDS} } } }`, { filter });
    const mods = (data.getMods?.mods ?? []).filter((mod) => !mod.hidden);
    return { total: data.getMods?.count ?? 0, mods: mods.map(brief), perPage: limit };
}

const VERSIONS = "versions(filter: { limit: 20, order: desc, order_by: created_at }) { id version size created_at game_version changelog targets { targetName link size } dependencies { mod_id optional } }";

async function modOf(reference) {
    const data = await query(`query ($ref: ModReference!) { getModByReference(modReference: $ref) { ${FIELDS} full_description ${VERSIONS} } }`, { ref: reference });
    if (!data.getModByReference) throw new Error(`ficsit.app has no mod called ${reference}.`);
    return data.getModByReference;
}

// The game itself: ficsit.app releases are for the Windows game (the Mac and Linux ones are servers).
const windowsOf = (version) => (version?.targets ?? []).find((target) => target.targetName === "Windows");

async function details(_ctx, modId) {
    const mod = await modOf(modId);
    const versions = (mod.versions ?? []).filter(windowsOf);
    return {
        ...brief(mod),
        version: versions[0]?.version ?? "",
        installable: versions.length > 0,
        html: "",
        markdown: mod.full_description || mod.short_description || "",
        images: [mod.logo].filter(Boolean),
        hasKey: true,
        premium: true,
        files: versions.map((version, i) => ({
            id: version.id,
            name: `${mod.name} ${version.version}`,
            version: version.version,
            category: i === 0 ? "Main" : "Older",
            size: windowsOf(version).size ?? version.size ?? 0,
            fileName: `${mod.mod_reference}.zip`,
            date: version.created_at ?? "",
            description: String(version.changelog ?? "").slice(0, 300),
        })),
    };
}

async function download(_ctx, modId, fileId) {
    const mod = await modOf(modId);
    const versions = (mod.versions ?? []).filter(windowsOf);
    const version = (fileId && versions.find((v) => v.id === String(fileId))) || versions[0];
    if (!version) throw new Error(`${mod.name} has no release for the game yet.`);
    return {
        url: `${API}${windowsOf(version).link}`,
        // A .smod is a zip; naming it one lets it be opened like any other.
        fileName: `${mod.mod_reference}.zip`,
        version: version.version,
        fileId: version.id,
        name: mod.name,
        page: pageOf(mod),
        requires: (version.dependencies ?? [])
            .filter((dep) => !dep.optional && dep.mod_id && dep.mod_id !== "FactoryGame")
            .map((dep) => ({ modId: dep.mod_id, name: dep.mod_id })),
    };
}

async function latest(_ctx, modId) {
    const version = ((await modOf(modId)).versions ?? []).find(windowsOf);
    return version ? { fileId: version.id, version: version.version, date: version.created_at ?? "", size: windowsOf(version).size ?? 0 } : null;
}

module.exports = { id: "ficsit", label: LABEL, site: `${SITE}/`, primary: true, supports, search, details, download, latest };
