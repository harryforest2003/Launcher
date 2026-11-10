const os = require("os");
const path = require("path");

function getMinecraftDirectory() {
    switch (os.platform()) {
        case "win32":
            return path.join(process.env.APPDATA, ".minecraft");

        case "darwin":
            return path.join(
                os.homedir(),
                "Library/Application Support/minecraft"
            );

        case "linux":
            return path.join(os.homedir(), ".minecraft");
    }
}

module.exports = {
    getMinecraftDirectory,
};