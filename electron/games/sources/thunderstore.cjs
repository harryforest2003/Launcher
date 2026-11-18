const { getJson, remembered, plain } = require("./http.cjs");
const BY_STEAM = require("./thunderstoreSteam.json");

/*
 * Thunderstore: BepInEx and MelonLoader mods for Lethal Company, Valheim, Risk of Rain 2
 * and a few hundred other Unity games. No key; its packages are free to download. A mod's
 * id here is "Namespace-Name", as Thunderstore writes its dependencies.
 */

const SITE = "https://thunderstore.io";
const LABEL = "Thunderstore";
const DAY = 24 * 60 * 60 * 1000;

const ORDERING = { popular: "most-downloaded", downloads: "most-downloaded", updated: "last-updated", new: "newest", rated: "top-rated" };

/* Every community's name, for a game Thunderstore has under another Steam id or none. */
function communities() {
    return remembered("thunderstore:communities", DAY, async () => {
        const all = [];
        let url = `${SITE}/api/experimental/community/`;
        for (let i = 0; url && i < 10; i++) {
            const page = await getJson(url, { label: LABEL });
            all.push(...(page.results ?? []));
            url = page.pagination?.next_link ?? null;
        }
        return all;
    });
}

/* -> { community } for a game Thunderstore has, or null. */
async function supports(game) {
    for (const appId of game.steamAppIds ?? []) if (BY_STEAM[appId]) return { community: BY_STEAM[appId] };
    const wanted = plain(game.name);
    if (!wanted) return null;
    const found = (await communities()).find((c) => plain(c.name) === wanted || plain(c.identifier) === wanted);
    return found ? { community: found.identifier } : null;
}

const split = (modId) => {
    const at = String(modId).indexOf("-");
    if (at <= 0) throw new Error(`"${modId}" isn't a Thunderstore package.`);
    return { namespace: String(modId).slice(0, at), name: String(modId).slice(at + 1) };
};
const pageOf = (modId) => {
    const { namespace, name } = split(modId);
    return `${SITE}/package/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/`;
};

// Download counts from the listing, which the package's own details don't give.
const counts = new Map();

async function search(ctx, { query = "", sort, page = 0, adult = false }) {
    const params = new URLSearchParams({ ordering: ORDERING[sort] ?? "most-downloaded", page: String(page + 1) });
    if (query) params.set("q", query);
    if (adult) params.set("nsfw", "True");
    const json = await getJson(`${SITE}/api/cyberstorm/listing/${encodeURIComponent(ctx.community)}/?${params}`, { label: LABEL });
    const mods = (json.results ?? []).map((pkg) => {
        const id = `${pkg.namespace}-${pkg.name}`;
        counts.set(id, pkg.download_count ?? 0);
        if (counts.size > 2000) counts.delete(counts.keys().next().value);
        return {
            provider: "thunderstore",
            id,
            name: pkg.name.replace(/_/g, " "),
            summary: pkg.description ?? "",
            picture: pkg.icon_url ?? null,
            author: pkg.namespace,
            downloads: pkg.download_count ?? 0,
            endorsements: pkg.rating_count ?? null,
            version: "",
            updated: pkg.last_updated ?? null,
            adult: Boolean(pkg.is_nsfw),
            url: pageOf(id),
            installable: true,
        };
    });
    return { total: json.count ?? mods.length, mods, perPage: 20 };
}

function packageOf(modId) {
    const { namespace, name } = split(modId);
    return remembered(`thunderstore:package:${modId}`, 10 * 60 * 1000, () =>
        getJson(`${SITE}/api/experimental/package/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/`, { label: LABEL }),
    );
}

/* "Namespace-Name-1.2.3" -> "Namespace-Name". */
const dependencyId = (text) => String(text).replace(/-\d+\.\d+\.\d+$/, "");

async function details(_ctx, modId) {
    const pkg = await packageOf(modId);
    const latest = pkg.latest ?? {};
    let markdown = latest.description ?? "";
    try {
        const readme = await getJson(`${SITE}/api/experimental/package/${encodeURIComponent(pkg.namespace)}/${encodeURIComponent(pkg.name)}/${encodeURIComponent(latest.version_number)}/readme/`, { label: LABEL });
        if (readme.markdown) markdown = readme.markdown;
    } catch {
        // The short description stands in.
    }
    const needs = (latest.dependencies ?? []).map(dependencyId);
    return {
        id: modId,
        name: pkg.name.replace(/_/g, " "),
        summary: latest.description ?? "",
        picture: latest.icon ?? null,
        author: pkg.owner ?? pkg.namespace,
        downloads: counts.get(modId) ?? latest.downloads ?? 0,
        endorsements: pkg.rating_score >= 0 ? pkg.rating_score : null,
        version: latest.version_number ?? "",
        updated: pkg.date_updated ?? null,
        url: pkg.package_url ?? pageOf(modId),
        html: "",
        markdown,
        images: [],
        hasKey: true,
        premium: true,
        installable: true,
        files: latest.download_url
            ? [{
                  id: latest.version_number,
                  name: `${pkg.name} ${latest.version_number}`,
                  version: latest.version_number,
                  category: "Main",
                  size: 0,
                  fileName: `${latest.full_name}.zip`,
                  date: latest.date_created ?? pkg.date_updated ?? "",
                  description: needs.length ? `Needs ${needs.join(", ")}` : "",
              }]
            : [],
    };
}

/* Thunderstore keeps every version, but apps are only told about the newest. */
async function download(_ctx, modId) {
    const pkg = await packageOf(modId);
    const latest = pkg.latest;
    if (!latest?.download_url) throw new Error(`${modId} has nothing to download.`);
    return {
        url: latest.download_url,
        fileName: `${latest.full_name}.zip`,
        version: latest.version_number,
        fileId: latest.version_number,
        name: pkg.name.replace(/_/g, " "),
        requires: (latest.dependencies ?? []).map((text) => ({ modId: dependencyId(text), name: dependencyId(text).split("-").slice(1).join("-") })),
    };
}

async function latest(_ctx, modId) {
    const pkg = await packageOf(modId);
    return pkg.latest ? { fileId: pkg.latest.version_number, version: pkg.latest.version_number, date: pkg.latest.date_created, size: 0 } : null;
}

module.exports = { id: "thunderstore", label: LABEL, site: `${SITE}/`, primary: true, supports, search, details, download, latest };
