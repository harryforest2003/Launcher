const fs = require("fs");
const path = require("path");
const { readSettings, writeSettings, dataDir } = require("./storage.cjs");
const modsRegistry = require("../mods/gameRegistry.cjs");
const { steamLibraries, epicInstalls } = require("../mods/gameDetector.cjs");
const wheretoget = require("./wheretoget.cjs");

/*
 * Every other game: the ones More Games knows (Hytale, Red Dead Redemption 2, Elden Ring...)
 * and any game added from Steam, Nexus Mods or CurseForge. Each runs in the same workspace
 * as The Sims 4 (Home, Mods, Discover, Settings and Play) with one set of install rules:
 * a mod's files go into the game's mods folder, which Settings can point anywhere.
 *
 * Added games are kept in game-mods/settings.json under customGames, with the mods folder
 * (modsDirs), how it starts (launchExes) and its picture (art) beside the other settings.
 */

// Games with install rules of their own (registry.cjs).
const OWN = new Set(["sims4", "gtav", "skyrimse", "fallout4", "cyberpunk2077", "stardew"]);

// Nexus Mods game numbers, checked against its API.
const NEXUS_IDS = {
    reddeadredemption2: 3024, reddeadredemption: 5175, eldenring: 4333, witcher3: 952, newvegas: 130,
    starfield: 4187, oblivionremastered: 7587, hogwartslegacy: 5113, kingdomcomedeliverance2: 7286,
    mountandblade2bannerlord: 3174, satisfactory: 2904, eurotrucksimulator2: 328, thesims3: 301,
    hollowknightsilksong: 8136, blackmythwukong: 6713, lethalcompany: 5848, subnautica: 1155, schedule1: 7381,
    kenshi: 736, monsterhunterwilds: 6993, hytale: 8638, gta5: 893, baldursgate3: 3474, valheim: 3667,
    rimworld: 424, terraria: 549, thesims4: 641, skyrimspecialedition: 1704, fallout4: 1151,
    cyberpunk2077: 3333, stardewvalley: 1303,
};

// More Games entries Nexus also lists, where the catalog doesn't say so.
const EXTRA_NEXUS = { valheim: "valheim", rimworld: "rimworld", terraria: "terraria" };

// CurseForge's games with mods for PC, checked through the launcher's CurseForge access
// (it can't list CurseForge's games itself).
const CURSEFORGE_GAMES = [
    { id: 1, name: "World of Warcraft" },
    { id: 455, name: "The Elder Scrolls Online" },
    { id: 540, name: "7 Days to Die" },
    { id: 669, name: "Stardew Valley" },
    { id: 4401, name: "Kerbal Space Program" },
    { id: 4593, name: "Final Fantasy XV" },
    { id: 70216, name: "Hytale" },
    { id: 78062, name: "The Sims 4" },
    { id: 83374, name: "ARK: Survival Ascended" },
    { id: 85196, name: "Palworld" },
];

const COLOURS = ["#38bdf8", "#a78bfa", "#f472b6", "#fb923c", "#34d399", "#facc15", "#60a5fa", "#f87171", "#2dd4bf", "#c084fc"];
const colourFor = (id) => COLOURS[[...String(id)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % COLOURS.length];

const norm = (name) =>
    String(name ?? "")
        .toLowerCase()
        .replace(/[™®©]/g, "")
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

// One spelling of a name for matching across Steam, Nexus Mods and CurseForge ("DARK SOULS III"
// is Nexus Mods' "Dark Souls 3").
const ROMAN = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 };
const keyFor = (name) =>
    norm(name)
        .replace(/^the /, "")
        .replace(/\b(ii|iii|iv|v|vi|vii|viii|ix)\b/g, (numeral) => ROMAN[numeral]);
const slug = (name) => norm(name).replace(/ /g, "-").slice(0, 40) || "game";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const UA = { "User-Agent": "UnityLauncher/1.0" };

