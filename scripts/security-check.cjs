/*
 * The launcher's security check: Electronegativity (Doyensec's scanner for Electron apps)
 * over the app's own code, and npm audit over its dependencies. Exits 1 if either finds
 * anything. Run it with npm run security:check, or:
 *   node scripts/security-check.cjs [folder for the reports]
 * The reports, the copy that's scanned and the scanner's own working files all go in that
 * folder (release/security-check unless one is given); nothing outside it is touched.
 *
 * What's scanned is what the app runs: electron/ (the main process, its preloads and the
 * bridge into Blockbench), src/ (the page), index.html, scripts/, and package.json with its
 * lockfile. Not scanned: node_modules, the built output (dist, release), Blockbench's own
 * source (blockbench/) and build (vendor/blockbench), which is third-party code that runs
 * in a view with no Node, no network and only four bridge messages, and cyber-arsenal/,
 * which isn't part of the launcher.
 *
 * Electronegativity reads only .js/.jsx/.ts/.tsx/.html files, so the main process's .cjs
 * and .mjs files are copied in as .js (line numbers are unchanged) rather than skipped.
 *
 * Its check for Electron security fixes reads a list of releases from an archived feed
 * that ends at Electron 22 (December 2022), so it can only say "Unknown Electron release"
 * for any Electron since. The scanner keeps that list in its temporary folder, so this runs
 * it with a temporary folder of its own (inside the report folder) holding a current list,
 * from Electron's own release index (releases.electronjs.org), npm's dist-tags and, for any
 * newer release on the same Electron line, its release notes from GitHub. Without a
 * connection the scanner fetches its archived list as usual, and its check says so.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ELECTRONEGATIVITY = "@doyensec/electronegativity@1.10.3";
const out = path.resolve(process.argv[2] ?? path.join(ROOT, "release", "security-check"));
fs.mkdirSync(out, { recursive: true });
// The scanner's temporary folder (its saved list of Electron releases lives there).
const scannerTemp = path.join(out, "scanner-tmp");
fs.mkdirSync(scannerTemp, { recursive: true });

const SCANNED = ["electron", "src", "scripts", "index.html", "package.json", "package-lock.json"];
const SOURCE = /\.(c|m)?js$|\.jsx$|\.tsx?$|\.html?$|\.json$/i;

/* A copy of what's scanned, with .cjs and .mjs named .js so the scanner reads them. */
function stage() {
    const dir = path.join(out, "scanned-copy");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const copy = (from, to) => {
        const stat = fs.statSync(from);
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(from)) {
                if (name === "node_modules" || name.startsWith(".")) continue;
                copy(path.join(from, name), path.join(to, name));
            }
        } else if (SOURCE.test(from)) {
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.copyFileSync(from, to.replace(/\.(c|m)js$/i, ".js"));
        }
    };
    for (const entry of SCANNED) {
        const from = path.join(ROOT, entry);
        if (fs.existsSync(from)) copy(from, path.join(dir, entry));
    }
    return dir;
}

/* ---------------- current Electron release data for the scanner ---------------- */

