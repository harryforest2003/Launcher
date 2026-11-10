const fs = require("fs");
const path = require("path");
const { app } = require("electron");

/*
 * Running from source and the installed app share one profile under one name, so
 * keys, sign-in and settings carry over. The keychain entry protecting them goes by
 * the app's name too, which is why the name has to match as well as the folder.
 */
const PROFILE_NAME = "unity";

// Outside Electron, as in plain Node tests, require("electron") gives no app.
if (app) {
    app.setName(PROFILE_NAME);

    if (!app.commandLine.hasSwitch("user-data-dir")) {
        app.setPath("userData", path.join(app.getPath("appData"), PROFILE_NAME));
    }
}

/*
 * The folder named in instances-folder.txt in the profile, if there is one. Otherwise,
 * running from source keeps instances beside the code, as it always has, and an
 * installed app, which is read-only, keeps them in its profile.
 */
function instancesDir() {
    if (!app) return path.join(__dirname, "../instances");

    const userData = app.getPath("userData");

    try {
        const chosen = fs.readFileSync(path.join(userData, "instances-folder.txt"), "utf8").trim();
        if (chosen) return chosen;
    } catch {
        // None chosen.
    }

    return app.isPackaged ? path.join(userData, "instances") : path.join(__dirname, "../instances");
}

module.exports = { instancesDir };
