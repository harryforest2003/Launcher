// The reasons Xbox gives for refusing an account, from its XErr field.
const XSTS_ERRORS = {
    2148916233: "This Microsoft account has no Xbox profile yet. Sign in once at xbox.com to create one, then try again.",
    2148916235: "Xbox Live isn't available in this account's country or region.",
    2148916236: "This account needs adult verification on the Xbox site before it can sign in.",
    2148916237: "This account needs adult verification on the Xbox site before it can sign in.",
    2148916238: "This is a child account. An adult needs to add it to a Microsoft family group before it can sign in.",
};

async function authenticateXSTS(xblToken) {

    const res =
        await fetch(

            "https://xsts.auth.xboxlive.com/xsts/authorize",

            {

                method: "POST",

                headers: {

                    "Content-Type":
                        "application/json"

                },

                body: JSON.stringify({

                    Properties: {

                        SandboxId:
                            "RETAIL",

                        UserTokens: [

                            xblToken

                        ]

                    },

                    RelyingParty:
                        "rp://api.minecraftservices.com/",

                    TokenType:
                        "JWT"

                })

            }

        );

    if (!res.ok) {

        const failure = await res.json().catch(() => ({}));

        throw new Error(
            XSTS_ERRORS[failure.XErr] ??
            `Xbox Live refused the sign-in (HTTP ${res.status}).`
        );

    }

    return await res.json();

}

module.exports = {

    authenticateXSTS

};