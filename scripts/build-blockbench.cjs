/*
 * Builds the model editor the launcher opens, Blockbench, from its source in blockbench/
 * into vendor/blockbench, which the app packs inside itself. Nothing is downloaded from
 * Blockbench: only the build tools its package.json lists, from npm.
 *
 * Blockbench is by JannisX11 and its contributors, under GPL-3.0-or-later. The copy in
 * blockbench/ is its editor, with the start screen and desktop-app parts taken out
 * (blockbench/README.md says what changed). Its licence goes in beside the build.
 *
 * Run it again after changing anything in blockbench/: npm run blockbench:build
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repo = path.join(__dirname, "..");
const source = path.join(repo, "blockbench");
const output = path.join(repo, "vendor", "blockbench");

// What the editor's page loads. The rest of blockbench/ is for building it.
const SHIPPED = ["index.html", "dist", "css", "font", "assets", "lang", "lib", "favicon.png", "icon.png", "LICENSE.MD"];

function run(command, args, cwd, env = {}) {
  // On Windows npm is a .cmd script, which Node only starts through a shell.
  const shell = process.platform === "win32" && command === "npm";
  execFileSync(command, args, { cwd, stdio: "inherit", shell, env: { ...process.env, ...env } });
}

// Its install scripts and Electron download are only for Blockbench's desktop version.
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

// Build leftovers: a source map for debugging, twice the size of everything else, and
// a record of the build's inputs.
for (const leftover of ["bundle.js.map", "esbuild-metafile.json"]) {
  fs.rmSync(path.join(output, "dist", leftover), { force: true });
}

const { version } = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));

fs.writeFileSync(
  path.join(output, "SOURCE.txt"),
  [
    `Blockbench ${version}, by JannisX11 and contributors, built for Unity Launcher.`,
    "Built from blockbench/ in Unity Launcher's source, which is Blockbench's editor from",
    `https://github.com/JannisX11/blockbench/tree/v${version}, with its start screen and`,
    "desktop-app parts taken out.",
    "Licence: GPL-3.0-or-later, in LICENSE.MD.",
    "",
  ].join("\n")
);

console.log(`\nBlockbench ${version} built into ${path.relative(repo, output)}`);
