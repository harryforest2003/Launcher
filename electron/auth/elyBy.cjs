const crypto = require("crypto");

/*
 * Ely.by accounts: a free account service with its own skins, which many servers accept
 * instead of Microsoft. Sign-in is Mojang's old "Yggdrasil" scheme: the player's login and
 * password go to Ely.by once, in exchange for a token kept in the keychain-encrypted account
 * file. The password itself is never stored. An account with two-step sign-in adds its
 * code to the password, as Ely.by asks. The game reaches Ely.by through authlib-injector
 * (authlibInjector.cjs).
 */

const AUTH = "https://authserver.ely.by/auth";
const SKINS = "https://skinsystem.ely.by/skins";

/* Raised when Ely.by wants the code from the player's authenticator app as well. */
class NeedsCode extends Error {
    constructor() {
        super("This Ely.by account uses two-step sign-in. Enter the code from your authenticator app.");
        this.code = "ELY_NEEDS_CODE";
    }
}

async function post(endpoint, body, { request = fetch } = {}) {
    const res = await request(`${AUTH}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20 * 1000),
    });
    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = null;
    }
    return { ok: res.ok, status: res.status, data };
}

/* Ely.by's error, in words for the player. */
function failure(status, data) {
    const said = String(data?.errorMessage ?? "");
    if (/two factor/i.test(said)) return new NeedsCode();
    if (/invalid credentials|password/i.test(said)) return new Error("Ely.by didn't accept that login and password.");
    if (/token/i.test(said)) return new Error("This Ely.by sign-in has expired. Sign in again.");
    if (status === 429) return new Error("Ely.by is asking for a pause after several tries. Wait a minute and try again.");
    return new Error(said ? `Ely.by said: ${said}` : `Ely.by answered HTTP ${status}.`);
}

/* The account's details from Ely.by's answer to a sign-in or renewal. */
function accountFrom(data, clientToken) {
    const profile = data?.selectedProfile;
    if (!data?.accessToken || !profile?.id || !profile?.name) {
        throw new Error("This Ely.by account has no Minecraft player yet. Create one on ely.by first.");
    }
    return {
        name: profile.name,
        uuid: profile.id.replace(/-/g, ""),
        accessToken: data.accessToken,
        clientToken: data.clientToken || clientToken,
        skin: `${SKINS}/${encodeURIComponent(profile.name)}.png`,
    };
}

/* Signs in with a login (player name or email) and password, plus a code when asked for one. */
async function signIn(login, password, code = "", options = {}) {
    const username = String(login ?? "").trim();
    const secret = String(password ?? "");
    const totp = String(code ?? "").replace(/\s/g, "");
    if (!username || !secret) throw new Error("Enter your Ely.by login and password.");
    if (totp && !/^\d{6,8}$/.test(totp)) throw new Error("The code from your authenticator app is 6 digits.");

    const clientToken = crypto.randomUUID().replace(/-/g, "");
    const { ok, status, data } = await post(
        "authenticate",
        { username, password: totp ? `${secret}:${totp}` : secret, clientToken, requestUser: true },
        options
    );
    if (!ok) throw failure(status, data);
    return accountFrom(data, clientToken);
}

/* Whether a token still works. */
async function isValid(accessToken, options = {}) {
    const { ok } = await post("validate", { accessToken }, options);
    return ok;
}

/* A new token for an old one; Ely.by keeps the old one renewable for a while after it stops working. */
async function renew(accessToken, clientToken, options = {}) {
    const { ok, status, data } = await post("refresh", { accessToken, clientToken, requestUser: true }, options);
    if (!ok) throw failure(status, data);
    return accountFrom(data, clientToken);
}

/* Signs a token out at Ely.by, so it stops working. Failures are ignored. */
async function signOut(accessToken, clientToken, options = {}) {
    try {
        await post("invalidate", { accessToken, clientToken }, options);
    } catch {
        // Offline: the token runs out on its own.
    }
}

module.exports = { signIn, isValid, renew, signOut, failure, accountFrom, NeedsCode };
