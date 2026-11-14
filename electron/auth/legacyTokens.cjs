const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");

/*
 * Earlier versions of the launcher, and the sign-in library it used then
 * (prismarine-auth), kept Microsoft sign-in tokens as plain text in a cache folder:
 * cache/auth/microsoft.json and cache/<id>_live-cache.json, _xbl-, _mca-, _msal-,
 * _bed-cache.json. No code reads or writes them now. Anything that could act as the
 * player is moved, once, into encrypted storage (safeStorage, as secrets.cjs and
 * accounts use), and the plain-text file is deleted after the encrypted copy is written.
 *
 * Runs at start-up for the real profile only: a copy started on a throwaway profile
 * (--user-data-dir, as tests do) leaves them alone.
 */

const TOKEN_FILE = /^(microsoft\.json|[\w-]+_(live|xbl|mca|msal|bed)-cache\.json)$/i;

/* The cache folders earlier versions wrote to: beside the code when run from source, and the profile. */
function legacyFolders() {
    const folders = [path.join(app.getPath("userData"), "cache")];
    if (!app.isPackaged) folders.push(path.join(__dirname, "..", "..", "cache"));
    return folders;
}

function legacyFiles() {
    const found = [];
    for (const root of legacyFolders()) {
        for (const dir of [root, path.join(root, "auth")]) {
            let names = [];
            try {
                names = fs.readdirSync(dir);
            } catch {
                continue;
            }
            for (const name of names) {
                const file = path.join(dir, name);
                if (TOKEN_FILE.test(name) && fs.statSync(file).isFile()) found.push(file);
            }
        }
    }
    return found;
}

const storePath = () => path.join(app.getPath("userData"), "legacy-sign-in.enc");

/* -> how many plain-text token files were moved into encrypted storage. */
function moveLegacyTokens() {
    if (app.commandLine.hasSwitch("user-data-dir")) return 0;

    const files = legacyFiles();
    if (!files.length) return 0;

    if (!safeStorage.isEncryptionAvailable()) {
        console.warn("Old sign-in files are stored as plain text, and this system has no keychain to move them into yet.");
        return 0;
    }

    let kept = { files: {} };
    try {
        kept = JSON.parse(safeStorage.decryptString(fs.readFileSync(storePath())));
    } catch {
        // None kept yet.
    }

    for (const file of files) kept.files[file] = { movedAt: new Date().toISOString(), text: fs.readFileSync(file, "utf8") };

    // The encrypted copy is written in full before any plain-text file goes.
    const temporary = `${storePath()}.tmp`;
    fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(kept)), { mode: 0o600 });
    fs.renameSync(temporary, storePath());

    for (const file of files) fs.rmSync(file, { force: true });
    console.log(`Moved ${files.length} old sign-in file(s) from plain text into encrypted storage.`);
    return files.length;
}

module.exports = { moveLegacyTokens, legacyFiles };
