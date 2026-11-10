const fs = require("fs");
const path = require("path");

/*
 * API keys. None are in the source code, so the repo can be public.
 *
 * A key comes from an environment variable if one is set (handy for development
 * and CI), and otherwise from <userData>/secrets.json. That file holds only
 * ciphertext: Electron's safeStorage encrypts it with a key kept in the Mac's
 * Keychain, Windows' DPAPI or the Linux keyring, so it is useless if copied.
 *
 * Decrypted keys stay in the main process. The renderer can set a key or ask
 * whether one exists, but is never given one back.
 */

/*
 * Personal ones are the player's own tokens, set in Settings. CurseForge's key belongs
 * to the launcher, not a player, so it can't be seen or set from the app at all. It
 * comes from the environment, or one already saved on this computer.
 */
const SECRETS = {
    curseforge: { env: "CURSEFORGE_API_KEY", label: "CurseForge", personal: false },
    nexus: { env: "NEXUS_API_KEY", label: "Nexus Mods", personal: true },
    github: { env: "GITHUB_TOKEN", label: "GitHub", personal: true },
    modrinth: { env: "MODRINTH_TOKEN", label: "Modrinth", personal: true },
};

function isPersonal(name) {
    return SECRETS[name]?.personal === true;
}

const cache = new Map();

function electron() {
    // Outside Electron, require("electron") gives the path to its binary instead.
    const loaded = require("electron");
    return typeof loaded === "object" ? loaded : null;
}

function storePath() {
    return path.join(electron().app.getPath("userData"), "secrets.json");
}

function readStore() {
    try {
        return JSON.parse(fs.readFileSync(storePath(), "utf8"));
    } catch {
        return {};
    }
}

function writeStore(store) {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(store, null, 2), { mode: 0o600 });
}

function assertKnown(name) {
    if (!SECRETS[name]) throw new Error(`"${name}" is not an API key this app uses.`);
}

function getSecret(name) {
    assertKnown(name);

    const fromEnvironment = process.env[SECRETS[name].env];
    if (fromEnvironment) return fromEnvironment;

    if (cache.has(name)) return cache.get(name);

    const app = electron();
    if (!app) return null;

    const stored = readStore()[name];
    if (!stored) return null;

    try {
        const value = app.safeStorage.decryptString(Buffer.from(stored, "base64"));
        cache.set(name, value);
        return value;
    } catch (err) {
        // Copied from another machine, or the system refused access to its keychain.
        console.warn(`The saved ${SECRETS[name].label} key could not be decrypted:`, err.message);
        return null;
    }
}

function hasSecret(name) {
    return Boolean(getSecret(name));
}

function setSecret(name, value) {
    assertKnown(name);

    const { safeStorage } = electron();

    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
            `This system has no keychain to protect the key with. ` +
            `Set the ${SECRETS[name].env} environment variable instead.`
        );
    }

    const store = readStore();
    store[name] = safeStorage.encryptString(value).toString("base64");
    writeStore(store);
    cache.set(name, value);
}

function clearSecret(name) {
    assertKnown(name);

    const store = readStore();
    delete store[name];
    writeStore(store);
    cache.delete(name);
}

/* Enough of a key to recognise it by, and never enough to use it. */
function mask(value) {
    return value.length >= 16 ? `${value.slice(0, 4)}••••••••${value.slice(-4)}` : "••••••••••••";
}

/*
 * What the pages may know: whether each key exists and from where, and for a personal
 * token a masked copy to show. Keys themselves stay here.
 */
function secretStatus() {
    return Object.fromEntries(
        Object.entries(SECRETS).map(([name, { env, personal }]) => {
            const value = getSecret(name);
            return [
                name,
                {
                    set: Boolean(value),
                    fromEnvironment: Boolean(process.env[env]),
                    hint: value && personal ? mask(value) : null,
                },
            ];
        })
    );
}

module.exports = {
    getSecret,
    hasSecret,
    setSecret,
    clearSecret,
    secretStatus,
    isPersonal,
};
