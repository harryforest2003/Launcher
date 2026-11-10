const { shell } = require("electron");
const config = require("./config.cjs");
const pkce = require("./pkce.cjs");
const oauthServer = require("./oauthServer.cjs");

async function beginOAuth() {
    const verifier = pkce.createVerifier();
    const challenge = pkce.createChallenge(verifier);
    const state = pkce.randomState();

    const params = new URLSearchParams();

    params.set("client_id", config.CLIENT_ID);
    params.set("response_type", "code");
    params.set("redirect_uri", config.REDIRECT_URI);
    params.set("response_mode", "query");
    params.set("scope", config.SCOPES.join(" "));
    params.set("code_challenge", challenge);
    params.set("code_challenge_method", "S256");
    params.set("state", state);

    // Otherwise Microsoft reuses whichever account the browser last signed in with,
    // and there's no way to pick a different one from here.
    params.set("prompt", "select_account");

    const url =
        config.AUTHORIZE_URL +
        "?" +
        params.toString();

    // Listening first, so a quick sign-in can't arrive before anything is waiting.
    const waiting = oauthServer.waitForCode(config.CALLBACK_PORT, state);

    await shell.openExternal(url);

    return {
        code: await waiting,
        verifier
    };
}

module.exports = {
    beginOAuth
};