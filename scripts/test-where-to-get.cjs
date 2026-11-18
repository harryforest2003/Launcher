/*
 * Where to get a game (electron/games/wheretoget.cjs): turning what Wikidata and GOG answer
 * into store links, picking the right game when several share a name, and GOG's prices.
 * Offline: no request is made.
 */
const test = require("node:test");
const assert = require("node:assert");
const { answer, best, priceOf, siteOf } = require("../electron/games/wheretoget.cjs");

const game = ({ stores = {}, sites = [], platforms = {} } = {}) => ({
    item: "Q1",
    stores: new Map(Object.entries(stores)),
    sites,
    platforms: new Map(Object.entries(platforms)),
});

test("stores come out in a fixed order, with links built from each id", () => {
    const got = answer(
        game({
            stores: { P13193: "diablo", P2725: "game/diablo", P1733: "2344520" },
            sites: [{ url: "https://diablo.com", lang: null }],
            platforms: { Q1406: "Microsoft Windows" },
        }),
        null
    );
    assert.deepStrictEqual(
        got.stores.map((s) => [s.store, s.url]),
        [
            ["steam", "https://store.steampowered.com/app/2344520/"],
            ["gog", "https://www.gog.com/game/diablo"],
            ["battlenet", "https://shop.battle.net/product/diablo"],
            ["site", "https://diablo.com"],
        ]
    );
    assert.strictEqual(got.steamAppId, "2344520");
    assert.strictEqual(got.pc, true);
});

test("GOG's own listing adds its price to the GOG link, or stands alone", () => {
    const price = { text: "£9.99", cents: 999, was: null, discount: 0, free: false };
    const merged = answer(game({ stores: { P2725: "game/x" } }), { url: "https://www.gog.com/en/game/x", price });
    assert.strictEqual(merged.stores.length, 1);
    assert.deepStrictEqual(merged.stores[0].price, price);
    const alone = answer(null, { url: "https://www.gog.com/en/game/y", price });
    assert.deepStrictEqual(alone.stores.map((s) => s.store), ["gog"]);
    assert.strictEqual(alone.pc, true);
});

test("a console-only game says so; nothing known stays unknown", () => {
    const ps4 = answer(game({ sites: [{ url: "https://bloodborne.example", lang: null }], platforms: { Q5014725: "PlayStation 4" } }), null);
    assert.strictEqual(ps4.pc, false);
    assert.deepStrictEqual(ps4.platforms, ["PlayStation 4"]);
    assert.strictEqual(answer(null, null).pc, null);
});

test("of several games with one name, the PC one with the most stores wins", () => {
    const consoleOne = game({ stores: { P5885: "a", P6278: "b" }, platforms: { Q5014725: "PlayStation 4" } });
    const pcOne = game({ stores: { P1733: "1" }, platforms: { Q1406: "Microsoft Windows" } });
    assert.strictEqual(best([consoleOne, pcOne]), pcOne);
    assert.strictEqual(best([]), null);
});

test("the English site is preferred", () => {
    const sites = [
        { url: "https://fr.example", lang: "Q150" },
        { url: "https://en.example", lang: "Q1860" },
    ];
    assert.strictEqual(siteOf(game({ sites })), "https://en.example");
    assert.strictEqual(siteOf(game()), null);
});

test("GOG prices: free, on sale, and missing", () => {
    assert.deepStrictEqual(priceOf({ final: "£0.00", base: "£0.00", finalMoney: { amount: "0.00" } }), { text: "Free", cents: 0, was: null, discount: 0, free: true });
    assert.deepStrictEqual(priceOf({ final: "£15.75", base: "£20.99", discount: "-25%", finalMoney: { amount: "15.75" } }), {
        text: "£15.75",
        cents: 1575,
        was: "£20.99",
        discount: 25,
        free: false,
    });
    assert.strictEqual(priceOf(null), null);
    assert.strictEqual(priceOf({ finalMoney: { amount: "n/a" } }), null);
});
