const { spawn } = require("child_process");

function launchMinecraft(javaPath, args) {
    spawn(javaPath, args, {
        detached: true,
        stdio: "ignore",
    }).unref();
}

module.exports = {
    launchMinecraft,
};