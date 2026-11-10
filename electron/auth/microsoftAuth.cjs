const config = require("./config.cjs");
const oauth = require("./oauth.cjs");

async function requestToken(fields) {
    const res = await fetch(config.TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: config.CLIENT_ID,
            scope: config.SCOPES.join(" "),
            ...fields,
        }),
    });

    if (!res.ok) {
        const failure = await res.json().catch(() => ({}));
        const reason = failure.error_description?.split(/\r?\n/)[0] ?? "";
        const err = new Error(`Microsoft sign-in failed (HTTP ${res.status}). ${reason}`.trim());
        err.code = failure.error;
        throw err;
    }

    return res.json();
}

async function loginMicrosoft() {
    const { code, verifier } = await oauth.beginOAuth();

    return requestToken({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.REDIRECT_URI,
        code_verifier: verifier,
    });
}

function refreshMicrosoft(refreshToken) {
    return requestToken({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
    });
}

module.exports = {
    loginMicrosoft,
    refreshMicrosoft,
};
