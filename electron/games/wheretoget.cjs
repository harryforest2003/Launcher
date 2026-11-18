"use strict";

/*
 * Where to get a game: the stores that sell it and the machines it runs on, for games Steam
 * doesn't sell under that name (and as other places to buy the ones it does).
 *
 * Wikidata keeps each game's store ids (Steam, GOG, Epic Games Store, Microsoft Store,
 * Battle.net, itch.io, Humble) with its own site and platforms; one query answers a whole page
 * of names. GOG's catalogue adds the price. Kept a week in where-to-get.json, a miss a day.
 */

const fs = require("node:fs");
const path = require("node:path");
const { dataDir } = require("./storage.cjs");

const DAY = 24 * 60 * 60 * 1000;
const UA = { "User-Agent": "UnityLauncher/1.0 (game mod manager)" };

// Wikidata properties: [store, label, link]. The links follow each property's own formatter.
const STORES = [
    ["P1733", "steam", "Steam", (id) => `https://store.steampowered.com/app/${id}/`],
    ["P2725", "gog", "GOG", (id) => `https://www.gog.com/${id}`],
    ["P6278", "epic", "Epic Games Store", (id) => `https://store.epicgames.com/p/${id}`],
    ["P5885", "microsoft", "Microsoft Store", (id) => `https://apps.microsoft.com/detail/${id}`],
    ["P13193", "battlenet", "Battle.net", (id) => `https://shop.battle.net/product/${id}`],
    ["P7294", "itch", "itch.io", (url) => url],
    ["P4477", "humble", "Humble Store", (id) => `https://www.humblebundle.com/store/${id}`],
];
const ORDER = ["steam", "gog", "epic", "microsoft", "battlenet", "itch", "humble", "site"];
// Windows, macOS, Linux.
const PC = new Set(["Q1406", "Q14116", "Q388"]);
const ENGLISH = "Q1860";

// GOG prices in the player's money: its catalogue answers in dollars unless told the currency.
const EURO = "AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split(" ");
const CURRENCY = { GB: "GBP", PL: "PLN", AU: "AUD", CA: "CAD", CH: "CHF", NO: "NOK", SE: "SEK", DK: "DKK", BR: "BRL", NZ: "NZD", ...Object.fromEntries(EURO.map((cc) => [cc, "EUR"])) };

const norm = (name) =>
    String(name ?? "")
        .toLowerCase()
        .replace(/[™®©]/g, "")
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

/* ---------------- cache ---------------- */

const cacheFile = () => path.join(dataDir(), "where-to-get.json");
let cache = null;
function readCache() {
    if (cache) return cache;
    try {
        cache = JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
    } catch {
        cache = {};
    }
    return cache;
}
function saveCache() {
    try {
        // Old answers go; a page of names a visit keeps this small anyway.
        for (const [key, entry] of Object.entries(cache)) if (Date.now() - entry.at > 7 * DAY) delete cache[key];
        fs.writeFileSync(cacheFile(), JSON.stringify(cache));
    } catch {
        // A cache that can't be written is asked again next time.
    }
}
const fresh = (entry) => entry && Date.now() - entry.at < (entry.value.stores.length || entry.value.platforms.length ? 7 * DAY : DAY);

/* ---------------- Wikidata ---------------- */

