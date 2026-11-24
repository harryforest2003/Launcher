const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { getGame } = require("./registry.cjs");
const { locate } = require("./detect.cjs");
const { dataDir, readSettings, writeSettings } = require("./storage.cjs");
const archive = require("./archive.cjs");
const { downloadFile } = require("../minecraft/net.cjs");
const { USER_AGENT, remembered } = require("./sources/http.cjs");

/*
 * ReShade and ENB for a game: post-processing put beside the game's exe, where the game
 * loads it in place of a Windows graphics DLL. ReShade comes from reshade.me (its setup holds
 * the DLLs in a zip) with shaders from GitHub; ENB from the zip the person downloads from
 * enbdev.com, which doesn't allow downloads from anywhere but its own pages. Only files put
 * in here are taken out again, and nothing already there is overwritten.
 *
 *   settings.graphics[gameId] = {
 *     reshade: { version, api, dir, dll, sha1, packages, files: [paths under dir], off, at },
 *     enb: { version, dir, files: [paths under dir], hashes: { file: sha1 }, kept: [inis], off, at },
 *   }
 */

const TARGETS = {
    sims4: { dir: "Game/Bin", api: "dxgi" },
    gtav: { dir: "", api: "dxgi", enb: /gta-?v|gta5/i },
    skyrimse: { dir: "", api: "dxgi", enb: /skyrim-?se|tesskyrimse|skyrimspecial/i },
    fallout4: { dir: "", api: "dxgi", enb: /fallout-?4/i },
    cyberpunk2077: { dir: "bin/x64", api: "dxgi" },
    stardew: { dir: "", api: "opengl32" },
};

// The DLL names ReShade can go in as, and what each is for.
const APIS = {
    dxgi: "DirectX 10, 11 or 12",
    d3d11: "DirectX 11 (when dxgi.dll is taken)",
    d3d12: "DirectX 12",
    d3d9: "DirectX 9",
    opengl32: "OpenGL",
};

const PACKAGES = {
    standard: { name: "Standard effects", url: "https://github.com/crosire/reshade-shaders/archive/refs/heads/slim.zip" },
    sweetfx: { name: "SweetFX (SMAA, Vibrance, LumaSharpen, Curves...)", url: "https://github.com/CeeJayDK/SweetFX/archive/refs/heads/master.zip" },
};

const ENB_SITE = "http://enbdev.com";
const SHADERS = "reshade-shaders";

const cacheDir = () => path.join(dataDir(), "_cache", "graphics");
const sha1Of = (file) => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
const lower = (name) => name.toLowerCase();

function stateOf(gameId) {
    return readSettings().graphics?.[gameId] ?? {};
}

function saveState(gameId, kind, value) {
    const settings = readSettings();
    settings.graphics ??= {};
    settings.graphics[gameId] ??= {};
    if (value) settings.graphics[gameId][kind] = value;
    else delete settings.graphics[gameId][kind];
    if (!Object.keys(settings.graphics[gameId]).length) delete settings.graphics[gameId];
    writeSettings(settings);
}

/*
 * Where the game's exe is, so where these go: { dir, api, enb } or { why } when they can't
 * go in (a Mac, the game not found).
 */
function targetOf(gameId) {
    const game = getGame(gameId);
    if (!game) throw new Error(`Unknown game "${gameId}".`);
    if (process.platform !== "win32") return { why: "ReShade and ENB work only with games on Windows." };
    const loc = locate(gameId);
    const known = TARGETS[gameId];
    if (known) {
        if (!loc.found || !loc.gameDir) return { why: `${game.name} wasn't found. Choose its folder in Settings first.` };
        return { dir: path.join(loc.gameDir, known.dir), api: known.api, enb: known.enb ?? null };
    }
    // A game added by hand: beside the exe it starts with.
    if (game.generic && loc.launchChosen && loc.launchExe) return { dir: path.dirname(loc.launchExe), api: "dxgi", enb: null };
    return { why: game.generic ? "Choose the game's .exe (Settings → How it starts) so ReShade knows where to go." : `${game.name} has no ReShade support here.` };
}

/* ---------------- ReShade ---------------- */

