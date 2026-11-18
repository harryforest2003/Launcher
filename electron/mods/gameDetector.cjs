const fs = require("fs");
const os = require("os");
const path = require("path");

const { GAMES, bySteamAppId, getGame } = require("./gameRegistry.cjs");

const home = os.homedir();
const platform = process.platform;

/* =========================================================
   STEAM
========================================================= */

function steamRoots() {
    // Escape hatch for Steam installed somewhere non-standard (and what the
    // detector tests point at). Colon/semicolon separated.
    const extra = (process.env.UNITY_STEAM_ROOTS || "")
        .split(path.delimiter)
        .filter(Boolean);

    if (platform === "darwin") {
        return [
            ...extra,
            path.join(home, "Library", "Application Support", "Steam"),
        ];
    }

    if (platform === "win32") {
        return [
            ...extra,
            "C:\\Program Files (x86)\\Steam",
            "C:\\Program Files\\Steam",
            path.join(home, "Steam"),
        ];
    }

    // linux
    return [
        ...extra,
        path.join(home, ".steam", "steam"),
        path.join(home, ".local", "share", "Steam"),
    ];
}

/*
 * Steam spreads games across "library folders". libraryfolders.vdf lists
 * them. It is Valve's KeyValues format, but we only need the "path"
 * values, so a targeted regex beats pulling in a VDF parser.
 */
function steamLibraries() {
    const libs = [];

    for (const root of steamRoots()) {
        if (!fs.existsSync(root)) continue;

        libs.push(path.join(root, "steamapps"));

        const vdf = path.join(root, "steamapps", "libraryfolders.vdf");
        if (!fs.existsSync(vdf)) continue;

        try {
            const text = fs.readFileSync(vdf, "utf8");

            for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) {
                const p = path.join(m[1].replace(/\\\\/g, "\\"), "steamapps");
                if (!libs.includes(p)) libs.push(p);
            }
        } catch {
            // unreadable library file, skip it
        }
    }

    return libs.filter(l => fs.existsSync(l));
}

/*
 * Each installed Steam game has an appmanifest_<appid>.acf holding its
 * appid and the folder name under common/.
 */
function scanSteam() {
    const found = [];

    for (const lib of steamLibraries()) {
        let entries;

        try {
            entries = fs.readdirSync(lib);
        } catch {
            continue;
        }

        for (const entry of entries) {
            const m = entry.match(/^appmanifest_(\d+)\.acf$/);
            if (!m) continue;

            const game = bySteamAppId(m[1]);
            if (!game) continue;

            try {
                const text = fs.readFileSync(path.join(lib, entry), "utf8");
                const dirMatch = text.match(/"installdir"\s+"([^"]+)"/);
                if (!dirMatch) continue;

                const installPath = path.join(lib, "common", dirMatch[1]);
                if (!fs.existsSync(installPath)) continue;

                found.push({ game, installPath, source: "Steam" });
            } catch {
                // skip malformed manifest
            }
        }
    }

    return found;
}

/* =========================================================
   EPIC GAMES
========================================================= */

function epicManifestDir() {
    if (platform === "win32") {
        return "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests";
    }

    if (platform === "darwin") {
        return path.join(
            home,
            "Library", "Application Support",
            "Epic", "EpicGamesLauncher", "Data", "Manifests"
        );
    }

    return null;
}

function scanEpic() {
    const dir = epicManifestDir();
    if (!dir || !fs.existsSync(dir)) return [];

    const found = [];

    let files;
    try {
        files = fs.readdirSync(dir).filter(f => f.endsWith(".item"));
    } catch {
        return [];
    }

    for (const file of files) {
        try {
            const data = JSON.parse(
                fs.readFileSync(path.join(dir, file), "utf8")
            );

            const name = (data.DisplayName || "").toLowerCase();
            const installPath = data.InstallLocation;

            if (!name || !installPath || !fs.existsSync(installPath)) continue;

            // The exact name first, then the longest name it contains, so
            // "Red Dead Redemption 2" is never taken for "Red Dead Redemption".
            const candidates = GAMES.filter(g => !g.notOnPC);
            const game =
                candidates.find(g => g.name.toLowerCase() === name) ||
                candidates
                    .filter(g => name.includes(g.name.toLowerCase()))
                    .sort((a, b) => b.name.length - a.name.length)[0];

            if (game) found.push({ game, installPath, source: "Epic" });

        } catch {
            // skip malformed manifest
        }
    }

    return found;
}

/* =========================================================
   DIRECT PROBES (EA app, Rockstar, standalone installs)
========================================================= */

function scanProbes() {
    const found = [];

    for (const game of GAMES) {
        const probes = game.probes?.[platform];
        if (!probes) continue;

        for (const probe of probes) {
            if (fs.existsSync(probe)) {
                found.push({ game, installPath: probe, source: "Installed" });
                break;
            }
        }
    }

    return found;
}

/* =========================================================
   MOD DIRECTORY RESOLUTION
========================================================= */

/*
 * A game's mod folder is either an absolute per-platform path (Sims 4
 * keeps mods in Documents) or a path relative to the install dir.
 */
function resolveModDir(game, installPath) {
    const spec = game.modDir;
    if (!spec) return null;

    if (spec.relative && installPath) {
        return path.join(installPath, ...spec.relative);
    }

    for (const candidate of spec[platform] ?? []) {
        if (fs.existsSync(candidate)) return candidate;
    }

    // Nothing exists yet — return the first candidate so it can be created.
    return spec[platform]?.[0] ?? null;
}

/* =========================================================
   PUBLIC API
========================================================= */

function detectGames() {
    const results = [
        ...scanSteam(),
        ...scanEpic(),
        ...scanProbes(),
    ];

    // A game can be found by more than one scanner; keep the first hit.
    const seen = new Set();
    const games = [];

    for (const { game, installPath, source } of results) {
        if (seen.has(game.id)) continue;
        seen.add(game.id);

        const modDir = resolveModDir(game, installPath);

        games.push({
            id: game.id,
            name: game.name,
            installPath,
            modDir,
            modDirExists: modDir ? fs.existsSync(modDir) : false,
            source,
            providers: game.providers ?? {},
            modExtensions: game.modExtensions ?? [],
            notes: game.notes ?? null,
            windowsOnlyModding: !!game.windowsOnlyModding,
            windowsOnly: !!game.windowsOnly,
            managedByInstances: !!game.managedByInstances,
            detected: true,
        });
    }

    // A game can be moddable without being detected (Sims 4 whose Mods
    // folder exists but whose install probe missed). Surface those too.
    for (const game of GAMES) {
        if (seen.has(game.id) || game.managedByInstances) continue;

        const modDir = resolveModDir(game, null);
        if (!modDir || !fs.existsSync(modDir)) continue;

        games.push({
            id: game.id,
            name: game.name,
            installPath: null,
            modDir,
            modDirExists: true,
            source: "Mods folder",
            providers: game.providers ?? {},
            modExtensions: game.modExtensions ?? [],
            notes: game.notes ?? null,
            windowsOnlyModding: !!game.windowsOnlyModding,
            windowsOnly: !!game.windowsOnly,
            managedByInstances: false,
            detected: true,
        });
    }

    return games.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
    detectGames,
    resolveModDir,
    getGame,
    steamLibraries,
    steamRoots,
};
