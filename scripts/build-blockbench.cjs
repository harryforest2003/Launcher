/*
 * Builds the copy of Blockbench that the launcher opens, from a pinned release of its
 * official source, into vendor/blockbench. Blockbench is GPL-3.0-or-later; its licence
 * and the exact source it came from are copied in beside it.
 *
 * Run it again after changing BLOCKBENCH_TAG: npm run blockbench:build
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BLOCKBENCH_TAG = "v5.2.2";
const BLOCKBENCH_REPO = "https://github.com/JannisX11/blockbench.git";

const repo = path.join(__dirname, "..");
const source = path.join(repo, ".cache", "blockbench-src");
const output = path.join(repo, "vendor", "blockbench");

// What the web version's page loads. The rest of the repository is for building it,
// or for its desktop version.
const SHIPPED = [
  "index.html",
  "dist",
  "css",
  "font",
  "assets",
  "lang",
  "lib",
  "content",
  "favicon.png",
  "icon.png",
  "icon_full.png",
  "LICENSE.MD",
];

function run(command, args, cwd, env = {}) {
  // On Windows npm is a .cmd script, which Node only starts through a shell.
  const shell = process.platform === "win32" && command === "npm";
  execFileSync(command, args, { cwd, stdio: "inherit", shell, env: { ...process.env, ...env } });
}

function checkedOutTag() {
  try {
    return execFileSync("git", ["describe", "--tags", "--exact-match"], { cwd: source, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

if (checkedOutTag() !== BLOCKBENCH_TAG) {
  fs.rmSync(source, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(source), { recursive: true });
  run("git", ["clone", "--quiet", "--depth", "1", "--branch", BLOCKBENCH_TAG, BLOCKBENCH_REPO, source], repo);
}

// Its own install scripts and Electron download are only for its desktop version.
run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], source, {
  ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
});
run("node", ["build.js", "--target=web"], source);

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const item of SHIPPED) {
  const from = path.join(source, item);
  if (!fs.existsSync(from)) throw new Error(`Blockbench's build has no ${item}.`);
  fs.cpSync(from, path.join(output, item), { recursive: true });
}

// A source map for debugging Blockbench itself, twice the size of everything else.
fs.rmSync(path.join(output, "dist", "bundle.js.map"), { force: true });

const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();

fs.writeFileSync(
  path.join(output, "SOURCE.txt"),
  [
    `Blockbench ${BLOCKBENCH_TAG}, built for Unity Launcher from its official source.`,
    `Source: ${BLOCKBENCH_REPO.replace(/\.git$/, "")}/tree/${BLOCKBENCH_TAG}`,
    `Commit: ${commit}`,
    "Licence: GPL-3.0-or-later, in LICENSE.MD.",
    "",
  ].join("\n")
);

console.log(`\nBlockbench ${BLOCKBENCH_TAG} built into ${path.relative(repo, output)}`);