/* The newest ReShade on reshade.me: { version, url }. Kept for a few hours. */
function latestReshade() {
    return remembered("reshade:latest", 6 * 60 * 60 * 1000, async () => {
        const res = await fetch("https://reshade.me/", { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`reshade.me answered ${res.status}.`);
        const page = await res.text();
        // The plain build: the "Addon" one is for single-player games only.
        const found = page.match(/downloads\/ReShade_Setup_(\d+(?:\.\d+)+)\.exe/);
        if (!found) throw new Error("reshade.me's download link wasn't found.");
        return { version: found[1], url: `https://reshade.me/downloads/ReShade_Setup_${found[1]}.exe` };
    });
}

/*
 * The zip inside ReShade's setup: its end-of-directory record says how long the zip is, so
 * where in the exe it starts.
 */
function embeddedZip(buffer) {
    const from = Math.max(0, buffer.length - 65557);
    for (let at = buffer.length - 22; at >= from; at -= 1) {
        if (buffer.readUInt32LE(at) !== 0x06054b50) continue;
        const size = buffer.readUInt32LE(at + 12);
        const offset = buffer.readUInt32LE(at + 16);
        const start = at - size - offset;
        // Up to the record's end: a signed exe has its signature after the zip.
        if (start >= 0 && buffer.readUInt32LE(start) === 0x04034b50) return buffer.subarray(start, at + 22 + buffer.readUInt16LE(at + 20));
    }
    throw new Error("ReShade's setup didn't have the files it should. Try again later.");
}

/* ReShade64.dll from the setup, kept in the launcher's cache. -> path */
async function reshadeDll(version, url) {
    const dll = path.join(cacheDir(), `ReShade64-${version}.dll`);
    if (fs.existsSync(dll)) return dll;
    const setup = path.join(cacheDir(), `ReShade_Setup_${version}.exe`);
    await downloadFile(url, setup, { hosts: ["reshade.me"] });
    const zip = path.join(cacheDir(), `ReShade_${version}.zip`);
    fs.writeFileSync(zip, embeddedZip(fs.readFileSync(setup)));
    const into = archive.tempDir("unity-reshade-");
    try {
        await archive.unzip(zip, into);
        const found = path.join(into, "ReShade64.dll");
        if (!fs.existsSync(found)) throw new Error("ReShade's setup had no ReShade64.dll.");
        fs.copyFileSync(found, dll);
    } finally {
        fs.rmSync(into, { recursive: true, force: true });
        fs.rmSync(zip, { force: true });
        fs.rmSync(setup, { force: true });
    }
    return dll;
}

/* A shader package's Shaders and Textures, unpacked into a temporary folder. -> { dir, cleanup, files } */
async function shaderPackage(id) {
    const pkg = PACKAGES[id];
    const zip = path.join(cacheDir(), `shaders-${id}.zip`);
    // Fetched again after a day, for new effects.
    const fresh = fs.existsSync(zip) && Date.now() - fs.statSync(zip).mtimeMs < 24 * 60 * 60 * 1000;
    if (!fresh) {
        fs.rmSync(zip, { force: true });
        await downloadFile(pkg.url, zip, { hosts: ["github.com"] });
    }
    const { dir, cleanup } = await archive.unpack(zip);
    // Inside a "<repo>-<branch>" folder: Shaders/... and Textures/...
    const files = archive
        .listFiles(dir)
        .map((rel) => ({ rel, inside: rel.split("/").slice(1).join("/") }))
        .filter(({ inside }) => /^(Shaders|Textures)\//i.test(inside));
    return { dir, cleanup, files };
}

const isReshadeIni = (name) => /^reshade(preset)?\.ini$/i.test(name);

/* What's already beside the game's exe that these would clash with. */
function present(dir) {
    const names = new Map();
    try {
        for (const name of fs.readdirSync(dir)) names.set(lower(name), name);
    } catch {
        // No folder: nothing there.
    }
    return names;
}

const DEFAULT_INI = (preset) =>
    [
        "[GENERAL]",
        `EffectSearchPaths=.\\${SHADERS}\\Shaders\\**`,
        `TextureSearchPaths=.\\${SHADERS}\\Textures\\**`,
        `PresetPath=.\\${preset}`,
        "",
        "[INPUT]",
        // Home opens ReShade's window.
        "KeyOverlay=36,0,0,0",
        "",
    ].join("\r\n");

/*
 * Puts ReShade in (or updates it): its DLL under the name the game loads (api), the chosen
 * shader packages, and a ReShade.ini pointing at them when there isn't one.
 */
async function installReshade(gameId, { api, packages = ["standard", "sweetfx"] } = {}) {
    const target = targetOf(gameId);
    if (target.why) throw new Error(target.why);
    const before = stateOf(gameId).reshade ?? null;
    const name = api && APIS[api] ? api : (before?.api ?? target.api);
    const dllName = `${name}.dll`;
    const there = present(target.dir);
    const ours = before && before.dir === target.dir ? before : null;
    const oursAt = ours ? path.join(target.dir, ours.off ? `${ours.dll}.off` : ours.dll) : null;
    // Another file by that name (a mod's, or a ReShade put in by hand) is never replaced.
    if (there.has(lower(dllName)) && !(ours && lower(ours.dll) === lower(dllName))) {
        // DirectX 11 games load either name.
        const other = { dxgi: "d3d11", d3d11: "dxgi" }[name];
        const free = target.api === "dxgi" && other && !there.has(`${other}.dll`);
        throw new Error(`${dllName} is already beside the game's exe (another mod's, or ReShade put in by hand), so ReShade wasn't put in.${free ? ` Try it as ${other}.dll instead.` : ""}`);
    }
    const latest = await latestReshade();
    const dll = await reshadeDll(latest.version, latest.url);

    const chosen = packages.filter((id) => PACKAGES[id]);
    const files = new Set(ours?.files ?? []);
    for (const id of chosen) {
        const pkg = await shaderPackage(id);
        try {
            for (const { rel, inside } of pkg.files) {
                const to = path.join(target.dir, SHADERS, inside);
                const relTo = `${SHADERS}/${inside}`;
                // A shader someone put there themselves stays theirs.
                if (fs.existsSync(to) && !files.has(relTo)) continue;
                fs.mkdirSync(path.dirname(to), { recursive: true });
                fs.copyFileSync(path.join(pkg.dir, rel), to);
                files.add(relTo);
            }
        } finally {
            pkg.cleanup();
        }
    }

    const ini = path.join(target.dir, "ReShade.ini");
    if (!fs.existsSync(ini)) {
        fs.writeFileSync(ini, DEFAULT_INI("ReShadePreset.ini"));
        files.add("ReShade.ini");
    }

    // The old DLL out, the new one in (still off, if it was turned off).
    if (oursAt && fs.existsSync(oursAt) && sha1Of(oursAt) === ours.sha1) fs.rmSync(oursAt);
    const off = Boolean(ours?.off);
    const at = path.join(target.dir, off ? `${dllName}.off` : dllName);
    fs.mkdirSync(target.dir, { recursive: true });
    fs.copyFileSync(dll, at);
    const value = {
        version: latest.version,
        api: name,
        dir: target.dir,
        dll: dllName,
        sha1: sha1Of(at),
        packages: [...new Set([...(ours?.packages ?? []), ...chosen])],
        files: [...files].sort(),
        off,
        at: new Date().toISOString(),
    };
    saveState(gameId, "reshade", value);
    return status(gameId);
}

/* Turns ReShade off (its DLL renamed, so the game doesn't load it) or back on. */
function setReshadeOn(gameId, on) {
    const state = stateOf(gameId).reshade;
    if (!state) throw new Error("ReShade isn't installed for this game.");
    const live = path.join(state.dir, state.dll);
    const parked = `${live}.off`;
    if (on && state.off) {
        if (fs.existsSync(live)) throw new Error(`${state.dll} is beside the game's exe again (another mod's?), so ReShade stays off.`);
        fs.renameSync(parked, live);
    } else if (!on && !state.off) {
        if (fs.existsSync(live)) fs.renameSync(live, parked);
    }
    saveState(gameId, "reshade", { ...state, off: !on });
    return status(gameId);
}

/* Removes empty folders up from a file's, stopping at the game's folder. */
function pruneUp(dir, stop) {
    let at = dir;
    while (at.startsWith(stop + path.sep)) {
        try {
            if (fs.readdirSync(at).length) return;
            fs.rmdirSync(at);
        } catch {
            return;
        }
        at = path.dirname(at);
    }
}

/*
 * Takes ReShade out: its DLL (if it's still the one put in) and the shaders put in. The
 * settings and presets made with it (ReShade.ini, preset .ini files) are kept.
 */
async function removeReshade(gameId) {
    const state = stateOf(gameId).reshade;
    if (!state) return status(gameId);
    const left = [];
    for (const name of [state.dll, `${state.dll}.off`]) {
        const at = path.join(state.dir, name);
        if (!fs.existsSync(at)) continue;
        if (sha1Of(at) === state.sha1) fs.rmSync(at);
        else left.push(name);
    }
    for (const rel of state.files) {
        if (isReshadeIni(path.basename(rel))) continue;
        const at = path.join(state.dir, rel);
        fs.rmSync(at, { force: true });
        pruneUp(path.dirname(at), state.dir);
    }
    for (const log of ["ReShade.log", "ReShade.log1", "ReShade.log2"]) fs.rmSync(path.join(state.dir, log), { force: true });
    saveState(gameId, "reshade", null);
    return { ...(await status(gameId)), left };
}

/* ---------------- ENB ---------------- */

const ENB_DLLS = /^(d3d11|d3d9|d3dcompiler_46e|dxgi|enbhost)\.(dll|exe)$/i;
const ENB_INI = /^(enbseries|enblocal)\.ini$/i;

/* "enbseries_skyrimse_v0503.zip" -> "0.503" */
function enbVersion(name) {
    const found = name.match(/v(\d)(\d{3})/i);
    return found ? `${found[1]}.${found[2]}` : null;
}

/* The newest ENB zip for the game in the Downloads folder: { file, name, version } or null. */
function enbDownload(gameId, target) {
    if (!target.enb) return null;
    const dir = path.join(os.homedir(), "Downloads");
    let best = null;
    try {
        for (const name of fs.readdirSync(dir)) {
            if (!/^enbseries.*\.(zip|7z)$/i.test(name) || !target.enb.test(name)) continue;
            const file = path.join(dir, name);
            const at = fs.statSync(file).mtimeMs;
            if (!best || at > best.at) best = { file, name, version: enbVersion(name), at };
        }
    } catch {
        return null;
    }
    return best && { file: best.file, name: best.name, version: best.version };
}

/*
 * Puts ENB in from the zip downloaded from enbdev.com: the files of its WrapperVersion
 * folder go beside the game's exe. Its .ini files go in only when there are none (a preset's
 * are kept).
 */
async function installEnb(gameId, file) {
    const target = targetOf(gameId);
    if (target.why) throw new Error(target.why);
    if (!target.enb) throw new Error("ENB isn't made for this game.");
    const name = path.basename(file);
    if (/^enbseries/i.test(name) && !target.enb.test(name) && /(skyrim|fallout|gta|oblivion|witcher|tes)/i.test(name)) {
        throw new Error(`${name} is ENB for another game. Download the one for this game from enbdev.com.`);
    }
    const { dir, cleanup } = await archive.unpack(file);
    try {
        const all = archive.listFiles(dir);
        const dlls = all.filter((rel) => /(^|\/)d3d11\.dll$/i.test(rel));
        // Its WrapperVersion folder, not the InjectorVersion one.
        const wrapper = dlls.find((rel) => /wrapper/i.test(rel)) ?? dlls.find((rel) => !/injector/i.test(rel));
        if (!wrapper) throw new Error(`${name} isn't ENB from enbdev.com (it has no d3d11.dll). ENB presets from mod sites install as mods.`);
        const from = path.posix.dirname(wrapper);
        const picked = all.filter((rel) => path.posix.dirname(rel) === from && (ENB_DLLS.test(path.posix.basename(rel)) || ENB_INI.test(path.posix.basename(rel))));

        const before = stateOf(gameId).enb ?? null;
        const ours = new Set(before?.files ?? []);
        const there = present(target.dir);
        const reshade = stateOf(gameId).reshade;
        for (const rel of picked) {
            const base = path.posix.basename(rel);
            if (!ENB_DLLS.test(base)) continue;
            const taken = there.has(lower(base)) || there.has(`${lower(base)}.off`);
            if (taken && !ours.has(base)) {
                const why = reshade && lower(reshade.dll) === lower(base) ? "ReShade is in as that name: reinstall ReShade as dxgi.dll first" : "another mod's, or ENB put in by hand";
                throw new Error(`${base} is already beside the game's exe (${why}), so ENB wasn't put in.`);
            }
        }

        const files = [];
        const hashes = {};
        const kept = [...(before?.kept ?? [])];
        fs.mkdirSync(target.dir, { recursive: true });
        for (const rel of picked) {
            const base = path.posix.basename(rel);
            const to = path.join(target.dir, base);
            if (ENB_INI.test(base)) {
                // A preset's (or your own) settings stay.
                if (fs.existsSync(to)) continue;
                fs.copyFileSync(path.join(dir, rel), to);
                if (!kept.includes(base)) kept.push(base);
                continue;
            }
            // Turned off: updated in place, still off.
            const at = before?.off ? `${to}.off` : to;
            fs.copyFileSync(path.join(dir, rel), at);
            files.push(base);
            hashes[base] = sha1Of(at);
        }
        // Files the old version had and this one doesn't go.
        for (const old of before?.files ?? []) {
            if (files.includes(old)) continue;
            for (const at of [path.join(target.dir, old), path.join(target.dir, `${old}.off`)]) {
                if (fs.existsSync(at) && sha1Of(at) === before.hashes?.[old]) fs.rmSync(at);
            }
        }
        saveState(gameId, "enb", { version: enbVersion(name), dir: target.dir, files, hashes, kept, off: Boolean(before?.off), from: name, at: new Date().toISOString() });
    } finally {
        cleanup();
    }
    return status(gameId);
}

/* Turns ENB off (its DLLs renamed) or back on. */
function setEnbOn(gameId, on) {
    const state = stateOf(gameId).enb;
    if (!state) throw new Error("ENB isn't installed for this game.");
    if (on === !state.off) return status(gameId);
    for (const name of state.files) {
        const live = path.join(state.dir, name);
        const parked = `${live}.off`;
        if (on) {
            if (fs.existsSync(live)) throw new Error(`${name} is beside the game's exe again (another mod's?), so ENB stays off.`);
            if (fs.existsSync(parked)) fs.renameSync(parked, live);
        } else if (fs.existsSync(live)) fs.renameSync(live, parked);
    }
    saveState(gameId, "enb", { ...state, off: !on });
    return status(gameId);
}

/* Takes ENB's DLLs out (if they're still the ones put in). Its settings (.ini) and presets stay. */
async function removeEnb(gameId) {
    const state = stateOf(gameId).enb;
    if (!state) return status(gameId);
    const left = [];
    for (const name of state.files) {
        for (const at of [path.join(state.dir, name), path.join(state.dir, `${name}.off`)]) {
            if (!fs.existsSync(at)) continue;
            if (sha1Of(at) === state.hashes?.[name]) fs.rmSync(at);
            else left.push(path.basename(at));
        }
    }
    saveState(gameId, "enb", null);
    return { ...(await status(gameId)), left };
}

/* ---------------- status ---------------- */

/*
 * For the page: whether these can go in, where, which DLL names are free, and what's in.
 * latest: the newest ReShade, when reshade.me answers.
 */
async function status(gameId) {
    const target = targetOf(gameId);
    const state = stateOf(gameId);
    if (target.why) return { supported: false, why: target.why, apis: APIS, packages: PACKAGES, reshade: state.reshade ?? null, enb: null, dir: null };
    const there = present(target.dir);
    const ours = new Set([state.reshade?.dll, state.reshade && `${state.reshade.dll}.off`, ...(state.enb?.files ?? []).flatMap((f) => [f, `${f}.off`])].filter(Boolean).map(lower));
    // Graphics DLLs already there that these didn't put in (a mod's, or put in by hand).
    const taken = Object.keys(APIS)
        .map((key) => `${key}.dll`)
        .filter((dll) => there.has(dll) && !ours.has(dll));
    const byHand = {
        reshade: !state.reshade && there.has("reshade.ini") && taken.length > 0,
        enb: !state.enb && there.has("d3d11.dll") && (there.has("enblocal.ini") || there.has("enbseries.ini")),
    };
    let latest = null;
    try {
        latest = (await latestReshade()).version;
    } catch {
        // Offline: no update check.
    }
    return {
        supported: true,
        why: null,
        dir: target.dir,
        api: target.api,
        apis: APIS,
        packages: PACKAGES,
        taken,
        byHand,
        latest,
        reshade: state.reshade ?? null,
        enb: target.enb
            ? { offered: true, site: ENB_SITE, installed: state.enb ?? null, download: enbDownload(gameId, target) }
            : null,
    };
}

module.exports = { status, installReshade, setReshadeOn, removeReshade, installEnb, setEnbOn, removeEnb, embeddedZip, TARGETS, ENB_SITE };