async function getJson(url, init = {}) {
    const res = await fetch(url, { ...init, headers: { ...UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}.`);
    return res.json();
}

/* ---------------- the games ---------------- */

function taglineOf(def) {
    const sites = [def.nexus && "Nexus Mods", def.curseforge && "CurseForge"].filter(Boolean);
    return sites.length ? `Mods from ${sites.join(" and ")}` : "Mods from your own files";
}

/*
 * A workspace game from a More Games entry, one found on this computer or one opened from
 * the search. Whatever Nexus Mods and CurseForge list under the same name is folded in, so
 * a Steam game's Discover has both sites' mods.
 */
function define(entry) {
    const site = sites();
    const key = keyFor(entry.name);
    const onNexus = entry.nexus ? site.nexusByDomain.get(entry.nexus) : site.nexusByKey.get(key);
    const nexus = entry.nexus ?? onNexus?.domain ?? null;
    const def = {
        id: entry.id,
        name: entry.name,
        layout: "generic",
        generic: true,
        custom: Boolean(entry.custom),
        detected: Boolean(entry.detected),
        visiting: Boolean(entry.visiting),
        colour: entry.colour ?? colourFor(entry.id),
        nexus,
        nexusGameId: entry.nexusGameId ?? NEXUS_IDS[nexus] ?? onNexus?.id ?? null,
        curseforge: entry.curseforge ?? site.cfByKey.get(key)?.id ?? null,
        steamAppIds: entry.steamAppId ? [String(entry.steamAppId)] : [],
        steamFolders: [],
        modDirSpec: entry.modDir ?? null,
        modExtensions: entry.modExtensions ?? [],
        probes: entry.probes ?? null,
        windowsOnly: Boolean(entry.windowsOnly),
        notOnPC: entry.notOnPC ?? null,
        art: entry.art ?? null,
        launch: {},
    };
    def.tagline = entry.tagline ?? taglineOf(def);
    // Bethesda's games keep a plugin load order: the Load Order page and where plugins go.
    const kin = require("./modorder.cjs").bethesdaFor(def, keyFor);
    if (kin) {
        def.bethesda = kin;
        def.layout = "bethesda";
    }
    return def;
}

function catalogDefs() {
    return modsRegistry.GAMES.filter((g) => !g.managedByInstances && !OWN.has(g.id)).map((g) =>
        define({
            id: g.id,
            name: g.name,
            nexus: g.providers?.nexus ?? EXTRA_NEXUS[g.id] ?? null,
            curseforge: g.providers?.curseforge ?? null,
            steamAppId: g.steamAppId ?? null,
            modDir: g.modDir,
            modExtensions: g.modExtensions,
            probes: g.probes ?? null,
            windowsOnly: g.windowsOnly,
            notOnPC: g.notOnPC,
        })
    );
}

const added = () => (Array.isArray(readSettings().customGames) ? readSettings().customGames : []);

// Steam installs that aren't games to mod.
const NOT_GAMES = /^(steamworks common redistributables|steam linux runtime|proton|steamvr)|\b(soundtrack|ost|dedicated server|sdk|artbook|benchmark|redistributables?)\b/i;

let epicCache = { at: 0, list: [] };
const epicApps = () => {
    if (Date.now() - epicCache.at >= 5000) epicCache = { at: Date.now(), list: epicInstalls() };
    return epicCache.list;
};

// The games with install rules of their own (registry.cjs, which reads this file lazily too).
const ownGames = () => require("./registry.cjs").GAMES;

/*
 * Every game Steam or the Epic Games Launcher installed that has no page yet gets one, built
 * from what's on this computer each time the list is read: nothing is stored for it, so its
 * page goes when the game does.
 */
function detectedDefs(listed) {
    const taken = [...ownGames(), ...modsRegistry.GAMES, ...listed];
    const appIds = new Set(taken.flatMap((g) => [...(g.steamAppIds ?? []), g.steamAppId].filter(Boolean).map(String)));
    const names = new Set(taken.map((g) => keyFor(g.name)));
    const found = [];
    for (const [appId, app] of steamApps()) {
        if (!app.name || appIds.has(appId) || names.has(keyFor(app.name)) || NOT_GAMES.test(app.name)) continue;
        names.add(keyFor(app.name));
        found.push(define({ id: `steam-${appId}`, name: cleanName(app.name), steamAppId: appId, detected: true }));
    }
    for (const install of epicApps()) {
        if (names.has(keyFor(install.name))) continue;
        names.add(keyFor(install.name));
        found.push(define({ id: `epic-${slug(install.name)}`, name: install.name, probes: { [process.platform]: [install.installPath] }, detected: true }));
    }
    return found;
}

/* More Games' games, the ones kept, then the ones found on this computer. */
function all() {
    const catalog = catalogDefs();
    const ids = new Set(catalog.map((g) => g.id));
    const listed = [...catalog, ...added().filter((g) => g?.id && !ids.has(g.id)).map((g) => define({ ...g, custom: true }))];
    return [...listed, ...detectedDefs(listed)];
}

/* The game that's already here for a search result, if any. */
function existing(entry, games = all(), own = []) {
    const steam = entry.steamAppId ? String(entry.steamAppId) : null;
    const name = keyFor(entry.name);
    return (
        [...own, ...games].find(
            (g) =>
                (steam && (g.steamAppIds ?? []).includes(steam)) ||
                (entry.nexus && g.nexus === entry.nexus) ||
                (entry.curseforge && g.curseforge === entry.curseforge) ||
                keyFor(g.name) === name
        ) ?? null
    );
}

/* ---------------- any game, without adding it ---------------- */

const seenFile = () => path.join(dataDir(), "seen-games.json");

function seen() {
    try {
        const list = JSON.parse(fs.readFileSync(seenFile(), "utf8"));
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function cleanEntry(entry) {
    const name = String(entry?.name ?? "").trim().slice(0, 120);
    if (!name) throw new Error("The game needs a name.");
    return {
        name,
        steamAppId: /^\d{1,10}$/.test(String(entry.steamAppId ?? "")) ? String(entry.steamAppId) : null,
        nexus: /^[a-z0-9]{1,60}$/.test(String(entry.nexus ?? "")) ? String(entry.nexus) : null,
        nexusGameId: Number.isInteger(entry.nexusGameId) ? entry.nexusGameId : null,
        curseforge: Number.isInteger(entry.curseforge) ? entry.curseforge : null,
        art: /^https:\/\//.test(String(entry.art ?? "")) ? String(entry.art).slice(0, 400) : null,
    };
}

const idFor = (clean) =>
    clean.steamAppId ? `steam-${clean.steamAppId}` : clean.nexus ? `nexus-${clean.nexus}` : clean.curseforge ? `curseforge-${clean.curseforge}` : `custom-${slug(clean.name)}`;

/*
 * Opens any game from the search: the page that's already here, else one built for it on the
 * spot. Nothing is added to the launcher; the page is remembered (seen-games.json, the last
 * 200) so it opens again, and it's kept once its mods folder, game folder or what starts it is
 * chosen. -> its id
 */
function open(entry, own = []) {
    const clean = cleanEntry(entry);
    const already = existing(clean, all(), own);
    if (already) return already.id;
    const id = idFor(clean);
    const rest = seen().filter((g) => g.id !== id);
    fs.writeFileSync(seenFile(), JSON.stringify([{ id, ...clean, at: Date.now() }, ...rest].slice(0, 200)));
    return id;
}

/* A game opened from the search but not kept: as it was seen, else from its mod site's list. */
function visiting(id) {
    const entry = seen().find((g) => g.id === id);
    if (entry) return define({ ...entry, visiting: true });
    const site = sites();
    const onNexus = site.nexusByDomain.get(id.match(/^nexus-([a-z0-9]+)$/)?.[1]);
    if (onNexus) return define({ id, name: onNexus.name, nexus: onNexus.domain, nexusGameId: onNexus.id, visiting: true });
    const onCurseforge = site.cfById.get(Number(id.match(/^curseforge-(\d+)$/)?.[1]));
    if (onCurseforge) return define({ id, name: onCurseforge.name, curseforge: onCurseforge.id, visiting: true });
    return null;
}

const find = (id) => all().find((g) => g.id === id) ?? visiting(String(id));

/* Keeps a game opened from the search on the launcher, once something is chosen for it. */
function keep(id) {
    if (all().some((g) => g.id === id)) return;
    const game = visiting(id);
    if (!game) return;
    const art = seen().find((g) => g.id === id)?.art ?? null;
    const settings = readSettings();
    settings.customGames = [
        ...(settings.customGames ?? []).filter((g) => g.id !== id),
        { id, name: game.name, steamAppId: game.steamAppIds[0] ?? null, nexus: game.nexus, nexusGameId: game.nexusGameId, curseforge: game.curseforge, art, addedAt: new Date().toISOString() },
    ];
    writeSettings(settings);
}

/* Takes a kept game off the launcher. Its mods stay where they are. */
function remove(id) {
    const settings = readSettings();
    if (!(settings.customGames ?? []).some((g) => g.id === id)) throw new Error("Only games you kept can be taken off.");
    settings.customGames = settings.customGames.filter((g) => g.id !== id);
    for (const key of ["gameDirs", "modsDirs", "launchExes"]) if (settings[key]) delete settings[key][id];
    writeSettings(settings);
}

/* ---------------- where it is ---------------- */

let steamCache = { at: 0, apps: new Map() };

/* Every Steam game on this computer: appid -> { name, dir }. Read again after a few seconds. */
function steamApps() {
    if (Date.now() - steamCache.at < 5000) return steamCache.apps;
    const apps = new Map();
    for (const lib of steamLibraries()) {
        let entries = [];
        try {
            entries = fs.readdirSync(lib);
        } catch {
            continue;
        }
        for (const entry of entries) {
            const id = entry.match(/^appmanifest_(\d+)\.acf$/)?.[1];
            if (!id || apps.has(id)) continue;
            try {
                const text = fs.readFileSync(path.join(lib, entry), "utf8");
                const dir = text.match(/"installdir"\s+"([^"]+)"/)?.[1];
                const name = text.match(/"name"\s+"([^"]+)"/)?.[1] ?? null;
                const full = dir ? path.join(lib, "common", dir) : null;
                if (full && fs.existsSync(full)) apps.set(id, { name, dir: full });
            } catch {
                // A manifest Steam is still writing.
            }
        }
    }
    steamCache = { at: Date.now(), apps };
    return apps;
}

/* The mods folder from More Games' rules: next to the game, or a fixed place (Documents...). */
function defaultModsDir(def, gameDir) {
    const spec = def.modDirSpec;
    if (!spec) return null;
    if (spec.relative) return gameDir ? path.join(gameDir, ...spec.relative) : null;
    const options = spec[process.platform] ?? [];
    return options.find((dir) => fs.existsSync(dir)) ?? options[0] ?? null;
}

/*
 * Where it is. -> { id, found, gameDir, source, chosen, docsDir, modsDir, modsChosen, launchChosen }
 * It counts as on this computer once its folder, how it starts or its mods folder is known.
 */
function locate(def) {
    const settings = readSettings();
    const chosen = settings.gameDirs?.[def.id] ?? null;
    let gameDir = null;
    let source = null;
    if (chosen && fs.existsSync(chosen)) {
        gameDir = chosen;
        source = "Chosen";
    } else {
        const steam = def.steamAppIds.map((id) => steamApps().get(id)).find(Boolean);
        if (steam) {
            gameDir = steam.dir;
            source = "Steam";
        } else {
            const probe = (def.probes?.[process.platform] ?? []).find((dir) => fs.existsSync(dir));
            const epic = probe ? null : epicInstalls().find((install) => norm(install.name) === norm(def.name));
            if (probe || epic) {
                gameDir = probe ?? epic.installPath;
                source = probe ? "Installed" : "Epic";
            }
        }
    }
    const modsChosen = settings.modsDirs?.[def.id] ?? null;
    const modsDir = modsChosen ?? defaultModsDir(def, gameDir);
    const exe = settings.launchExes?.[def.id] ?? null;
    const launchChosen = Boolean(exe && fs.existsSync(exe));
    // A game kept outside its own folder (Hytale's mods are in Application Support).
    const fixedMods = Boolean(!def.modDirSpec?.relative && def.modDirSpec && modsDir && fs.existsSync(modsDir));
    const found = !def.notOnPC && Boolean(gameDir || launchChosen || (modsChosen && fs.existsSync(modsChosen)) || fixedMods);
    if (!source && found) source = launchChosen ? "Chosen" : "Mods folder";
    return {
        id: def.id,
        found,
        gameDir,
        source,
        chosen: Boolean(chosen),
        chosenMissing: Boolean(chosen && !gameDir),
        docsDir: null,
        modsDir,
        modsChosen: Boolean(modsChosen),
        launchExe: exe,
        launchChosen,
    };
}

function setPath(key, id, value) {
    if (value !== null) keep(id);
    const settings = readSettings();
    settings[key] ??= {};
    if (value === null) delete settings[key][id];
    else settings[key][id] = value;
    writeSettings(settings);
}

const chooseModsDir = (id, dir) => setPath("modsDirs", id, dir);
const chooseLaunch = (id, file) => setPath("launchExes", id, file);

/* ---------------- finding games to add ---------------- */

const nexusCacheFile = () => path.join(dataDir(), "nexus-games-all.json");
const curseforgeCacheFile = () => path.join(dataDir(), "curseforge-games.json");
const WEEK = 7 * 24 * 60 * 60 * 1000;

function readCache(file) {
    try {
        const cached = JSON.parse(fs.readFileSync(file, "utf8"));
        if (Date.now() - cached.at < WEEK && cached.games?.length) return cached.games;
    } catch {
        // Not fetched yet.
    }
    return null;
}

const nexusQuery = (query, variables) =>
    getJson("https://api.nexusmods.com/v2/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
    });

/*
 * Every game on Nexus Mods with a mod (about 5,900 listed), most modded first. Its search
 * only matches whole names, so the list is kept a week and searched here. Asked 80 at a
 * time (more is over its limit), ten at once.
 */
let nexusLoading = null;
function nexusGames() {
    const cached = readCache(nexusCacheFile());
    if (cached) return Promise.resolve(cached);
    nexusLoading ??= (async () => {
        const first = await nexusQuery("{ games(count: 1) { totalCount } }");
        const total = Math.min(Number(first?.data?.games?.totalCount) || 800, 20000);
        const offsets = Array.from({ length: Math.ceil(total / 80) }, (_, i) => i * 80);
        const nodes = [];
        for (let i = 0; i < offsets.length; i += 10) {
            const pages = await Promise.all(
                offsets.slice(i, i + 10).map((offset) =>
                    nexusQuery(`{ games(count: 80, offset: ${offset}, sort: [{ mods: { direction: DESC } }]) { nodes { id name domainName modCount } } }`)
                        .then((json) => json?.data?.games?.nodes ?? [])
                        .catch(() => [])
                )
            );
            nodes.push(...pages.flat());
        }
        const seen = new Set();
        const games = nodes
            .filter((g) => g?.domainName && g.modCount > 0 && !seen.has(g.domainName) && seen.add(g.domainName))
            .map((g) => ({ id: g.id, name: g.name, domain: g.domainName, mods: g.modCount }))
            .sort((a, b) => b.mods - a.mods);
        if (!games.length) throw new Error("Nexus Mods sent no games.");
        fs.writeFileSync(nexusCacheFile(), JSON.stringify({ at: Date.now(), games }));
        return games;
    })().finally(() => {
        nexusLoading = null;
    });
    return nexusLoading;
}

/* A game Nexus lists under exactly this name, in case the list above is out of date. */
async function nexusExact(name) {
    const json = await nexusQuery("query($n: String!) { games(filter: { name: { value: $n, op: EQUALS } }, count: 3) { nodes { id name domainName modCount } } }", { n: name });
    return (json?.data?.games?.nodes ?? []).map((g) => ({ id: g.id, name: g.name, domain: g.domainName, mods: g.modCount }));
}

/*
 * The games CurseForge hosts mods for, from its API (through the launcher's proxy, or a key
 * on this computer), kept a week. Without either, the ones listed above.
 */
async function curseforgeGames() {
    const cached = readCache(curseforgeCacheFile());
    if (cached) return cached;
    try {
        const { curseforgeJson } = require("../curseforge.cjs");
        const games = [];
        for (let index = 0; index < 2000; index += 50) {
            const json = await curseforgeJson(`/games?index=${index}&pageSize=50`);
            games.push(...(json?.data ?? []).filter((g) => g?.id !== 432 && g?.name).map((g) => ({ id: g.id, name: g.name, slug: g.slug ?? null })));
            if ((json?.data?.length ?? 0) < 50) break;
        }
        if (games.length) {
            fs.writeFileSync(curseforgeCacheFile(), JSON.stringify({ at: Date.now(), games }));
            return games;
        }
    } catch {
        // The proxy doesn't pass this on yet, or CurseForge is unreachable.
    }
    return CURSEFORGE_GAMES;
}

/*
 * Nexus Mods' and CurseForge's game lists by name, as last fetched however old (read again
 * when either file changes). In the app, a list that's missing or a week old is fetched in
 * the background the first time it's wanted.
 */
let siteIndex = { stamp: null, value: null };
let warmed = false;
function sites() {
    if (!warmed && process.versions.electron) {
        warmed = true;
        nexusGames().catch(() => {});
        curseforgeGames().catch(() => {});
    }
    const files = [nexusCacheFile(), curseforgeCacheFile()];
    const stamp = files
        .map((file) => {
            try {
                return fs.statSync(file).mtimeMs;
            } catch {
                return 0;
            }
        })
        .join("|");
    if (siteIndex.stamp === stamp) return siteIndex.value;
    const [nexusAll, cfRead] = files.map((file) => {
        try {
            return JSON.parse(fs.readFileSync(file, "utf8")).games ?? [];
        } catch {
            return [];
        }
    });
    const cfAll = cfRead.length ? cfRead : CURSEFORGE_GAMES;
    const byFirst = (list, keyOf) => {
        const map = new Map();
        for (const g of list) if (!map.has(keyOf(g))) map.set(keyOf(g), g);
        return map;
    };
    siteIndex = {
        stamp,
        value: {
            nexusByKey: byFirst(nexusAll, (g) => keyFor(g.name)),
            nexusByDomain: byFirst(nexusAll, (g) => g.domain),
            cfByKey: byFirst(cfAll, (g) => keyFor(g.name)),
            cfById: byFirst(cfAll, (g) => g.id),
        },
    };
    return siteIndex.value;
}

/* A game's page on CurseForge, when its list (fetched since slugs were kept) says where. */
function curseforgePage(id) {
    const slug = sites().cfById.get(Number(id))?.slug;
    return slug ? `https://www.curseforge.com/${encodeURIComponent(slug)}` : null;
}

const steamHeader = (id) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`;
const steamHeaderOld = (id) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;
const nexusTile = (id) => `https://images.nexusmods.com/images/games/v2/${id}/tile.jpg`;
const STEAM_EXTRAS = /\b(demo|soundtrack|playtest|dedicated server|artbook|ost|sdk|benchmark)\b/i;

// A store name without its trademark signs.
const cleanName = (text) => unescapeHtml(String(text)).replace(/[™®]/g, "").replace(/\s{2,}/g, " ").trim();

const unescapeHtml = (text) =>
    text
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&reg;|&trade;|&copy;/g, "")
        .trim();

/* ---------------- Steam's store: prices and filters ---------------- */

// Steam's sort orders the search offers.
const SORTS = { popular: null, new: "Released_DESC", rated: "Reviews_DESC", "price-asc": "Price_ASC", "price-desc": "Price_DESC" };

/*
 * Steam's search filters. Prices are in the player's own currency (Steam goes by where they
 * are), so "under" only takes Steam's own steps for it (priceSteps).
 */
function steamFilters({ price = "any", sort = "popular", mac = false } = {}) {
    const params = {};
    if (price === "free") params.maxprice = "free";
    else if (price === "sale") params.specials = "1";
    else if (/^\d{1,4}$/.test(String(price))) params.maxprice = String(price);
    if (SORTS[sort]) params.sort_by = SORTS[sort];
    if (mac) params.os = "mac";
    return params;
}

/* The price in one row of Steam's search. -> { text, cents, was, discount, free }, or null before it's out */
function rowPrice(row) {
    const final = row.match(/<div class="discount_final_price( free)?">([^<]*)<\/div>/);
    if (!final) return null;
    const free = Boolean(final[1]) || /^free/i.test(final[2].trim());
    const discount = free ? 0 : Number(row.match(/data-discount="(\d+)"/)?.[1]) || 0;
    const was = discount ? row.match(/<div class="discount_original_price">([^<]*)<\/div>/)?.[1] ?? null : null;
    return {
        text: free ? "Free" : unescapeHtml(final[2]),
        cents: free ? 0 : Number(row.match(/data-price-final="(\d+)"/)?.[1]) || null,
        was: was ? unescapeHtml(was) : null,
        discount,
        free,
    };
}

/*
 * The country Steam sells to from this computer ("GB"), from the cookie its search sets. Sent
 * with every price: without one Steam guesses per request, and its price replies are cached
 * for anyone, so a reply can come back in another country's currency. Kept six hours.
 */
let country = { at: 0, cc: null, loading: null };
async function steamCountry() {
    if (country.cc && Date.now() - country.at < 6 * HOUR) return country.cc;
    country.loading ??= fetch("https://store.steampowered.com/search/results/?term=a&count=1&json=1", { headers: UA, signal: AbortSignal.timeout(10000) })
        .then((res) => /steamCountry=([A-Z]{2})/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? null)
        .catch(() => null)
        .then((cc) => {
            country = { at: Date.now(), cc: cc ?? country.cc, loading: null };
            return country.cc;
        });
    return country.loading;
}
const ccParam = async () => {
    const cc = await steamCountry();
    return cc ? `&cc=${cc}` : "";
};

/* Steam's price steps in the player's currency ("Under £4.00"...), kept a day. */
let stepsCache = { at: 0, steps: [] };
async function priceSteps() {
    if (stepsCache.steps.length && Date.now() - stepsCache.at < DAY) return stepsCache.steps;
    const res = await fetch(`https://store.steampowered.com/search/?l=english${await ccParam()}`, { headers: UA, signal: AbortSignal.timeout(15000) });
    const raw = (await res.text()).match(/rgPriceStopData = (\[[^\]]*\])/)?.[1];
    const steps = JSON.parse(raw ?? "[]")
        .filter((step) => step.price !== null && step.price !== "free")
        .map((step) => ({ value: String(step.price), label: String(step.label) }));
    if (steps.length) stepsCache = { at: Date.now(), steps };
    return steps;
}

