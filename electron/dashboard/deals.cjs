const store = require("./store.cjs");
const { fetchText } = require("./news.cjs");

/*
 * Steam's current specials, for the launcher's main Home. They come from the Steam store's own
 * front-page data (no key needed): each deal's real name, picture, prices, discount and end time,
 * in the currency of the player's country. Cached for half an hour; a failure keeps the last list.
 */

const CACHE_FILE = "deals-cache.json";
const FRESH_MS = 30 * 60_000;
const RETRY_MS = 5 * 60_000;
const MAX_DEALS = 12;

let app = null;
try {
    ({ app } = require("electron"));
} catch {
    // Outside Electron (tests): the store picks the region.
}

/* The two-letter country Steam should price for, from the computer's region. */
function country() {
    const fromApp = app?.getLocaleCountryCode?.();
    const code = String(fromApp || Intl.DateTimeFormat().resolvedOptions().locale.split("-")[1] || "").toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : "US";
}

function cleanDeal(raw) {
    const id = Number(raw?.id);
    if (!Number.isInteger(id) || id <= 0 || typeof raw?.name !== "string" || !raw.name.trim()) return null;
    const percent = Number(raw.discount_percent);
    const original = Number(raw.original_price);
    const final = Number(raw.final_price);
    if (!(percent > 0) || !Number.isFinite(original) || !Number.isFinite(final)) return null;
    const image = [raw.large_capsule_image, raw.header_image, raw.small_capsule_image].find(
        (src) => typeof src === "string" && src.startsWith("https://"),
    );
    const ends = Number(raw.discount_expiration);
    return {
        id,
        name: raw.name.trim(),
        discountPercent: Math.round(percent),
        // Prices arrive in the currency's smallest unit (pence, cents).
        originalPrice: original / 100,
        finalPrice: final / 100,
        currency: typeof raw.currency === "string" && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : "USD",
        image: image ?? null,
        url: `https://store.steampowered.com/app/${id}/`,
        endsAt: Number.isFinite(ends) && ends > 0 ? new Date(ends * 1000).toISOString() : null,
        platforms: { windows: Boolean(raw.windows_available), mac: Boolean(raw.mac_available), linux: Boolean(raw.linux_available) },
    };
}

let inFlight = null;

/* -> { items, failed, fetchedAt, fromCache } (see src/types/dashboard.d.ts). */
function getDeals({ refresh = false } = {}) {
    if (!inFlight) {
        inFlight = loadDeals(refresh).finally(() => {
            inFlight = null;
        });
    }
    return inFlight;
}

async function loadDeals(refresh) {
    const now = Date.now();
    const cc = country();
    const cache = store.readJson(CACHE_FILE, null);
    const usable = cache && cache.country === cc && Array.isArray(cache.items);
    const age = usable ? now - cache.attemptedAt : Infinity;
    const due = !usable || age >= (cache.ok ? FRESH_MS : RETRY_MS) || (refresh && age >= 60_000);

    if (!due) {
        return { items: cache.items, failed: cache.ok ? [] : ["Steam"], fetchedAt: new Date(cache.fetchedAt ?? now).toISOString(), fromCache: true };
    }

    try {
        const { text } = await fetchText(`https://store.steampowered.com/api/featuredcategories?cc=${cc}&l=english`);
        const json = JSON.parse(text);
        const seen = new Set();
        const items = (Array.isArray(json?.specials?.items) ? json.specials.items : [])
            .map(cleanDeal)
            .filter((deal) => deal && !seen.has(deal.id) && seen.add(deal.id))
            .slice(0, MAX_DEALS);
        if (!items.length) throw new Error("Steam listed no deals.");
        store.writeJson(CACHE_FILE, { country: cc, items, ok: true, attemptedAt: now, fetchedAt: now });
        return { items, failed: [], fetchedAt: new Date(now).toISOString(), fromCache: false };
    } catch (err) {
        console.warn("Steam deals couldn't be fetched:", err?.message ?? err);
        const items = usable ? cache.items : [];
        try {
            store.writeJson(CACHE_FILE, { country: cc, items, ok: false, attemptedAt: now, fetchedAt: usable ? cache.fetchedAt : null });
        } catch {
            // Nothing to keep.
        }
        return { items, failed: ["Steam"], fetchedAt: new Date(usable && cache.fetchedAt ? cache.fetchedAt : now).toISOString(), fromCache: usable };
    }
}

module.exports = { getDeals, _internal: { cleanDeal, country } };
