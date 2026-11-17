const fs = require("fs");
const path = require("path");
const detect = require("./detect.cjs");
const { steamRoots } = require("../mods/gameDetector.cjs");

/*
 * Who a game signs in as. Minecraft uses Microsoft accounts (minecraft/account.cjs); the
 * other games sign in through the app they were installed with. For Steam that's read from
 * the Steam client's own list of who signed in on this computer (config/loginusers.vdf),
 * showing only the display name. Nothing here asks for, reads or keeps a password, and the
 * EA app, GOG Galaxy, Epic and Rockstar keep their sign-ins to themselves, so for those
 * the player is told where they sign in.
 */

const STORES = {
    steam: "Steam",
    ea: "EA app",
    gog: "GOG Galaxy",
    epic: "Epic Games Launcher",
    rockstar: "Rockstar Games Launcher",
};

const ACCOUNT_TARGETS = Object.freeze({
    steam: "steam://open/main",
    ea: "https://myaccount.ea.com/",
    epic: "https://www.epicgames.com/account/personal",
    gog: "https://www.gog.com/account/settings/security",
    rockstar: "https://signin.rockstargames.com/signin/user-form",
});

function accountTarget(provider) {
    if (typeof provider !== "string" || !Object.hasOwn(ACCOUNT_TARGETS, provider)) throw new Error("Unsupported account provider.");
    return ACCOUNT_TARGETS[provider];
}

const HOW = {
    ea: "The EA app handles sign-in. Sign in there to play.",
    gog: "GOG Galaxy handles sign-in, if you use it.",
    epic: "The Epic Games Launcher handles sign-in. Sign in there to play.",
    rockstar: "The Rockstar Games Launcher handles sign-in. Sign in there to play.",
};

/* Which app a game came from, by where it is. */
function storeOf(id, loc) {
    const dir = String(loc.gameDir ?? "").replace(/\\/g, "/");
    if (/\/steamapps\//i.test(dir) || /^Steam/.test(loc.source ?? "")) return "steam";
    if (/\/(EA Games|Origin Games)\//i.test(`${dir}/`) || (id === "sims4" && dir.endsWith(".app"))) return "ea";
    if (/\/GOG Galaxy\//i.test(dir)) return "gog";
    if (/\/Epic Games\//i.test(dir)) return "epic";
    if (/\/Rockstar Games\//i.test(dir)) return "rockstar";
    return null;
}

/* The Steam folder a game is in (a library's steamapps parent), else the usual ones. */
function steamFolders(loc) {
    const dir = String(loc.gameDir ?? "");
    const at = dir.search(/[\\/]steamapps[\\/]/i);
    const own = at > 0 ? [dir.slice(0, at)] : [];
    return [...own, ...steamRoots()];
}

/*
 * The display name of whoever last signed in to this Steam: the entry marked MostRecent,
 * else the newest. Null when nobody has. The login name is never read out.
 */
function steamUser(root) {
    let text;
    try {
        text = fs.readFileSync(path.join(root, "config", "loginusers.vdf"), "utf8");
    } catch {
        return null;
    }
    const users = [];
    for (const [, block] of text.matchAll(/"\d{17}"\s*\{([^{}]*)\}/g)) {
        const fields = Object.fromEntries([...block.matchAll(/"(\w+)"\s*"([^"]*)"/g)].map(([, key, value]) => [key, value]));
        users.push({ name: fields.PersonaName || null, recent: fields.MostRecent === "1", at: Number(fields.Timestamp) || 0 });
    }
    const user = users.find((entry) => entry.recent) ?? users.sort((a, b) => b.at - a.at)[0];
    return user ? { name: user.name ? user.name.slice(0, 64) : "Steam user" } : null;
}

/* -> { store, storeName, name, how } for a game in the registry (detect.locate checks the id). */
function storeAccount(id) {
    const loc = detect.locate(id);
    if (!loc.gameDir) {
        return { store: null, storeName: null, name: null, how: "Find the game on this computer to see how it signs in." };
    }
    const store = storeOf(id, loc);
    if (store === "steam") {
        for (const root of steamFolders(loc)) {
            const user = steamUser(root);
            if (user) return { store, storeName: STORES.steam, name: user.name, how: "Last-used local Steam profile, not a verified live session. Sign in or switch accounts in Steam before playing." };
        }
        return { store, storeName: STORES.steam, name: null, how: "Sign in through the Steam app." };
    }
    if (store) return { store, storeName: STORES[store], name: null, how: HOW[store] };
    return { store: null, storeName: null, name: null, how: "This game signs in through the app you installed it with." };
}

module.exports = { storeAccount, steamUser, storeOf, accountTarget };
