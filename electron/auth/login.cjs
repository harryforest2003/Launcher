const fetch = require("node-fetch");

const CLIENT_ID = "00000000402b5328"; 
// Public Minecraft client ID (no Azure setup required)

async function loginMicrosoft() {
    console.log("Starting Microsoft Device Code Flow...");

    // 1. Request device code
    const deviceRes = await fetch(
        "https://login.live.com/oauth20_connect.srf",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                scope: "service::user.auth.xboxlive.com::MBI_SSL",
                response_type: "device_code"
            })
        }
    );

    const deviceData = await deviceRes.json();

    if (!deviceData.user_code) {
        throw new Error("Failed to get device code");
    }

    console.log("\n=== MICROSOFT LOGIN ===");
    console.log("Go to: https://microsoft.com/devicelogin");
    console.log("Enter code:", deviceData.user_code);
    console.log("======================\n");

    const interval = deviceData.interval * 1000;
    const expiresIn = deviceData.expires_in * 1000;
    const start = Date.now();

    // 2. Poll for token
    while (Date.now() - start < expiresIn) {
        await new Promise(r => setTimeout(r, interval));

        const tokenRes = await fetch(
            "https://login.live.com/oauth20_token.srf",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                    device_code: deviceData.device_code
                })
            }
        );

        const tokenData = await tokenRes.json();

        if (tokenData.access_token) {
            console.log("Microsoft login successful!");

            return {
                accessToken: tokenData.access_token
            };
        }

        if (tokenData.error && tokenData.error !== "authorization_pending") {
            throw new Error(tokenData.error_description || "Login failed");
        }
    }

    throw new Error("Login timed out");
}

module.exports = { loginMicrosoft };