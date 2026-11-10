const crypto = require("crypto");

function base64url(buffer) {

    return buffer
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

}

function createVerifier() {

    return base64url(
        crypto.randomBytes(64)
    );

}

function createChallenge(verifier) {

    return base64url(

        crypto
            .createHash("sha256")
            .update(verifier)
            .digest()

    );

}

function randomState() {

    return crypto
        .randomBytes(16)
        .toString("hex");

}

module.exports = {

    createVerifier,
    createChallenge,
    randomState

};