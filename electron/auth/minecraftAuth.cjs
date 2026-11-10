async function authenticateMinecraft(xstsToken, userHash) {

    const res = await fetch(
        "https://api.minecraftservices.com/authentication/login_with_xbox",
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({

                identityToken:
                    `XBL3.0 x=${userHash};${xstsToken}`

            })
        }
    );

    if (!res.ok) {
        const failure = await res.json().catch(() => ({}));
        const reason = failure.errorMessage ?? "";

        // Every launcher's Azure app has to be approved by Mojang for this one step.
        if (/app registration/i.test(reason)) {
            const err = new Error(
                "Microsoft signed you in, but Mojang hasn't approved this launcher's app for " +
                "Minecraft sign-in yet. Request approval for its client ID at https://aka.ms/mce-reviewappid."
            );
            err.code = "APP_NOT_APPROVED";
            throw err;
        }

        throw new Error(`Minecraft sign-in failed (HTTP ${res.status}). ${reason}`.trim());
    }

    return await res.json();
}

module.exports = {
    authenticateMinecraft
};