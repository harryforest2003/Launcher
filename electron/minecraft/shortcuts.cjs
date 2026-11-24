const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { app, shell, nativeImage } = require("electron");

/*
 * A desktop shortcut that starts one instance. Opening it starts the installed launcher
 * with --launch-instance=<name> (or, if it's open already, hands it that argument), and
 * the launcher plays it as the Library's Play button would. Only the installed app can
 * make one: run from source, a shortcut would open Electron instead.
 *
 *   Windows: a .lnk to the launcher's .exe.
 *   macOS:   a small AppleScript app that runs `open -n -b <the launcher> --args ...`;
 *            the copy that starts passes the argument to the open one and quits.
 *   Linux:   a .desktop file.
 */

const LAUNCH_ARG = "--launch-instance=";
const BUNDLE_ID = "com.unitylauncher.launcher";

/* The instance a shortcut asked for, from a launch's arguments. */
function launchArg(argv) {
    const arg = (argv ?? []).find((item) => typeof item === "string" && item.startsWith(LAUNCH_ARG));
    if (!arg) return null;
    const name = arg.slice(LAUNCH_ARG.length).replace(/^"(.*)"$/, "$1").trim();
    return name && name.length <= 200 ? name : null;
}

const run = (file, args) =>
    new Promise((resolve, reject) =>
        execFile(file, args, { timeout: 30000 }, (err, _stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve()))
    );

// A file name the desktop accepts on every system.
const fileName = (name) => name.replace(/[/\\:*?"<>|\x00-\x1f]/g, "-").replace(/^\.+/, "").trim().slice(0, 120) || "Minecraft instance";

/* The picture as a square PNG of that size, or null when the instance has none. */
function pictureAt(picture, size) {
    if (!picture || !fs.existsSync(picture)) return null;
    const image = nativeImage.createFromPath(picture);
    if (image.isEmpty()) return null;
    return image.resize({ width: size, height: size, quality: "best" }).toPNG();
}

/* A Windows .ico holding one 256 px PNG (Windows Vista and later read these). */
function icoFrom(png) {
    const header = Buffer.alloc(22);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // an icon
    header.writeUInt16LE(1, 4); // one image
    header.writeUInt8(0, 6); // 0 means 256 wide
    header.writeUInt8(0, 7); // and high
    header.writeUInt8(0, 8); // no palette
    header.writeUInt8(0, 9);
    header.writeUInt16LE(1, 10); // planes
    header.writeUInt16LE(32, 12); // bits per pixel
    header.writeUInt32LE(png.length, 14);
    header.writeUInt32LE(22, 18); // where the PNG starts
    return Buffer.concat([header, png]);
}

function windowsShortcut({ name, folder, picture, desktop }) {
    const file = path.join(desktop, `${fileName(name)}.lnk`);
    const png = pictureAt(picture, 256);
    let icon = process.execPath;
    if (png) {
        icon = path.join(folder, "shortcut.ico");
        fs.writeFileSync(icon, icoFrom(png));
    }
    const replaced = fs.existsSync(file);
    const ok = shell.writeShortcutLink(file, replaced ? "replace" : "create", {
        target: process.execPath,
        args: `${LAUNCH_ARG}"${name}"`,
        description: `Play ${name} in Unity Launcher`,
        icon,
        iconIndex: 0,
    });
    if (!ok) throw new Error("Windows didn't make the shortcut. Check you can save files on your desktop.");
    return { path: file, replaced };
}

// Inside a .desktop file's quoted Exec argument: \ " ` $ are escaped, % doubled.
const execQuote = (text) => `"${text.replace(/[\\"`$]/g, "\\$&").replace(/%/g, "%%")}"`;
// Other .desktop values: no new lines.
const desktopValue = (text) => text.replace(/[\r\n]+/g, " ");

async function linuxShortcut({ name, picture, desktop }) {
    const file = path.join(desktop, `${fileName(name)}.desktop`);
    const replaced = fs.existsSync(file);
    const program = process.env.APPIMAGE || process.execPath;
    const lines = [
        "[Desktop Entry]",
        "Type=Application",
        `Name=${desktopValue(name)}`,
        `Comment=${desktopValue(`Play ${name} in Unity Launcher`)}`,
        `Exec=${execQuote(program)} ${execQuote(`${LAUNCH_ARG}${name}`)}`,
        ...(picture && fs.existsSync(picture) ? [`Icon=${desktopValue(picture)}`] : []),
        "Terminal=false",
        "Categories=Game;",
        "",
    ];
    fs.writeFileSync(file, lines.join("\n"), { mode: 0o755 });
    fs.chmodSync(file, 0o755);
    // GNOME only opens desktop files it's told are trusted; elsewhere this does nothing.
    await run("gio", ["set", file, "metadata::trusted", "true"]).catch(() => {});
    return { path: file, replaced };
}

// AppleScript string: backslashes and quotes escaped.
const appleString = (text) => `"${text.replace(/[\\"]/g, "\\$&")}"`;

async function macShortcut({ name, picture, desktop }) {
    let file = path.join(desktop, `${fileName(name)}.app`);
    let replaced = false;
    if (fs.existsSync(file)) {
        // Only ever replace a shortcut this made: an AppleScript app. Anything else keeps its name.
        if (fs.existsSync(path.join(file, "Contents", "Resources", "Scripts", "main.scpt"))) {
            fs.rmSync(file, { recursive: true, force: true });
            replaced = true;
        } else {
            let n = 2;
            while (fs.existsSync(path.join(desktop, `${fileName(name)} ${n}.app`))) n++;
            file = path.join(desktop, `${fileName(name)} ${n}.app`);
        }
    }
    const command = `open -n -b ${BUNDLE_ID} --args `;
    const script = `do shell script ${appleString(command)} & quoted form of ${appleString(`${LAUNCH_ARG}${name}`)}`;
    await run("/usr/bin/osacompile", ["-o", file, "-e", script]);

    // Its icon: the instance's picture, or the launcher's own.
    const icon = path.join(file, "Contents", "Resources", "applet.icns");
    const png = pictureAt(picture, 512);
    const own = path.join(process.resourcesPath, "icon.icns");
    try {
        if (png) {
            const temp = path.join(os.tmpdir(), `unity-shortcut-${process.pid}-${Date.now()}.png`);
            fs.writeFileSync(temp, png);
            try {
                await run("/usr/bin/sips", ["-s", "format", "icns", temp, "--out", icon]);
            } finally {
                fs.rmSync(temp, { force: true });
            }
        } else if (fs.existsSync(own)) {
            fs.copyFileSync(own, icon);
        }
    } catch {
        // The script's own icon is fine.
    }
    // Changing its icon breaks the app's signature, so it's signed again (for this Mac only).
    await run("/usr/bin/codesign", ["--force", "--deep", "-s", "-", file]).catch(() => {});
    const now = new Date();
    fs.utimesSync(file, now, now);
    return { path: file, replaced };
}

/* Puts a shortcut that starts this instance on the desktop. */
async function desktopShortcut({ name, folder, picture }) {
    if (!app.isPackaged) throw new Error("Desktop shortcuts work in the installed launcher, not when it's run from source.");
    const desktop = app.getPath("desktop");
    if (!fs.existsSync(desktop)) throw new Error("There's no desktop folder to put the shortcut in.");
    const details = { name, folder, picture, desktop };
    if (process.platform === "win32") return windowsShortcut(details);
    if (process.platform === "darwin") return macShortcut(details);
    return linuxShortcut(details);
}

module.exports = { desktopShortcut, launchArg, icoFrom, execQuote, appleString, LAUNCH_ARG };
