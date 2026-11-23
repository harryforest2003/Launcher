/*
 * Builds the launcher and installs it in Applications, replacing any earlier copy.
 * Run it again after making changes: npm run app:install
 */

const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repo = path.join(__dirname, "..");
const APP = "Unity Launcher.app";
const target = path.join("/Applications", APP);
const bin = (name) => path.join(repo, "node_modules/.bin", name);

function run(command, ...args) {
  execFileSync(command, args, { cwd: repo, stdio: "inherit" });
}

if (process.platform !== "darwin") {
  console.error("This script installs into the Mac's Applications folder. Use `npm run dist` elsewhere.");
  process.exit(1);
}

// Replacing the app underneath itself would break it while it's running.
if (spawnSync("pgrep", ["-f", `${target}/Contents/MacOS/`]).status === 0) {
  console.error("Unity Launcher is open. Quit it, then run this again.");
  process.exit(1);
}

// Blockbench is built from its own source once, then reused.
if (!fs.existsSync(path.join(repo, "vendor", "blockbench", "index.html"))) {
  run("node", path.join(repo, "scripts", "build-blockbench.cjs"));
}

run(bin("tsc"), "-b");
run(bin("vite"), "build");

// Which commit this copy was built from, so it updates only to a release made from a later
// commit (electron/updater.cjs). Removed again after, so no other build carries it by mistake.
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const buildInfo = path.join(repo, "electron", "build-info.json");
fs.writeFileSync(
  buildInfo,
  JSON.stringify({ commit: git("rev-parse", "HEAD"), committed: git("log", "-1", "--format=%cI"), built: new Date().toISOString() }) + "\n",
);
try {
  run(bin("electron-builder"), "--mac", "dir");
} finally {
  fs.rmSync(buildInfo, { force: true });
}

const built = ["mac", "mac-arm64", "mac-universal"]
  .map((folder) => path.join(repo, "release", folder, APP))
  .find((candidate) => fs.existsSync(candidate));

if (!built) {
  console.error("The build finished, but the app wasn't where it was expected in release/.");
  process.exit(1);
}

// Copied beside the old one first, so a failed copy can't leave no app at all.
const staging = `${target}.new`;
fs.rmSync(staging, { recursive: true, force: true });
run("ditto", built, staging);
fs.rmSync(target, { recursive: true, force: true });
fs.renameSync(staging, target);

// Tell Finder and the Dock the app changed, so they show its current icon.
spawnSync("touch", [target]);
spawnSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", target]);

// On a machine that already has instances here, the app keeps using them.
const profile = path.join(os.homedir(), "Library/Application Support/unity");
const pointer = path.join(profile, "instances-folder.txt");
const instances = path.join(repo, "instances");

if (!fs.existsSync(pointer) && fs.existsSync(instances)) {
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(pointer, `${instances}\n`);
}

console.log(`\nInstalled ${target}`);
