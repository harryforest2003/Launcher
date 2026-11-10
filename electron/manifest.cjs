const https = require("https");

function fetch(url) {
    return new Promise((resolve, reject) => {

        https.get(url, res => {

            let body = "";

            res.on("data", d => body += d);

            res.on("end", () => {
                resolve(JSON.parse(body));
            });

        }).on("error", reject);

    });
}

async function getManifest() {

    return await fetch(
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
    );

}

module.exports = {
    getManifest,
    fetch
};