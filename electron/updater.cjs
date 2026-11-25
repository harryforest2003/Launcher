/*
 * Keeps the installed launcher up to date, as the Modrinth app does: every push to main is
 * built on GitHub (.github/workflows/build-app.yml) and published as a release. This checks
 * the newest release with a build for this computer now and then, downloads the build for this computer in the
 * background, checks it against the release's update.json, and puts it in place when the
 * launcher quits, so a restart is all it takes. Only the installed app updates: run from
 * source (or a build with no build-info.json) it never checks.
 *
 * A build knows which commit it came from (build-info.json, written by the workflow and by
 * scripts/install-app.cjs). A release replaces it only when the release's commit is a
 * different one made later, so a copy built here from newer code is never swapped back.
 */

const { app, BrowserWindow, ipcMain } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { spawn } = require("child_process");

const REPO = "harryforest2003/Launcher";
// Newest first. The newest with a build for this computer is the one to have, so a system
// whose build failed doesn't hold back the others.
const RELEASES = `https://api.github.com/repos/${REPO}/releases?per_page=15`;
// Release files are served from these and nowhere else; a redirect elsewhere is refused.
const HOSTS = new Set(["api.github.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);
const FIRST_CHECK = 20 * 1000;
const CHECK_EVERY = 2 * 60 * 60 * 1000;
const APP_NAME = "Unity Launcher.app";

let state = { status: "idle", current: null };
let pending = null; // { commit, committed, file } once a verified download is waiting
let checking = null;
// Settles once a download left by an earlier run has been looked at; checks wait for it.
let startup = Promise.resolve();
let relaunch = false;
let applied = false;

function readBuild() {
    try {
        const info = JSON.parse(fs.readFileSync(path.join(__dirname, "build-info.json"), "utf8"));
        return typeof info.commit === "string" && typeof info.committed === "string" ? info : null;
    } catch {
        return null;
    }
}

const updatesDir = () => path.join(app.getPath("userData"), "updates");

function set(change) {
    state = { ...state, ...change };
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("updater:state", state);
    }
}

// The release file this computer runs, or null where the app can't replace itself.
function assetName() {
    if (process.platform === "darwin") {
        return process.arch === "arm64" || app.runningUnderARM64Translation ? "Unity-Launcher-mac-apple-silicon.zip" : "Unity-Launcher-mac-intel.zip";
    }
    if (process.platform === "win32") return "Unity-Launcher-windows-setup.exe";
    if (process.platform === "linux" && process.env.APPIMAGE) return "Unity-Launcher-linux.AppImage";
    return null;
}

// The .app this is running from, on a Mac.
const macBundle = () => path.resolve(process.execPath, "..", "..", "..");

const writable = (target) => {
    try {
        fs.accessSync(target, fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
};

// Why this copy can't replace itself, if it can't.
function cantReplace() {
    if (process.platform === "darwin") {
        const bundle = macBundle();
        if (!bundle.endsWith(".app")) return "This copy isn't an installed app.";
        if (bundle.includes("/AppTranslocation/")) {
            return "macOS is running this copy from a read-only place. Move Unity Launcher into Applications, then open it from there.";
        }
        if (!writable(path.dirname(bundle)) || !writable(bundle)) return `This account can't change ${path.dirname(bundle)}, so updates can't be put in place.`;
    }
    if (process.platform === "linux" && process.env.APPIMAGE && !writable(path.dirname(process.env.APPIMAGE))) {
        return `This account can't change ${path.dirname(process.env.APPIMAGE)}, so updates can't be put in place.`;
    }
    return null;
}

// Fetches over https, following redirects only to GitHub's own hosts.
async function get(url, headers = {}) {
    for (let hop = 0; hop < 6; hop++) {
        const { protocol, hostname } = new URL(url);
        if (protocol !== "https:" || !HOSTS.has(hostname)) throw new Error(`Refused to download from ${hostname}.`);
        const res = await fetch(url, {
            redirect: "manual",
            headers: { "User-Agent": "Unity-Launcher-Updater", ...headers },
            signal: AbortSignal.timeout(30 * 1000),
        });
        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
            url = new URL(res.headers.get("location"), url).toString();
            continue;
        }
        return res;
    }
    throw new Error("Too many redirects.");
}

async function getJson(url, headers) {
    const res = await get(url, headers);
    if (res.status === 404) {
        throw new Error("No release was found. The launcher's GitHub repository has to be public, with at least one build published.");
    }
    if (res.status === 403 || res.status === 429) throw new Error("GitHub is limiting requests for now. The launcher tries again later.");
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
    return res.json();
}

const sha256 = (file) =>
    new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        fs.createReadStream(file)
            .on("data", (chunk) => hash.update(chunk))
            .on("error", reject)
            .on("end", () => resolve(hash.digest("hex")));
    });

