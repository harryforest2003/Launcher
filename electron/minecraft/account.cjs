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

async function freshAccount(stored) {
    if (stored.expiresAt - Date.now() > REFRESH_BEFORE_MS) return stored;

    if (!stored.refreshToken) {
        throw new Error("Your Minecraft sign-in has expired. Sign in again on the Minecraft page.");
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

    if (!stored?.accessToken) {
        throw new Error("Sign in with Microsoft on the Minecraft page first.");
    }

    return (await freshAccount(stored)).accessToken;
}

/*
 * What launch() needs, for the active account. Falls back to an offline-style account so
 * an unauthenticated user still gets a clear result (the game will refuse online play,
 * but the launch itself is well-formed).
 */
async function accountForLaunch(fallbackName = "Player") {
    const stored = readAccount();

    if (stored?.accessToken && stored.uuid) {
        const account = await freshAccount(stored);

        return {
            name: account.name,
            uuid: account.uuid.replace(/-/g, ""),
            accessToken: account.accessToken,
            type: "msa",
            online: true,
        };
    }

    return {
        name: fallbackName,
        // Deterministic offline UUID, same convention other launchers use.
        uuid: "00000000000000000000000000000000",
        accessToken: "0",
        type: "legacy",
        online: false,
    };
}

// Never expose tokens to the page.
const publicOf = (entry, active) => ({ name: entry.name, uuid: entry.uuid, skin: entry.skin, savedAt: entry.savedAt, active });

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
    readAccount,
    clearAccount,
    accountForLaunch,
    publicAccount,
    listAccounts,
    switchAccount,
    removeAccount,
    minecraftAccessToken,
    updateSkin,
};
