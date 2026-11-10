const fs = require("fs");
const path = require("path");
const https = require("https");

async function download(url, destination) {
    await fs.promises.mkdir(
        path.dirname(destination),
        { recursive: true }
    );

    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destination);

        https.get(url, response => {
            response.pipe(file);

            file.on("finish", () => {
                file.close(resolve);
            });
        }).on("error", err => {
            fs.unlink(destination, () => {});
            reject(err);
        });
    });
}

module.exports = {
    download,
};