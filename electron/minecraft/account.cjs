const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");
const { refreshLogin } = require("../auth/index.cjs");

/*
 * The signed-in Minecraft accounts, one of them active, so launching can pass a real
 * access token. The file holds only ciphertext, encrypted with a key from the system's
 * keychain, because these tokens can act as the player. Decrypted tokens stay in this
 * process. Bedrock uses the same Microsoft accounts, so there's no separate kind.
 */

// A launch can run for hours, so a token this close to expiring gets replaced first.
const REFRESH_BEFORE_MS = 10 * 60 * 1000;

const storePath = () => path.join(app.getPath("userData"), "accounts.enc");
// Where the single account lived before there could be several.
const legacyPath = () => path.join(app.getPath("userData"), "account.enc");

function decrypt(file) {
    try {
        return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    } catch {
        return null;
    }
}

function readStore() {
    const store = decrypt(storePath());
    if (store && Array.isArray(store.accounts)) return store;

    // Moves an account saved before there could be several into the list.
    const legacy = decrypt(legacyPath());
    return legacy?.uuid ? { active: legacy.uuid, accounts: [legacy] } : { active: null, accounts: [] };
}

function writeStore(store) {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("This system has no keychain to protect your sign-in with.");
    }
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), safeStorage.encryptString(JSON.stringify(store)), { mode: 0o600 });
    fs.rmSync(legacyPath(), { force: true });
    return store;
}

const activeOf = (store) => store.accounts.find((entry) => entry.uuid === store.active) ?? null;

/* Adds or renews an account from a Microsoft sign-in, and makes it the active one. */
function saveAccount(login) {
    const account = {
        name: login.profile.name,
        uuid: login.profile.id,
        skin: login.skin ?? null,
        accessToken: login.minecraft.access_token,
        expiresAt: Date.now() + (login.minecraft.expires_in ?? 86400) * 1000,
        refreshToken: login.microsoft.refresh_token ?? null,
        type: "msa",
        savedAt: new Date().toISOString(),
    };

    const store = readStore();
    writeStore({ active: account.uuid, accounts: [...store.accounts.filter((entry) => entry.uuid !== account.uuid), account] });
    return account;
}

/*
 * The id offline servers and other launchers give a name: a version 3 UUID of
 * "OfflinePlayer:<name>", so worlds keep the same player data between launchers.
 */
function offlineUuid(name) {
    const bytes = crypto.createHash("md5").update(`OfflinePlayer:${name}`, "utf8").digest();
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return bytes.toString("hex");
}

/*
 * A test account without Microsoft: plays single-player and offline-mode servers under this
 * name, with no skin and no token. Made active, like a sign-in.
 */
function addOfflineAccount(value) {
    const name = typeof value === "string" ? value.trim() : "";
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
        throw new Error("A player name is 3 to 16 letters, numbers or underscores.");
    }
    const account = { name, uuid: offlineUuid(name), skin: null, type: "offline", savedAt: new Date().toISOString() };
    const store = readStore();
    writeStore({ active: account.uuid, accounts: [...store.accounts.filter((entry) => entry.uuid !== account.uuid), account] });
    return account;
}

const isOffline = (entry) => entry?.type === "offline";

/* Renewed tokens for one account, without changing which is active. */
function replaceAccount(account) {
    const store = readStore();
    writeStore({ ...store, accounts: store.accounts.map((entry) => (entry.uuid === account.uuid ? account : entry)) });
    return account;
}

/* Keeps the saved skin in step after it's changed, so the launcher shows the new one. */
function updateSkin(url) {
    const stored = readAccount();
    if (stored && stored.skin !== url) replaceAccount({ ...stored, skin: url });
}

/* The active account, tokens and all. Only for this process. */
function readAccount() {
    return activeOf(readStore());
}

/* Signs the active account out; another, if there is one, becomes active. */
function clearAccount() {
    const store = readStore();
    if (store.active) removeAccount(store.active);
}

function removeAccount(uuid) {
    const store = readStore();
    const accounts = store.accounts.filter((entry) => entry.uuid !== uuid);
    const active = store.active === uuid ? accounts[accounts.length - 1]?.uuid ?? null : store.active;
    writeStore({ active, accounts });
}

function switchAccount(uuid) {
    const store = readStore();
    if (!store.accounts.some((entry) => entry.uuid === uuid)) throw new Error("That account isn't signed in any more.");
    writeStore({ ...store, active: uuid });
}