/* Today's prices of Steam games, 50 to a request, kept six hours. -> Map appid -> price or null */
const priceCache = new Map();
async function steamPrices(ids) {
    const want = [...new Set(ids.map(String))].filter((id) => !(Date.now() - (priceCache.get(id)?.at ?? 0) < 6 * HOUR));
    for (let i = 0; i < want.length; i += 50) {
        const chunk = want.slice(i, i + 50);
        const json = await getJson(`https://store.steampowered.com/api/appdetails?appids=${chunk.join(",")}&filters=price_overview${await ccParam()}`).catch(() => null);
        if (!json) continue;
        for (const id of chunk) {
            if (!json[id]?.success) continue;
            const p = json[id].data?.price_overview;
            // No price on a game Steam sells: it's free to play.
            const price = p
                ? { text: p.final_formatted, cents: p.final, was: p.discount_percent ? p.initial_formatted : null, discount: p.discount_percent || 0, free: false }
                : { text: "Free", cents: 0, was: null, discount: 0, free: true };
            priceCache.set(id, { at: Date.now(), price });
        }
    }
    return new Map(ids.map((id) => [String(id), priceCache.get(String(id))?.price ?? null]));
}

// After a game's name, words that make it a later edition of the same game ("... (2009)" too).
const EDITIONS = /^((definitive|enhanced|complete|special|legendary|anniversary|ultimate|game of the year|goty|remastered) ?(edition)?|remastered|remaster|enhanced)( \d{4})?$/;
// "The Elder Scrolls V: Skyrim" -> "Skyrim".
const subtitleOf = (name) => String(name ?? "").split(/:\s+/).slice(1).join(" ");