// Downloads one release file to dest, checking its size and SHA-256 against update.json.
async function download(url, dest, expected) {
    const part = `${dest}.part`;
    fs.rmSync(part, { force: true });
    const res = await get(url, { Accept: "application/octet-stream" });
    if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`);

    const hash = crypto.createHash("sha256");
    let received = 0;
    let shown = 0;
    const body = Readable.fromWeb(res.body);
    body.on("data", (chunk) => {
        hash.update(chunk);
        received += chunk.length;
        const progress = expected.size ? Math.min(received / expected.size, 1) : 0;
        if (progress - shown >= 0.02) {
            shown = progress;
            set({ status: "downloading", progress });
        }
    });
    await pipeline(body, fs.createWriteStream(part));

    if (received !== expected.size || hash.digest("hex") !== expected.sha256) {
        fs.rmSync(part, { force: true });
        throw new Error("The download didn't match the release's checksum, so it was thrown away. The launcher tries again later.");
    }
    fs.renameSync(part, dest);
}

// A download from an earlier run that's still waiting to go in, if it checks out.
async function waitingDownload(current) {
    try {
        const ready = JSON.parse(fs.readFileSync(path.join(updatesDir(), "ready.json"), "utf8"));
        const file = path.join(updatesDir(), ready.name);
        if (ready.commit === current.commit || ready.name !== assetName() || Date.parse(ready.committed) <= Date.parse(current.committed)) return null;
        if (!fs.existsSync(file) || (await sha256(file)) !== ready.sha256) return null;
        return { ...ready, file };
    } catch {
        return null;
    }
}

async function runCheck() {
    const current = state.current;
    set({ status: "checking", message: undefined });
    try {
        const releases = await getJson(RELEASES, { Accept: "application/vnd.github+json" });
        const name = assetName();
        let found = null;
        for (const release of Array.isArray(releases) ? releases : []) {
            if (release.draft || release.prerelease) continue;
            const asset = release.assets?.find((a) => a.name === name);
            const infoAsset = release.assets?.find((a) => a.name === "update.json");
            if (!asset || !infoAsset) continue;
            const info = await getJson(infoAsset.browser_download_url);
            if (!info.files?.[name]) continue;
            found = { release, asset, info, expected: info.files[name] };
            break;
        }
        if (!found) {
            set({ status: "current", checkedAt: new Date().toISOString(), message: "No release has a build for this computer yet." });
            return;
        }
        const { release, asset, info, expected } = found;
        const latest = { commit: info.commit, committed: info.committed, built: info.built, url: release.html_url };
        const newer = info.commit !== current.commit && Date.parse(info.committed) > Date.parse(current.committed);
        if (!newer) {
            set({ status: "current", latest, checkedAt: new Date().toISOString() });
            return;
        }
        if (pending?.commit === info.commit) {
            set({ status: "ready", latest, checkedAt: new Date().toISOString() });
            return;
        }

        // Only the newest download is kept.
        fs.rmSync(updatesDir(), { recursive: true, force: true });
        fs.mkdirSync(updatesDir(), { recursive: true });
        const file = path.join(updatesDir(), name);
        set({ status: "downloading", latest, progress: 0 });
        await download(asset.browser_download_url, file, expected);
        fs.writeFileSync(
            path.join(updatesDir(), "ready.json"),
            JSON.stringify({ commit: info.commit, committed: info.committed, built: info.built, name, sha256: expected.sha256 }),
        );
        pending = { commit: info.commit, committed: info.committed, file };
        set({ status: "ready", latest, progress: 1, checkedAt: new Date().toISOString() });
        require("./launcherApp.cjs").notify("Launcher update ready", "Restart Unity Launcher to put the new version in.");
    } catch (err) {
        set({ status: pending ? "ready" : "error", message: err.message, checkedAt: new Date().toISOString() });
    }
}

function check() {
    if (state.status === "unsupported") return Promise.resolve(state);
    checking ??= startup.then(runCheck).finally(() => {
        checking = null;
    });
    return checking.then(() => state);
}

/*
 * Puts the downloaded build in place once this process has gone. A small detached script
 * waits for the launcher to exit, swaps the app, and (after Restart) opens it again. If
 * anything fails the old app stays as it was.
 */
function applyOnQuit() {
    if (!pending || applied) return;
    applied = true;
    const { file } = pending;

    if (process.platform === "darwin") {
        const script = [
            'while kill -0 "$UNITY_PID" 2>/dev/null; do sleep 0.3; done',
            'stage="$UNITY_DIR/stage"',
            'rm -rf "$stage" && mkdir -p "$stage"',
            'if ditto -x -k "$UNITY_FILE" "$stage" && [ -d "$stage/$UNITY_NAME" ]; then',
            '  mv "$UNITY_APP" "$UNITY_APP.old" && if mv "$stage/$UNITY_NAME" "$UNITY_APP"; then rm -rf "$UNITY_APP.old"; else mv "$UNITY_APP.old" "$UNITY_APP"; fi',
            '  touch "$UNITY_APP"',
            "fi",
            'rm -rf "$UNITY_DIR"',
            '[ "$UNITY_RELAUNCH" = 1 ] && open "$UNITY_APP"',
        ].join("\n");
        spawn("/bin/bash", ["-c", script], {
            detached: true,
            stdio: "ignore",
            env: {
                PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
                UNITY_PID: String(process.pid),
                UNITY_DIR: updatesDir(),
                UNITY_FILE: file,
                UNITY_NAME: APP_NAME,
                UNITY_APP: macBundle(),
                UNITY_RELAUNCH: relaunch ? "1" : "0",
            },
        }).unref();
        return;
    }

    if (process.platform === "win32") {
        // The installer (one-click, for this user) replaces the app silently, then opens it after Restart.
        const args = ["'/S'", "'--updated'", ...(relaunch ? ["'--force-run'"] : [])].join(",");
        const command = `Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue; Start-Process -FilePath $env:UNITY_FILE -ArgumentList ${args}`;
        spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", command], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            env: { ...process.env, UNITY_FILE: file },
        }).unref();
        return;
    }

    if (process.platform === "linux" && process.env.APPIMAGE) {
        // A running AppImage can be replaced underneath itself: the new file takes its name.
        const target = process.env.APPIMAGE;
        try {
            fs.copyFileSync(file, `${target}.new`);
            fs.chmodSync(`${target}.new`, 0o755);
            fs.renameSync(`${target}.new`, target);
            fs.rmSync(updatesDir(), { recursive: true, force: true });
            if (relaunch) spawn(target, [], { detached: true, stdio: "ignore" }).unref();
        } catch (err) {
            console.warn("Couldn't put the update in place:", err.message);
        }
    }
}

function registerUpdater() {
    ipcMain.handle("updater:state", () => state);
    ipcMain.handle("updater:check", () => check());
    ipcMain.handle("updater:restart", () => {
        if (!pending) return false;
        relaunch = true;
        setImmediate(() => app.quit());
        return true;
    });

    const current = readBuild();
    // The start-up check (scripts/check-app-starts.cjs) runs a copy that mustn't update itself.
    const off = !app.isPackaged ? "Run from source, the launcher doesn't update itself." : process.env.UNITY_NO_UPDATES ? "Updates are off for this copy." : null;
    if (off || !current) {
        state = { status: "unsupported", current, message: off ?? "This build doesn't say which version it is, so it can't be updated. Builds from GitHub can." };
        return;
    }
    const reason = !assetName() ? "Only the Mac app, the Windows install and the Linux AppImage can update themselves." : cantReplace();
    if (reason) {
        state = { status: "unsupported", current, message: reason };
        return;
    }

    state = { status: "idle", current };
    app.on("will-quit", applyOnQuit);

    startup = waitingDownload(current).then((ready) => {
        if (ready) {
            pending = ready;
            set({ status: "ready", latest: { commit: ready.commit, committed: ready.committed, built: ready.built } });
        } else {
            // Applied (or no longer wanted): nothing to keep.
            fs.rmSync(updatesDir(), { recursive: true, force: true });
        }
    });
    setTimeout(check, FIRST_CHECK);
    setInterval(check, CHECK_EVERY).unref();
}

module.exports = { registerUpdater };