/*
 * Each account renews on its own: two games starting together as two players each renew
 * their own token, and two renewals of the same account share one request (Microsoft
 * replaces the refresh token on every renewal, so a second one would use a spent token).
 */
const renewing = new Map();

function freshAccount(stored) {
    if (stored.expiresAt - Date.now() > REFRESH_BEFORE_MS) return Promise.resolve(stored);

    if (!renewing.has(stored.uuid)) {
        renewing.set(stored.uuid, renew(stored).finally(() => renewing.delete(stored.uuid)));
    }
    return renewing.get(stored.uuid);
}

async function renew(stored) {
    if (!stored.refreshToken) {
        throw new Error(`${stored.name}'s Minecraft sign-in has expired. Sign in again on the Minecraft page.`);
    }

    try {
        const login = await refreshLogin(stored.refreshToken);
        return replaceAccount({
            ...stored,
            name: login.profile.name,
            skin: login.skin ?? stored.skin,
            accessToken: login.minecraft.access_token,
            expiresAt: Date.now() + (login.minecraft.expires_in ?? 86400) * 1000,
            refreshToken: login.microsoft.refresh_token ?? stored.refreshToken,
        });
    } catch (err) {
        // No internet: the game can still run single-player on the token it has.
        if (err instanceof TypeError) return stored;

        throw new Error(`${stored.name}'s Minecraft sign-in has expired and couldn't be renewed. Sign in again to launch. (${err.message})`);
    }
}

/* A current token for Mojang's own API, renewed first if it's about to run out. */
async function minecraftAccessToken() {
    const stored = readAccount();

    if (isOffline(stored)) {
        throw new Error(`${stored.name} is an offline test account, so it has no skin or profile to change. Use a Microsoft account for that.`);
    }
    if (!stored?.accessToken) {
        throw new Error("Sign in with Microsoft on the Minecraft page first.");
    }

    return (await freshAccount(stored)).accessToken;
}

/*
 * The id of a signed-in account, as a page sent it, or null for "the active one". Anything
 * else (not text, too long, or no saved account has it) is refused.
 */
function checkAccountId(value) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || value.length > 64) throw new Error("That isn't an account id.");
    if (!readStore().accounts.some((entry) => entry.uuid === value)) throw new Error("That account isn't signed in any more.");
    return value;
}

/*
 * What launch() needs, for the account with this id (checkAccountId first), or the active
 * one. Falls back to an offline-style account so an unauthenticated user still gets a clear
 * result (the game will refuse online play, but the launch itself is well-formed).
 * id is the saved account's own id, which pages know it by.
 */
async function accountForLaunch(fallbackName = "Player", accountId = null) {
    const store = readStore();
    const stored = accountId ? store.accounts.find((entry) => entry.uuid === accountId) : activeOf(store);
    if (accountId && !stored) throw new Error("That account isn't signed in any more.");

    if (isOffline(stored)) {
        // Its own id, so a page can tell which account a game plays as; online stays false
        // so it's never held to one game at a time.
        return { id: stored.uuid, name: stored.name, uuid: stored.uuid, accessToken: "0", type: "legacy", online: false };
    }

    if (stored?.accessToken && stored.uuid) {
        const account = await freshAccount(stored);

        return {
            id: account.uuid,
            name: account.name,
            uuid: account.uuid.replace(/-/g, ""),
            accessToken: account.accessToken,
            type: "msa",
            online: true,
        };
    }

    return {
        id: null,
        name: fallbackName,
        // Deterministic offline UUID, same convention other launchers use.
        uuid: "00000000000000000000000000000000",
        accessToken: "0",
        type: "legacy",
        online: false,
    };
}

// Never expose tokens to the page.
const publicOf = (entry, active) => ({ name: entry.name, uuid: entry.uuid, skin: entry.skin, savedAt: entry.savedAt, active, ...(isOffline(entry) ? { offline: true } : {}) });

function publicAccount() {
    const stored = readAccount();
    return stored ? publicOf(stored, true) : null;
}

function listAccounts() {
    const store = readStore();
    return store.accounts.map((entry) => publicOf(entry, entry.uuid === store.active));
}

module.exports = {
    saveAccount,
    addOfflineAccount,
    offlineUuid,
    readAccount,
    clearAccount,
    accountForLaunch,
    checkAccountId,
    publicAccount,
    listAccounts,
    switchAccount,
    removeAccount,
    minecraftAccessToken,
    updateSkin,
};
