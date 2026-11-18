const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

/*
 * Mac versions of games: whether this Mac can run a game's app (Cyberpunk 2077's Mac
 * version is Apple silicon only), and Cyberpunk's two mod loaders there.
 *
 * On a Mac, Cyberpunk only loads redscript mods, and only once redscript's compiler
 * (engine/tools/scc) has compiled r6/scripts: the game doesn't do it itself. Archive mods
 * need archive-loader (Nexus Mods 33616), which patches the game's archives for one session
 * and puts them back when the game quits. Cyber Engine Tweaks, RED4ext, ArchiveXL, TweakXL
 * and Codeware are Windows-only.
 */

const CPU_X86_64 = 0x01000007;
const CPU_ARM64 = 0x0100000c;

/* The app bundle for a game found on a Mac, or null. */
function appFor(game, loc) {
    const dir = loc.gameDir;
    if (!dir) return null;
    if (dir.endsWith(".app")) return dir;
    // The App Store version's folder is inside its app: Cyberpunk2077.app/Contents/Data.
    const inside = dir.match(/^(.*?\.app)\/Contents\//)?.[1];
    if (inside) return inside;
    const named = game.launch?.darwinAppName ? path.join(dir, game.launch.darwinAppName) : null;
    return named && fs.existsSync(named) ? named : null;
}

/* The program inside an app: Info.plist's CFBundleExecutable, else the one in Contents/MacOS. */
function appExecutable(app) {
    const macos = path.join(app, "Contents", "MacOS");
    try {
        const plist = fs.readFileSync(path.join(app, "Contents", "Info.plist"), "utf8");
        const name = plist.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
        if (name && fs.existsSync(path.join(macos, name))) return path.join(macos, name);
    } catch {
        // A binary plist, or none: fall back to Contents/MacOS.
    }
    try {
        const files = fs.readdirSync(macos).filter((name) => !name.startsWith("."));
        const same = files.find((name) => name === path.basename(app, ".app"));
        return same || files.length === 1 ? path.join(macos, same ?? files[0]) : null;
    } catch {
        return null;
    }
}

/* The CPU architectures a Mach-O program is built for: ["arm64", "x86_64"], or null if it can't be read. */
function archsOf(file) {
    let header;
    try {
        const fd = fs.openSync(file, "r");
        header = Buffer.alloc(4096);
        fs.readSync(fd, header, 0, header.length, 0);
        fs.closeSync(fd);
    } catch {
        return null;
    }
    const name = (cpu) => (cpu === CPU_ARM64 ? "arm64" : cpu === CPU_X86_64 ? "x86_64" : `cpu ${cpu}`);
    const fat = header.readUInt32BE(0);
    if (fat === 0xcafebabe || fat === 0xcafebabf) {
        const count = header.readUInt32BE(4);
        const size = fat === 0xcafebabf ? 32 : 20;
        if (count < 1 || count > 16) return null;
        return Array.from({ length: count }, (_, i) => name(header.readUInt32BE(8 + i * size)));
    }
    const thin = header.readUInt32LE(0);
    if (thin === 0xfeedfacf || thin === 0xfeedface) return [name(header.readUInt32LE(4))];
    return null;
}

/* Apple silicon, also when the launcher itself runs as Intel code through Rosetta. */
const appleSilicon = () => process.arch === "arm64" || /apple/i.test(os.cpus()[0]?.model ?? "");

/*
 * Why this Mac can't run the game's app, or null if it can (or it can't be told).
 * An Intel-only app runs on Apple silicon through Rosetta; an Apple-silicon-only one
 * doesn't run on an Intel Mac at all.
 */
function runProblem(game, loc) {
    if (process.platform !== "darwin") return null;
    const app = appFor(game, loc);
    const exe = app && appExecutable(app);
    const archs = exe && archsOf(exe);
    if (!archs?.length) return null;
    if (archs.includes("x86_64") || (archs.includes("arm64") && appleSilicon())) return null;
    if (archs.includes("arm64")) return `${game.name}'s Mac version only runs on Apple silicon (M1 or later), and this Mac has an Intel processor.`;
    return `${game.name}'s Mac version is built for a processor this Mac doesn't have.`;
}

/* ---------------- Cyberpunk 2077 on a Mac ---------------- */

const SCC = "engine/tools/scc";
const LOADER = "archive-loader/bin/archive-loader";
const LOADER_MODS = "archive-loader/mods/enabled";

/* Mods unpacked by the launcher can lose their "may run" bit. */
function ensureExecutable(file) {
    try {
        const mode = fs.statSync(file).mode;
        if ((mode & 0o111) === 0) fs.chmodSync(file, mode | 0o755);
    } catch {
        // Left as it is: running it says what's wrong.
    }
}

/*
 * Compiles r6/scripts with redscript, as its own launch_modded.sh does before starting the
 * game, so added, changed and removed script mods take effect. For "safe" it compiles an
 * empty folder instead, so the game plays without any script mods (the next normal Play
 * compiles them back in). -> "compiled" | null when redscript isn't installed.
 */
function compileScripts(gameDir, { safe = false, timeout = 180000 } = {}) {
    const scc = path.join(gameDir, SCC);
    if (!fs.existsSync(scc)) return Promise.resolve(null);
    const scripts = path.join(gameDir, "r6", "scripts");
    const empty = safe || !fs.existsSync(scripts) ? fs.mkdtempSync(path.join(os.tmpdir(), "unity-redscript-")) : null;
    ensureExecutable(scc);
    return new Promise((resolve, reject) => {
        execFile(scc, ["-compile", empty ?? scripts], { cwd: gameDir, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (empty) fs.rmSync(empty, { recursive: true, force: true });
            if (!error) return resolve("compiled");
            if (error.signal === "SIGKILL" || error.code === "EPERM" || error.code === "EACCES") {
                return reject(new Error(`macOS stopped redscript's compiler (${SCC}) from running. If you trust it, allow it with: xattr -r -d com.apple.quarantine "${path.join(gameDir, "engine", "tools")}"`));
            }
            const said = `${stderr || stdout || ""}`.trim().split("\n").filter(Boolean).pop() ?? error.message;
            reject(new Error(`redscript couldn't compile the script mods: ${said.slice(0, 300)}`));
        });
    });
}

/* archive-loader's program when it's installed and has archive mods to load, else null. */
function archiveLoader(gameDir) {
    const loader = path.join(gameDir, LOADER);
    if (!fs.existsSync(loader)) return null;
    let mods = [];
    try {
        mods = fs.readdirSync(path.join(gameDir, LOADER_MODS)).filter((name) => /\.archive$/i.test(name));
    } catch {
        return null;
    }
    if (!mods.length) return null;
    ensureExecutable(loader);
    return loader;
}

module.exports = { appFor, appExecutable, archsOf, appleSilicon, runProblem, compileScripts, archiveLoader, SCC, LOADER, LOADER_MODS };
