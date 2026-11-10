const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");
const { refreshLogin } = require("../auth/index.cjs");

/*
 * Stores the signed-in Minecraft account so launching can pass a real access token.
 * The file holds only ciphertext, encrypted with a key from the system's keychain,
 * because these tokens can act as the player. Decrypted tokens stay in this process.
 */

// A launch can run for hours, so a token this close to expiring gets replaced first.
const REFRESH_BEFORE_MS = 10 * 60 * 1000;

function accountPath() {
    return path.join(app.getPath("userData"), "account.enc");
}

function writeAccount(account) {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("This system has no keychain to protect your sign-in with.");
    }

    fs.mkdirSync(path.dirname(accountPath()), { recursive: true });
    fs.writeFileSync(accountPath(), safeStorage.encryptString(JSON.stringify(account)), { mode: 0o600 });

    return account;
}

function saveAccount(login) {
    return writeAccount({
        name: login.profile.name,
        uuid: login.profile.id,
        skin: login.skin ?? null,
        accessToken: login.minecraft.access_token,
        expiresAt: Date.now() + (login.minecraft.expires_in ?? 86400) * 1000,
        refreshToken: login.microsoft.refresh_token ?? null,
        type: "msa",
        savedAt: new Date().toISOString(),
    });
}

/* Keeps the saved skin in step after it's changed, so the launcher shows the new one. */
function updateSkin(url) {
    const stored = readAccount();
    if (stored && stored.skin !== url) writeAccount({ ...stored, skin: url });
}

function readAccount() {
    try {
        return JSON.parse(safeStorage.decryptString(fs.readFileSync(accountPath())));
    } catch {
        return null;
    }
}

function clearAccount() {
    fs.rmSync(accountPath(), { force: true });
}

async function freshAccount(stored) {
    if (stored.expiresAt - Date.now() > REFRESH_BEFORE_MS) return stored;

    if (!stored.refreshToken) {
        throw new Error("Your Minecraft sign-in has expired. Sign in again on the Minecraft page.");
    }

    try {
        return saveAccount(await refreshLogin(stored.refreshToken));
    } catch (err) {
        // No internet: the game can still run single-player on the token it has.
        if (err instanceof TypeError) return stored;

        throw new Error(`Your Minecraft sign-in has expired and couldn't be renewed. Sign in again to launch. (${err.message})`);
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
 * What launch() needs. Falls back to an offline-style account so an
 * unauthenticated user still gets a clear result (the game will refuse
 * online play, but the launch itself is well-formed).
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

// Never expose the token to the renderer.
function publicAccount() {
    const stored = readAccount();

    if (!stored) return null;

    return {
        name: stored.name,
        uuid: stored.uuid,
        skin: stored.skin,
        savedAt: stored.savedAt,
    };
}

module.exports = {
    saveAccount,
    readAccount,
    clearAccount,
    accountForLaunch,
    publicAccount,
    minecraftAccessToken,
    updateSkin,
};