const json = async (url, headers = {}) => {
    const res = await fetch(url, { headers: { "User-Agent": "unity-launcher-security-check", ...headers }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return res.json();
};

async function refreshReleaseList() {
    // The version the lockfile pins, which is what the scanner reads too.
    const installed = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8")).packages["node_modules/electron"].version;

    // The scanner keys its saved copy on this feed's etag (its first 40 hex digits).
    const head = await fetch("https://raw.githubusercontent.com/electron/releases/master/index.json", { method: "HEAD", signal: AbortSignal.timeout(30000) });
    const etag = String(head.headers.get("etag") ?? "").match(/[0-9a-f]{40}/)?.[0];
    if (!etag) throw new Error("the archived feed's etag wasn't recognised");

    const [releases, distTags] = await Promise.all([
        json("https://releases.electronjs.org/releases.json"),
        json("https://registry.npmjs.org/-/package/electron/dist-tags"),
    ]);

    const tagsByVersion = new Map();
    for (const [tag, version] of Object.entries(distTags)) tagsByVersion.set(version, [...(tagsByVersion.get(version) ?? []), tag]);
    // "latest" first, as the scanner reads only the first tag.
    for (const tags of tagsByVersion.values()) tags.sort((a, b) => (a === "latest" ? -1 : b === "latest" ? 1 : 0));

    // Release notes for any newer release on the installed version's line, so security fixes in them are seen.
    const [major, minor] = installed.split(".").map(Number);
    const newer = releases.filter((r) => {
        const [ma, mi, pa] = r.version.split(/[.-]/).map(Number);
        return ma === major && mi === minor && !/-/.test(r.version) && pa > Number(installed.split(".")[2]);
    });
    const bodies = new Map();
    for (const release of newer.slice(0, 20)) {
        try {
            bodies.set(release.version, (await json(`https://api.github.com/repos/electron/electron/releases/tags/v${release.version}`, { Accept: "application/vnd.github+json" })).body ?? "");
        } catch {
            // Without notes a fix can't be seen: say so rather than pass quietly.
            bodies.set(release.version, "# Security (release notes couldn't be read: check this release by hand)");
        }
    }

    const list = releases.map((r) => ({ version: r.version, npm_dist_tags: tagsByVersion.get(r.version) ?? [], body: bodies.get(r.version) ?? "" }));

    // Only in the scanner's own temporary folder, inside the report folder.
    for (const name of fs.readdirSync(scannerTemp)) if (/^releases\.[0-9a-f]+\.json$/.test(name)) fs.rmSync(path.join(scannerTemp, name), { force: true });
    fs.writeFileSync(path.join(scannerTemp, `releases.${etag}.json`), JSON.stringify(list));

    return { installed, latest: distTags.latest, newerOnLine: newer.map((r) => r.version) };
}

/* ---------------- running the checks ---------------- */

function run(command, args, options = {}) {
    return spawnSync(command, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32", ...options });
}

function readCsv(file) {
    if (!fs.existsSync(file)) return null;
    const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).slice(1).filter(Boolean);
    return lines.map((line) => line.split(",").slice(0, 5).map((cell) => cell.replace(/^"|"$/g, "").trim()));
}

(async () => {
    let failed = false;

    try {
        const { installed, latest, newerOnLine } = await refreshReleaseList();
        console.log(`Electron ${installed} installed; npm's latest is ${latest}.${newerOnLine.length ? ` Newer on its line: ${newerOnLine.join(", ")}.` : ""}`);
    } catch (err) {
        console.log(`Couldn't refresh the scanner's list of Electron releases (${err.message}); it uses its own, which ends at Electron 22.`);
    }

    const staged = stage();
    const csv = path.join(out, "electronegativity.csv");
    fs.rmSync(csv, { force: true });
    const scannerEnv = { ...process.env, TMPDIR: scannerTemp, TMP: scannerTemp, TEMP: scannerTemp };
    const scan = run("npx", ["-y", ELECTRONEGATIVITY, "-i", staged, "-r", "-o", csv], { env: scannerEnv });
    fs.writeFileSync(path.join(out, "electronegativity.log"), `${scan.stdout ?? ""}\n${scan.stderr ?? ""}`);
    fs.rmSync(staged, { recursive: true, force: true });

    const findings = readCsv(csv);
    if (!findings) {
        console.log("Electronegativity didn't run: see electronegativity.log.");
        failed = true;
    } else {
        console.log(`Electronegativity: ${findings.length} finding${findings.length === 1 ? "" : "s"}.`);
        for (const [id, severity, confidence, file, location] of findings) console.log(`  ${id} (${severity}, ${confidence}) ${file}:${location}`);
        if (findings.length) failed = true;
    }

    const audit = run("npm", ["audit", "--json"]);
    fs.writeFileSync(path.join(out, "npm-audit.json"), audit.stdout ?? "");
    try {
        const counts = JSON.parse(audit.stdout).metadata.vulnerabilities;
        const total = Object.entries(counts).filter(([level]) => level !== "total").reduce((sum, [, n]) => sum + n, 0);
        console.log(`npm audit: ${total} vulnerabilit${total === 1 ? "y" : "ies"}.`);
        if (total) failed = true;
    } catch {
        console.log("npm audit didn't answer: see npm-audit.json.");
        failed = true;
    }

    console.log(`Reports: ${out}`);
    process.exit(failed ? 1 : 0);
})();
