async function authenticateXbox(accessToken) {

    const res =
        await fetch(

            "https://user.auth.xboxlive.com/user/authenticate",

            {

                method: "POST",

                headers: {

                    "Content-Type":
                        "application/json",

                    Accept:
                        "application/json"

                },

                body: JSON.stringify({

                    Properties: {

                        AuthMethod: "RPS",

                        SiteName:
                            "user.auth.xboxlive.com",

                        RpsTicket:
                            `d=${accessToken}`

                    },

                    RelyingParty:
                        "http://auth.xboxlive.com",

                    TokenType:
                        "JWT"

                })

            }

        );

    if (!res.ok) {

        throw new Error(`Xbox Live sign-in failed (HTTP ${res.status}).`);

    }

    return await res.json();

}

module.exports = {

    authenticateXbox

};