// One query at a time: Wikidata's query service limits each address.
let queue = Promise.resolve();
function sparql(query) {
    const run = queue.then(async () => {
        const res = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`, {
            headers: { ...UA, Accept: "application/sparql-results+json" },
            signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) throw new Error(`Wikidata answered ${res.status}.`);
        return res.json();
    });
    queue = run.catch(() => {});
    return run;
}

// A SPARQL string: JSON's escapes (\" \\ \n \uXXXX) are SPARQL's too.
const literal = (text, lang) => `${JSON.stringify(String(text))}@${lang}`;

/*
 * Every video game named one of these (by its label or another name), with its store ids,
 * sites and platforms. -> Map name -> [{ item, stores: Map, sites: [{url, lang}], platforms: Map id -> label }]
 */
async function wikidata(names) {
    const values = names.flatMap((name) => [literal(name, "en"), literal(name, "mul")]).join(" ");
    const props = STORES.map(([prop]) => `wdt:${prop}`).join(" ");
    const query = `SELECT DISTINCT ?name ?item ?prop ?value ?lang ?vlabel WHERE {
  VALUES ?name { ${values} }
  { ?item rdfs:label ?name } UNION { ?item skos:altLabel ?name }
  ?item wdt:P31/wdt:P279? wd:Q7889 .
  {
    VALUES ?prop { ${props} wdt:P400 }
    ?item ?prop ?value .
    OPTIONAL { ?value rdfs:label ?vlabel . FILTER(LANG(?vlabel) = "en" || LANG(?vlabel) = "mul") }
  } UNION {
    ?item p:P856 ?site . ?site ps:P856 ?value .
    OPTIONAL { ?site pq:P407 ?lang }
    BIND(wdt:P856 AS ?prop)
  }
}`;
    const json = await sparql(query);
    const tail = (iri) => String(iri ?? "").split("/").pop();
    const found = new Map();
    for (const row of json?.results?.bindings ?? []) {
        const name = row.name?.value;
        const item = tail(row.item?.value);
        const prop = tail(row.prop?.value);
        const value = row.value?.value;
        if (!name || !item || !value) continue;
        const items = found.get(name) ?? found.set(name, new Map()).get(name);
        const game = items.get(item) ?? items.set(item, { item, stores: new Map(), sites: [], platforms: new Map() }).get(item);
        if (prop === "P400") {
            const id = tail(value);
            const label = row.vlabel?.value;
            // English first, then the name for every language.
            if (label && (row.vlabel["xml:lang"] === "en" || !game.platforms.get(id))) game.platforms.set(id, label);
            else if (!game.platforms.has(id)) game.platforms.set(id, null);
        } else if (prop === "P856") {
            if (!game.sites.some((s) => s.url === value)) game.sites.push({ url: value, lang: tail(row.lang?.value) || null });
        } else if (!game.stores.has(prop)) {
            game.stores.set(prop, value);
        }
    }
    return new Map([...found].map(([name, items]) => [name, [...items.values()]]));
}

/* A name's game when several share it ("Doom"): the one with a PC version, then the most stores. */
function best(items) {
    const score = (g) => ([...g.platforms.keys()].some((id) => PC.has(id)) ? 10 : 0) + g.stores.size + (g.sites.length ? 1 : 0);
    return [...items].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/* Its own site: the English one, else one with no language given, else the first. */
function siteOf(game) {
    return (game.sites.find((s) => s.lang === ENGLISH) ?? game.sites.find((s) => !s.lang) ?? game.sites[0])?.url ?? null;
}

/* ---------------- GOG ---------------- */

/* The game of exactly this name on GOG, with today's price. -> { url, price } or null */
async function gog(name, cc) {
    const currency = CURRENCY[cc] ?? (cc === "US" ? "USD" : null);
    const params = new URLSearchParams({ limit: "10", query: `like:${name}`, productType: "in:game,pack", locale: "en-US" });
    if (cc && currency) {
        params.set("countryCode", cc);
        params.set("currencyCode", currency);
    }
    const res = await fetch(`https://catalog.gog.com/v1/catalog?${params}`, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`GOG answered ${res.status}.`);
    const json = await res.json();
    const hit = (json?.products ?? []).find((p) => norm(p.title) === norm(name));
    if (!hit?.storeLink) return null;
    return { url: hit.storeLink, price: priceOf(hit.price) };
}

/* GOG's price as the launcher shows prices. */
function priceOf(p) {
    const amount = Number(p?.finalMoney?.amount);
    if (!p || !Number.isFinite(amount)) return null;
    if (amount === 0) return { text: "Free", cents: 0, was: null, discount: 0, free: true };
    const discount = Number(String(p.discount ?? "").replace(/[^0-9]/g, "")) || 0;
    return { text: String(p.final), cents: Math.round(amount * 100), was: discount ? String(p.base) : null, discount, free: false };
}

/* ---------------- together ---------------- */

/*
 * What Wikidata and GOG know of one name.
 * -> { stores: [{ store, label, url, price }], platforms: [names], pc: true/false/null, steamAppId }
 */
function answer(game, onGog) {
    const stores = [];
    if (game) {
        for (const [prop, store, label, link] of STORES) {
            const id = game.stores.get(prop);
            if (id) stores.push({ store, label, url: link(id), price: null });
        }
        const site = siteOf(game);
        if (site) stores.push({ store: "site", label: "Official site", url: site, price: null });
    }
    if (onGog) {
        const listed = stores.find((s) => s.store === "gog");
        if (listed) Object.assign(listed, onGog);
        else stores.push({ store: "gog", label: "GOG", ...onGog });
    }
    stores.sort((a, b) => ORDER.indexOf(a.store) - ORDER.indexOf(b.store));
    const ids = game ? [...game.platforms.keys()] : [];
    const platforms = game ? [...game.platforms.values()].filter(Boolean) : [];
    const sellsForPc = stores.some((s) => s.store !== "site");
    const pc = ids.length ? ids.some((id) => PC.has(id)) || sellsForPc : sellsForPc ? true : null;
    return { stores, platforms: [...new Set(platforms)], pc, steamAppId: game?.stores.get("P1733") ?? null };
}

const inFlight = new Map();

/*
 * Where to get each of these games. cc is the player's country (for GOG's prices). A name
 * Wikidata or GOG couldn't be asked about is left out, so it's asked again next time.
 * -> { [name]: { stores, platforms, pc, steamAppId } }
 */
async function lookup(names, { cc = null } = {}) {
    const wanted = [...new Set((names ?? []).map((n) => String(n ?? "").trim()).filter((n) => n && n.length <= 200))].slice(0, 40);
    const store = readCache();
    const keyOf = (name) => `${cc ?? ""}:${norm(name)}`;
    const out = {};
    const ask = [];
    for (const name of wanted) {
        const entry = store[keyOf(name)];
        if (fresh(entry)) out[name] = entry.value;
        else ask.push(name);
    }
    if (!ask.length) return out;

    const batchKey = `${cc}|${ask.join("\n")}`;
    let job = inFlight.get(batchKey);
    if (!job) {
        job = (async () => {
            const [wiki, gogs] = await Promise.all([
                wikidata(ask).catch(() => null),
                // Four at a time, so a page of names doesn't flood GOG.
                (async () => {
                    const results = new Map();
                    const rest = [...ask];
                    await Promise.all(
                        Array.from({ length: 4 }, async () => {
                            while (rest.length) {
                                const name = rest.shift();
                                results.set(name, await gog(name, cc).catch(() => undefined));
                            }
                        })
                    );
                    return results;
                })(),
            ]);
            const got = {};
            for (const name of ask) {
                const onGog = gogs.get(name);
                // Wikidata didn't answer and GOG has nothing to add: ask again later.
                if (!wiki && !onGog) continue;
                const value = answer(wiki ? best(wiki.get(name) ?? []) : null, onGog ?? null);
                got[name] = value;
                // A half answer (one of the two failed) isn't kept.
                if (wiki && onGog !== undefined) store[keyOf(name)] = { at: Date.now(), value };
            }
            saveCache();
            return got;
        })().finally(() => inFlight.delete(batchKey));
        inFlight.set(batchKey, job);
    }
    return Object.assign(out, await job);
}

module.exports = { lookup, answer, best, priceOf, siteOf };
