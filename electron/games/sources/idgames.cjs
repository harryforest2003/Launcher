const { getJson, remembered, plain, textHtml } = require("./http.cjs");

/*
 * The idgames archive (doomworld.com/idgames): Doom's mod archive since 1994, with over
 * 20,000 maps and add-ons. No key. Its API searches by title; an empty search shows the
 * megawads. Files come from youfailit.net, one of the archive's own mirrors. Only the
 * original Doom games: Doom (2016) and Doom Eternal are other games.
 */

const API = "https://www.doomworld.com/idgames/api/api.php";
const MIRROR = "https://youfailit.net/pub/idgames/";
const SITE = "https://www.doomworld.com/idgames/";
const LABEL = "idgames";
const PER_PAGE = 25;
const DAY = 24 * 60 * 60 * 1000;

// The Ultimate Doom, Doom II and Final Doom on Steam (the 2024 re-release keeps 2280).
const STEAM = ["2280", "2300", "2290"];
const NAMES = ["doom", "doomii", "doom2", "ultimatedoom", "theultimatedoom", "finaldoom", "doomdoomii", "gzdoom", "masterlevelsfordoomii"];

async function supports(game) {
    const steam = (game.steamAppIds ?? []).map(String);
    return steam.some((id) => STEAM.includes(id)) || NAMES.includes(plain(game.name)) ? {} : null;
}

// Heretic, Hexen and Strife share the archive; their files would only break Doom.
const FOR_DOOM = /^(levels\/doom2?\/|themes\/|combos\/|graphics\/|music\/|sounds\/)/i;
const OTHER_GAMES = /heretic|hexen|strife/i;
const forDoom = (file) => FOR_DOOM.test(file.dir ?? "") && !OTHER_GAMES.test(file.dir ?? "");

const call = (params) =>
    getJson(`${API}?${new URLSearchParams({ ...params, out: "json" })}`, { label: LABEL }).then((json) => {
        if (json.error) throw new Error(json.error.message || "The idgames archive couldn't answer.");
        return json.content ?? {};
    });
// One file comes as an object, more as a list.
const filesIn = (content) => [content?.file ?? []].flat().filter(Boolean);

const pageOf = (file) => file.url || `${SITE}${String(file.dir ?? "")}${String(file.filename ?? "").replace(/\.zip$/i, "")}`;
// Authors' text files often hold their e-mail address; that stays on the archive.
const noEmails = (text) => String(text ?? "").replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "(e-mail on the archive)");

function brief(file) {
    return {
        provider: "idgames",
        id: String(file.id),
        name: file.title || file.filename,
        summary: noEmails(String(file.description ?? "").replace(/<br\s*\/?>/gi, " ").replace(/&#?\w+;/g, " ")).slice(0, 240).trim(),
        picture: null,
        author: noEmails(file.author ?? ""),
        downloads: 0,
        endorsements: file.votes ?? null,
        version: "",
        updated: file.date ?? null,
        adult: false,
        url: pageOf(file),
        installable: Boolean(file.filename),
    };
}

// Without a search the archive can only list folders, so an empty search shows its megawads.
const MEGAWADS = ["levels/doom/megawads/", "levels/doom/Ports/megawads/", "levels/doom2/megawads/", "levels/doom2/Ports/megawads/"];

function megawads() {
    return remembered("idgames:megawads", DAY, async () => {
        const lists = await Promise.all(MEGAWADS.map((name) => call({ action: "getcontents", name }).then(filesIn).catch(() => [])));
        return lists.flat();
    });
}

const SORTS = { popular: "rating", downloads: "rating", updated: "date", new: "date" };
const score = (file) => Number(file.rating ?? 0) * Math.log10(1 + Number(file.votes ?? 0));

async function search(_ctx, { query = "", sort, page = 0 }) {
    let list;
    const order = SORTS[sort] ?? SORTS.popular;
    if (query.trim().length >= 3) {
        list = await remembered(`idgames:${order}:${query.toLowerCase()}`, 10 * 60 * 1000, async () =>
            filesIn(await call({ action: "search", query: query.trim(), type: "title", sort: order, dir: "desc" })).filter(forDoom),
        );
    } else if (query.trim()) {
        // The archive needs three letters to search.
        list = [];
    } else {
        list = [...(await megawads())].sort(order === "date" ? (a, b) => String(b.date).localeCompare(String(a.date)) : (a, b) => score(b) - score(a));
    }
    return { total: list.length, mods: list.slice(page * PER_PAGE, (page + 1) * PER_PAGE).map(brief), perPage: PER_PAGE };
}

const fileOf = (id) => call({ action: "get", id: String(id) });

async function details(_ctx, modId) {
    const file = await fileOf(modId);
    const text = noEmails(file.textfile ?? file.description ?? "");
    return {
        ...brief(file),
        html: textHtml(text),
        images: [],
        hasKey: true,
        premium: true,
        files: file.filename
            ? [{ id: String(file.id), name: file.filename, version: "", category: "Main", size: file.size ?? 0, fileName: file.filename, date: file.date ?? "", description: "" }]
            : [],
    };
}

async function download(_ctx, modId) {
    const file = await fileOf(modId);
    if (!file.filename) throw new Error("That idgames entry has no file.");
    return {
        url: `${MIRROR}${file.dir}${file.filename}`,
        fileName: file.filename,
        version: file.date ?? "",
        fileId: String(file.id),
        name: file.title || file.filename,
        page: pageOf(file),
        requires: [],
    };
}

// An archive entry never changes: a new version is a new entry.
async function latest(_ctx, modId) {
    const file = await fileOf(modId);
    return { fileId: String(file.id), version: file.date ?? "", date: file.date ?? "", size: file.size ?? 0 };
}

module.exports = { id: "idgames", label: LABEL, site: SITE, primary: true, supports, search, details, download, latest };