/*
 * The Steam games a mod site's game may be, best first, from Steam's store search: the same
 * name (also after a series' title, "The Elder Scrolls V: Skyrim Special Edition"), or loosely
 * a later edition of it, in Steam's own order, so a famous "Oblivion" beats an unknown one.
 * Remasters come last: they are often a game apart for mods. Kept a month in steam-names.json
 * (a miss too, so it isn't asked again). -> [{ id, name, mac, loose }], or null if Steam
 * couldn't be asked.
 */
const namesFile = () => path.join(dataDir(), "steam-names.json");
let steamNames = null;
async function steamMatch(name) {
    if (!steamNames) {
        try {
            steamNames = JSON.parse(fs.readFileSync(namesFile(), "utf8"));
        } catch {
            steamNames = {};
        }
    }
    const key = keyFor(name);
    const known = steamNames[key];
    // Kept before more than one match was kept (v4): asked again.
    if (known?.v === 4 && Array.isArray(known.picks) && Date.now() - known.at < 30 * DAY) return known.picks;
    // Only the game's number is wanted here (its price comes in the player's own currency later),
    // but this search answers nothing without a country.
    const json = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=english&cc=US`).catch(() => null);
    if (!json) return null;
    const edition = (title) => {
        const k = keyFor(title);
        return Boolean(title) && k.startsWith(`${key} `) && EDITIONS.test(k.slice(key.length + 1)) ? k.slice(key.length + 1) : null;
    };
    const picks = (json.items ?? [])
        .filter((item) => item.type === "app")
        .map((item) => {
            const same = [item.name, subtitleOf(item.name)].some((title) => title && keyFor(title) === key);
            const later = same ? null : edition(item.name) ?? edition(subtitleOf(item.name));
            return (same || later) && { id: String(item.id), name: cleanName(item.name), mac: Boolean(item.platforms?.mac), loose: !same, remaster: /^remaster/.test(later ?? "") };
        })
        .filter(Boolean)
        .sort((a, b) => Number(a.remaster) - Number(b.remaster))
        .map(({ remaster, ...pick }) => pick);
    steamNames[key] = { v: 4, at: Date.now(), picks };
    return picks;
}

/* One block of 25 of Steam's store search. -> { total, rows } */
async function steamBlock(query, block, filters) {
    const url =
        "https://store.steampowered.com/search/results/?" +
        new URLSearchParams({ term: query, start: String(block * 25), count: "25", infinite: "1", category1: "998", l: "english", json: "1", ...filters });
    const json = await getJson(url + (await ccParam()));
    const rows = String(json?.results_html ?? "")
        .split(/(?=<a href=)/)
        .filter((row) => row.includes('class="title"'));
    return { total: Number(json?.total_count) || 0, rows };
}

/*
 * Games offset..offset+count of Steam's store search (all 190,000-odd games when nothing's
 * typed, most played first). Steam only starts a page at a multiple of its length, so the
 * blocks of 25 around them are asked for and cut down. Bundles have no app number and are
 * left out after cutting, so each page starts where the last ended.
 * -> { total, games: [{ steamAppId, name, art, capsule, price, mac }] }
 */
async function steamPage(query, offset, count, filters = {}) {
    const first = Math.floor(offset / 25);
    const last = Math.floor((offset + count - 1) / 25);
    const blocks = await Promise.all(Array.from({ length: last - first + 1 }, (_, i) => steamBlock(query, first + i, filters)));
    const rows = blocks.flatMap((b) => b.rows).slice(offset - first * 25, offset - first * 25 + count);
    const games = rows.map(rowGame).filter(Boolean);
    return { total: blocks[0].total || games.length, games };
}

/* One row of Steam's search as a game, or null for a bundle (no app number). */
function rowGame(row) {
    const id = row.match(/data-ds-appid="(\d+)"/)?.[1];
    const name = row.match(/<span class="title">([^<]*)<\/span>/)?.[1];
    // The row's own small picture, for games whose header has moved.
    const capsule = row.match(/<img src="([^"]+)"/)?.[1] ?? null;
    return id && name ? { steamAppId: id, name: cleanName(name), art: steamHeader(id), capsule, price: rowPrice(row), mac: row.includes("platform_img mac") } : null;
}

/*
 * Steam's search kept to the games with mods (or without), for the "Mods" filter. Steam can't
 * filter that itself, so its results are read in order, 50 at a time, and the kept ones
 * remembered; the next page carries on where the last stopped. One read is held to 400 rows,
 * and stops early (keeping what it has) if Steam turns it away after this page has its games.
 * -> { kept, seen, total, done }
 */
const scans = new Map();
const SCAN_BLOCKS = 2;
const SCAN_ROUNDS = 8;
function steamScan(query, filters, keep, from, wanted, scanKey) {
    let scan = scans.get(scanKey);
    if (!scan || Date.now() - scan.at > 10 * 60_000) {
        scan = { at: Date.now(), block: 0, kept: [], seen: 0, total: 0, done: false, queue: Promise.resolve() };
        scans.delete(scanKey);
        scans.set(scanKey, scan);
        if (scans.size > 20) scans.delete(scans.keys().next().value);
    }
    // One read at a time per scan, so pages asked for quickly don't read the same rows twice.
    const read = scan.queue.then(async () => {
        for (let round = 0; scan.kept.length < wanted && !scan.done && round < SCAN_ROUNDS; round++) {
            let blocks;
            try {
                blocks = await Promise.all(Array.from({ length: SCAN_BLOCKS }, (_, i) => steamBlock(query, scan.block + i, filters)));
            } catch (err) {
                if (scan.kept.length > from) break;
                throw err;
            }
            scan.block += SCAN_BLOCKS;
            scan.total = blocks[0].total || scan.total;
            for (const block of blocks) {
                for (const game of block.rows.map(rowGame)) {
                    if (!game) continue;
                    scan.seen++;
                    if (keep(game)) scan.kept.push(game);
                }
            }
            if (scan.block * 25 >= scan.total || blocks.every((b) => !b.rows.length)) scan.done = true;
        }
        return scan;
    });
    scan.queue = read.catch(() => {});
    return read;
}

/* How well a name matches what was typed: 3 exact, 2 starts with it, 1 has every word, 0 not. */
function score(name, query) {
    const n = norm(name);
    const q = norm(query);
    if (!q) return 1;
    if (n === q) return 3;
    if (n.startsWith(q)) return 2;
    return q.split(" ").every((word) => n.split(" ").some((part) => part.startsWith(word))) ? 1 : 0;
}

const SOURCES = new Set(["all", "steam", "nexus", "curseforge"]);

/*
 * Every game, one entry each. source "all" is Steam's whole store when nothing's typed (each
 * game marked with the mod sites that have it); typed, it's every game with mods on Nexus Mods
 * or CurseForge, the Steam games on this computer and Steam's own matches. "steam" is Steam's
 * whole store, page by page; "nexus" and "curseforge" are each
 * site's own list. A price, sale or Mac filter, or a sort other than the usual, searches
 * Steam's store (via "steam"), since only Steam sells them.
 *
 * Each game on the page that a mod site lists and Steam sells is folded into Steam's (its
 * name, picture, price), and the mod sites a Steam game has are marked, so one card stands
 * for all three.
 *
 * mods "with" keeps the games with mods on Nexus Mods or CurseForge, "none" the rest. Browsing
 * every game with mods and no Steam filter lists the mod sites' games (most modded first);
 * otherwise Steam's results are read through for them (steamScan), and the total is an
 * estimate until the end of Steam's list is reached: approx "about", or "more" for at least that many.
 * -> { results, page, pageCount, total, approx, counts, warnings, source, via, priceSteps }
 */
async function search(query, { page = 0, size = 12, own = [], source = "all", price = "any", sort = "popular", mac = false, mods = "any" } = {}) {
    const q = String(query ?? "").trim().slice(0, 80);
    const from = SOURCES.has(source) ? source : "all";
    size = Math.min(Math.max(1, Number(size) || 12), 48);
    page = Math.max(0, Math.floor(Number(page) || 0));
    const filters = steamFilters({ price, sort, mac: Boolean(mac) });
    // Every game on Nexus Mods and CurseForge has mods; the filter means something on Steam's lists.
    const modsWanted = (from === "all" || from === "steam") && (mods === "with" || mods === "none") ? mods : "any";
    const steamFiltered = Object.keys(filters).length > 0;
    // Browsing every game is browsing Steam's store: 190,000-odd games, most played first. Every
    // game with mods, unfiltered, is the mod sites' own lists instead.
    const via =
        from === "steam" || (from === "all" && ((!q && modsWanted !== "with") || steamFiltered)) ? "steam" : from;
    const warnings = [];
    const results = new Map();
    const merge = (entry) => {
        const key = keyFor(entry.name);
        const was = results.get(key) ?? { name: entry.name, steamAppId: null, nexus: null, nexusGameId: null, nexusMods: 0, curseforge: null, installed: false, art: null, capsule: null, price: undefined, mac: null, rank: 0, order: results.size };
        const next = { ...was };
        for (const [field, value] of Object.entries(entry)) {
            // A Steam row's price is null before the game is out, and stays so.
            if ((value === null && field !== "price") || value === undefined || value === false || field === "rank" || field === "order") continue;
            // Steam's spelling of a name, and its picture, win.
            if ((field === "name" || field === "art") && was.steamAppId && was[field]) continue;
            next[field] = value;
        }
        next.rank = Math.max(was.rank, entry.rank ?? 0);
        results.set(key, next);
    };

    // Lists the others are marked from: which games have mods, and where.
    const stepsLoading = priceSteps().catch(() => []);
    const [nexusAll, cfAll] = await Promise.all([
        nexusGames().catch((err) => {
            warnings.push(`Nexus Mods: ${err.message}`);
            return [];
        }),
        curseforgeGames(),
    ]);
    // How many games the mod sites list, one count for a game on both.
    const moddedCount = () => new Set([...nexusAll, ...cfAll].map((g) => keyFor(g.name))).size;
    const nexusByKey = new Map(nexusAll.map((g) => [keyFor(g.name), g]));
    const cfByKey = new Map(cfAll.map((g) => [keyFor(g.name), g]));
    const installed = steamApps();
    const nexusEntry = (g, rank) => ({ name: g.name, nexus: g.domain, nexusGameId: g.id, nexusMods: g.mods, art: nexusTile(g.id), rank });
    const marks = (name) => {
        const n = nexusByKey.get(keyFor(name));
        const c = cfByKey.get(keyFor(name));
        return { nexus: n?.domain ?? null, nexusGameId: n?.id ?? null, nexusMods: n?.mods ?? 0, curseforge: c?.id ?? null };
    };

    const hasMods = (r) => Boolean(r.nexus || r.curseforge);
    const keepForMods = (r) => (modsWanted === "with" ? hasMods(r) : !hasMods(r));

    let total = null;
    let approx = null;
    let scanned = null;
    let scanPages = null;
    if (via === "steam" && modsWanted !== "any") {
        // Steam can't filter by mods: its results are read through for the games wanted.
        try {
            const scanKey = JSON.stringify([q, filters, modsWanted]);
            const scan = await steamScan(q, filters, (g) => keepForMods(marks(g.name)), page * size, (page + 1) * size, scanKey);
            const pages = Math.max(1, Math.ceil(scan.kept.length / size));
            const at = scan.done ? Math.min(page, pages - 1) : page;
            for (const g of scan.kept.slice(at * size, at * size + size)) merge({ ...g, ...marks(g.name), installed: installed.has(g.steamAppId) });
            // Until Steam's list is read to the end there's no exact count. Games with mods are
            // counted as found so far ("96+"): Steam's most played games mostly have mods and its
            // long tail mostly doesn't, so the share seen so far would overcount. Games without are
            // nearly all of Steam: its total less the games the mod sites list ("about").
            if (scan.done || !scan.seen) total = scan.kept.length;
            else if (modsWanted === "with") {
                total = scan.kept.length;
                approx = "more";
            } else {
                const modded = Math.min(Math.round((1 - scan.kept.length / scan.seen) * scan.total), moddedCount());
                total = Math.max(scan.kept.length, scan.total - modded);
                approx = "about";
            }
            // Pages open as Steam's list is read: those read so far, and the next.
            scanPages = Math.max(1, Math.ceil(scan.kept.length / size)) + (scan.done ? 0 : 1);
            scanned = at;
        } catch (err) {
            warnings.push(`Steam: ${err.message}`);
        }
    } else if (via === "steam") {
        // Steam pages itself: one request per page.
        try {
            const got = await steamPage(q, page * size, size, filters);
            total = got.total;
            for (const g of got.games) merge({ ...g, ...marks(g.name), installed: installed.has(g.steamAppId) });
        } catch (err) {
            warnings.push(`Steam: ${err.message}`);
        }
    } else {
        if (from === "all") {
            // Installed on Steam: those first.
            for (const [id, app] of installed) {
                if (!app.name || NOT_GAMES.test(app.name) || !score(app.name, q)) continue;
                merge({ name: app.name, steamAppId: id, installed: true, art: steamHeader(id), ...marks(app.name), rank: 10 + score(app.name, q) });
            }
        }
        if (from === "all" || from === "nexus") {
            let hits = nexusAll.filter((g) => score(g.name, q));
            if (q && !hits.some((g) => score(g.name, q) === 3)) hits = [...hits, ...(await nexusExact(q).catch(() => []))];
            for (const g of hits) merge({ ...nexusEntry(g, score(g.name, q)), curseforge: marks(g.name).curseforge });
        }
        if (from === "all" || from === "curseforge") {
            for (const g of cfAll) if (score(g.name, q)) merge({ ...(from === "curseforge" ? marks(g.name) : {}), name: g.name, curseforge: g.id, rank: score(g.name, q) });
        }
        if (from === "all" && q) {
            // Steam's best matches too, for games no mod site lists yet.
            try {
                const got = await steamPage(q, 0, 50);
                for (const g of got.games) if (!STEAM_EXTRAS.test(g.name)) merge({ ...g, installed: installed.has(g.steamAppId), rank: score(g.name, q) || 0.5 });
            } catch (err) {
                warnings.push(`Steam: ${err.message}`);
            }
        }
    }

    let list = [...results.values()];
    if (via !== "steam" && modsWanted !== "any") list = list.filter(keepForMods);
    // Steam's own order stands; the rest: best match, games with mods, then most modded (or by name).
    if (via === "steam") list.sort((a, b) => a.order - b.order);
    else if (sort === "name" || from === "curseforge") list.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
    else list.sort((a, b) => b.rank - a.rank || Number(Boolean(b.nexus || b.curseforge)) - Number(Boolean(a.nexus || a.curseforge)) || b.nexusMods - a.nexusMods || a.name.localeCompare(b.name));

    let at = scanned ?? page;
    let pageCount;
    // Browsing every game: how many Steam sells, and how many have mods (some on both).
    const counts = from === "all" && !q && total !== null && modsWanted === "any" ? { steam: total, modded: moddedCount() } : undefined;
    if (total !== null) {
        pageCount = scanPages ?? Math.max(1, Math.ceil(total / size));
    } else {
        total = list.length;
        pageCount = Math.max(1, Math.ceil(total / size));
        at = Math.min(page, pageCount - 1);
        list = list.slice(at * size, at * size + size);
    }

    // The Steam game a mod site's game is: null if none, undefined if Steam couldn't be asked.
    const steamFor = async (name) => {
        const picks = await steamMatch(name);
        if (!picks) return undefined;
        // A loose match ("Skyrim" finding Skyrim Special Edition) is wrong when a mod site lists
        // the game it found as one of its own.
        const listedApart = (title) =>
            [nexusByKey, cfByKey].some((sites) => {
                const g = title && sites.get(keyFor(title));
                return g && keyFor(g.name) !== keyFor(name);
            });
        return picks.find((pick) => !pick.loose || !(listedApart(pick.name) || listedApart(subtitleOf(pick.name)))) ?? null;
    };
    const fold = (r, hit) => Object.assign(r, { steamAppId: hit.id, name: hit.name ?? r.name, art: steamHeader(hit.id), capsule: null, price: undefined, mac: hit.mac, installed: installed.has(hit.id) });

    // Fold this page's mod-site games into the Steam game they are. A Steam game that only
    // shares a mod-site game's name (a new "Mafia", not 2K's) is parted from it again.
    const parted = new Map();
    await Promise.all(
        list
            .filter((r) => r.nexus || r.curseforge)
            .map(async (r) => {
                const hit = await steamFor(r.name);
                if (!r.steamAppId) {
                    if (hit) fold(r, hit);
                    return;
                }
                if (hit === undefined || hit?.id === r.steamAppId) return;
                const site = nexusByKey.get(keyFor(r.name)) ?? cfByKey.get(keyFor(r.name));
                const modded = {
                    ...r,
                    name: site?.name ?? r.name,
                    steamAppId: null,
                    art: r.nexusGameId ? nexusTile(r.nexusGameId) : null,
                    capsule: null,
                    price: undefined,
                    mac: null,
                    installed: false,
                };
                Object.assign(r, { nexus: null, nexusGameId: null, nexusMods: 0, curseforge: null });
                if (hit) fold(modded, hit);
                // Steam's whole store lists Steam's games only.
                if (via !== "steam") parted.set(r, modded);
            })
    );
    if (parted.size) list = list.flatMap((r) => (parted.has(r) ? [r, parted.get(r)] : [r]));
    if (steamNames) fs.promises.writeFile(namesFile(), JSON.stringify(steamNames)).catch(() => {});
    // The same Steam game twice (its Steam row and a mod site's): one card with every site's marks.
    const firsts = new Map();
    list = list.filter((r) => {
        const first = r.steamAppId && firsts.get(r.steamAppId);
        if (!r.steamAppId || !first) {
            if (r.steamAppId) firsts.set(r.steamAppId, r);
            return true;
        }
        if (!first.nexus && r.nexus) Object.assign(first, { nexus: r.nexus, nexusGameId: r.nexusGameId, nexusMods: r.nexusMods });
        first.curseforge ??= r.curseforge;
        first.installed ||= r.installed;
        return false;
    });
    // A Steam game parted from a mod site's game of the same name lost its mods; the filter holds.
    if (modsWanted !== "any") list = list.filter(keepForMods);
    const prices = await steamPrices(list.filter((r) => r.steamAppId && r.price === undefined).map((r) => r.steamAppId)).catch(() => new Map());

    const games = all();
    const out = list.map((r) => ({
        name: r.name,
        steamAppId: r.steamAppId,
        nexus: r.nexus,
        nexusGameId: r.nexusGameId,
        nexusMods: r.nexusMods,
        curseforge: r.curseforge,
        installed: r.installed,
        art: r.art ?? (r.steamAppId ? steamHeader(r.steamAppId) : r.nexusGameId ? nexusTile(r.nexusGameId) : null),
        // If Steam's picture is missing, Nexus Mods' tile stands in.
        artAlt: r.steamAppId ? (r.nexusGameId ? nexusTile(r.nexusGameId) : r.capsule ?? steamHeaderOld(r.steamAppId)) : null,
        price: r.price !== undefined ? r.price : r.steamAppId ? prices.get(String(r.steamAppId)) ?? null : null,
        mac: r.mac ?? null,
        existing: existing(r, games, own)?.id ?? null,
    }));
    return { results: out, page: at, pageCount, total, approx, counts, warnings, source: from, via, priceSteps: await stepsLoading };
}

/* ---------------- where to get a game ---------------- */

/*
 * The stores that sell each of these games (wheretoget.cjs), with Steam's price on a Steam
 * one: a mod site's game Steam sells under another name is found this way too.
 * -> { [name]: { stores, platforms, pc, steamAppId } }
 */
async function whereToGet(names) {
    const found = await wheretoget.lookup(names, { cc: await steamCountry() });
    const ids = Object.values(found).map((where) => where.steamAppId).filter(Boolean);
    const prices = ids.length ? await steamPrices(ids).catch(() => new Map()) : new Map();
    for (const where of Object.values(found)) {
        const steam = where.stores.find((s) => s.store === "steam");
        if (steam && where.steamAppId) steam.price = prices.get(String(where.steamAppId)) ?? null;
    }
    return found;
}

/* ---------------- news and add-ons ---------------- */

const storeUrl = (appId) => `https://store.steampowered.com/app/${appId}/`;

// Steam's announcements are BBCode or HTML: just the words.
const plainText = (text, max) =>
    unescapeHtml(
        String(text ?? "")
            .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, " ")
            .replace(/\[\/?[a-z0-9*]+(=[^\]]*)?\]/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
    ).slice(0, max);

const money = (cents, currency) => {
    try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
    } catch {
        return `${(cents / 100).toFixed(2)} ${currency}`;
    }
};

/*
 * A game's news and add-ons from Steam: its latest announcements, and its DLC at today's
 * prices (on sale first, then newest), with the game's own price, and every store that sells
 * it. Kept an hour.
 */
const infoCache = new Map();
async function storeInfo(def) {
    const where = def.name ? (await whereToGet([def.name]).catch(() => ({})))[def.name] ?? null : null;
    const others = { stores: where?.stores ?? [], platforms: where?.platforms ?? [], pc: where?.pc ?? null };
    // A game Steam sells under another name than the mod sites': Wikidata knows its number.
    const appId = def.steamAppIds?.[0] ?? where?.steamAppId ?? null;
    if (!appId) return { steamAppId: null, price: null, news: [], dlc: [], dlcCount: 0, storeUrl: null, ...others };
    const cached = infoCache.get(appId);
    if (cached && Date.now() - cached.at < HOUR) return { ...cached.value, ...others };
    const [newsJson, dlcJson, prices] = await Promise.all([
        getJson(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=6&maxlength=600&feeds=steam_community_announcements`).catch(() => null),
        ccParam().then((cc) => getJson(`https://store.steampowered.com/api/dlcforapp/?appid=${appId}&l=english${cc}`)).catch(() => null),
        steamPrices([appId]).catch(() => new Map()),
    ]);
    const news = (newsJson?.appnews?.newsitems ?? []).map((item) => ({
        id: String(item.gid),
        title: plainText(item.title, 160),
        date: new Date(Number(item.date) * 1000).toISOString(),
        summary: plainText(item.contents, 280),
        url: `https://store.steampowered.com/news/app/${appId}/view/${item.gid}`,
    }));
    const all = (Array.isArray(dlcJson?.dlc) ? dlcJson.dlc : []).map((d) => {
        const p = d.price_overview;
        const out = Number(d.release_date?.steam) * 1000;
        // No price on something already out: it's free (bonus content, tools); not out yet: coming soon.
        const soon = Boolean(out) && out > Date.now();
        return {
            id: String(d.id),
            name: unescapeHtml(String(d.name ?? "")).replace(/[™®]/g, ""),
            art: typeof d.header_image === "string" ? d.header_image : null,
            price: p
                ? { text: money(p.final, p.currency), cents: p.final, was: p.discount_percent ? money(p.initial, p.currency) : null, discount: p.discount_percent || 0, free: false }
                : soon ? null : { text: "Free", cents: 0, was: null, discount: 0, free: true },
            mac: Boolean(d.platforms?.mac),
            released: Number(d.release_date?.steam) ? new Date(Number(d.release_date.steam) * 1000).toISOString() : null,
            url: storeUrl(d.id),
        };
    });
    all.sort((a, b) => (b.price?.discount ?? 0) - (a.price?.discount ?? 0) || String(b.released ?? "").localeCompare(String(a.released ?? "")));
    const value = { steamAppId: appId, price: prices.get(String(appId)) ?? null, news, dlc: all.slice(0, 12), dlcCount: all.length, storeUrl: storeUrl(appId) };
    // A failed answer is asked again next time.
    if (newsJson || dlcJson) infoCache.set(appId, { at: Date.now(), value });
    return { ...value, ...others };
}

/* ---------------- pictures ---------------- */

/*
 * A game's picture from where it's sold: Steam's store header, else the Xbox store's,
 * else its Nexus Mods tile. Kept for a month in settings.art.
 */
async function artFor(def) {
    const cached = readSettings().art?.[def.id];
    if (cached && Date.now() - cached.at < 30 * 24 * 60 * 60 * 1000) return cached.url;
    let url = null;
    const steam = def.steamAppIds?.[0];
    if (steam) {
        url = await getJson(`https://store.steampowered.com/api/appdetails?appids=${steam}&filters=basic`)
            .then((json) => json?.[steam]?.data?.header_image ?? null)
            .catch(() => null);
    }
    if (!url) url = await xboxArt(def.name).catch(() => null);
    if (!url && (def.nexusGameId ?? NEXUS_IDS[def.nexus])) url = nexusTile(def.nexusGameId ?? NEXUS_IDS[def.nexus]);
    if (!url && def.art) url = def.art;
    const settings = readSettings();
    settings.art ??= {};
    settings.art[def.id] = { url, at: Date.now() };
    writeSettings(settings);
    return url;
}

/* The Xbox store's wide picture (with the title on it) for a game of this name. */
async function xboxArt(name) {
    const found = await getJson(
        `https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest?market=US&languages=en-us&query=${encodeURIComponent(name)}&productFamilyNames=Games`
    );
    const products = (found?.Results ?? []).flatMap((r) => r.Products ?? []).filter((p) => p.Type === "Game");
    const match = products.find((p) => norm(p.Title) === norm(name)) ?? products.find((p) => norm(p.Title).startsWith(norm(name)));
    if (!match?.ProductId) return null;
    const detail = await getJson(`https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${match.ProductId}&market=US&languages=en-us`);
    const images = detail?.Products?.[0]?.LocalizedProperties?.[0]?.Images ?? [];
    const pick = images.find((i) => i.ImagePurpose === "TitledHeroArt") ?? images.find((i) => i.ImagePurpose === "SuperHeroArt") ?? images.find((i) => i.ImagePurpose === "BoxArt");
    if (!pick?.Uri) return null;
    return `${pick.Uri.startsWith("//") ? "https:" : ""}${pick.Uri}?w=920`;
}

module.exports = { all, find, open, keep, remove, locate, chooseModsDir, chooseLaunch, search, storeInfo, whereToGet, artFor, steamApps, defaultModsDir, keyFor, curseforgePage, OWN };
