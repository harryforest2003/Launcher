const fs = require("fs");
const path = require("path");
const { getGame } = require("./registry.cjs");
const { locate } = require("./detect.cjs");
const { dataDir } = require("./storage.cjs");
const store = require("./store.cjs");
const plugins = require("./plugins.cjs");

/*
 * A check-up of a game's mod folders, for what stops mods loading without saying so:
 * files in the wrong place or too deep, the same mod twice, empty or broken files,
 * archives left unpacked, and each game's own rules. Each problem says what's wrong and,
 * where it can be, fixes it in one go. Nothing is deleted: what's taken out is set aside
 * in the launcher's own folder.
 *
 * Issue: { id, severity: "error" | "warn", title, detail, files: [rel paths], fix: label | null }
 */

const ARCHIVE = /\.(zip|7z|rar)$/i;
const TRAY = /\.(trayitem|blueprint|bpi|hhi|sgi|householdbinary|room|rmi)$/i;

function walk(root, depth = 8) {
    const out = [];
    const go = (dir, rel, level) => {
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith(".")) continue;
            const child = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                out.push({ rel: child, dir: true });
                if (level < depth) go(path.join(dir, entry.name), child, level + 1);
            } else out.push({ rel: child, dir: false });
        }
    };
    go(root, "", 0);
    return out;
}

const size = (file) => {
    try {
        return fs.statSync(file).size;
    } catch {
        return -1;
    }
};

/* Moves something into the launcher's set-aside folder (nothing's deleted). */
function setAside(gameId, abs, label) {
    const stamp = new Date().toISOString().slice(0, 10);
    const target = path.join(dataDir(), gameId, "set-aside", stamp, label);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let final = target;
    for (let i = 2; fs.existsSync(final); i++) final = `${target} (${i})`;
    fs.renameSync(abs, final);
    return final;
}

function moveTo(from, to) {
    if (fs.existsSync(to)) throw new Error(`${path.basename(to)} is already where it would go.`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
}

/* Files the launcher installed, so they're left to it. */
function owned(gameId) {
    const set = new Set();
    for (const mod of store.readState(gameId).mods) for (const file of mod.files) set.add(`${file.base}:${file.to.toLowerCase()}`);
    return set;
}

const issue = (id, severity, title, detail, files, fix = null, apply = null) => ({ id, severity, title, detail, files, fix, apply });

/* ---------------- each game ---------------- */

function sims(game, loc) {
    const out = [];
    if (!loc.docsDir) return out;
    const mods = path.join(loc.docsDir, "Mods");
    const tray = path.join(loc.docsDir, "Tray");
    const mine = owned(game.id);
    const all = walk(mods).filter((f) => !f.dir);
    const free = (rel) => !mine.has(`docs:mods/${rel.toLowerCase()}`);

    const deepScripts = all.filter((f) => /\.ts4script$/i.test(f.rel) && f.rel.split("/").length > 2 && free(f.rel));
    if (deepScripts.length) {
        out.push(
            issue("sims-deep-scripts", "error", `${deepScripts.length} script mod${deepScripts.length === 1 ? " is" : "s are"} too deep to load`, "The Sims 4 only loads script mods that are in Mods or one folder inside it.", deepScripts.map((f) => `Mods/${f.rel}`), "Move them up", () => {
                for (const f of deepScripts) moveTo(path.join(mods, f.rel), path.join(mods, f.rel.split("/")[0], path.basename(f.rel)));
                return `Moved ${deepScripts.length} script mod${deepScripts.length === 1 ? "" : "s"} up to where the game loads them.`;
            })
        );
    }
    const deepPackages = all.filter((f) => /\.package$/i.test(f.rel) && f.rel.split("/").length > 6 && free(f.rel));
    if (deepPackages.length) {
        out.push(
            issue("sims-deep-packages", "error", `${deepPackages.length} package${deepPackages.length === 1 ? " is" : "s are"} too deep to load`, "The Sims 4 loads packages up to five folders inside Mods.", deepPackages.map((f) => `Mods/${f.rel}`), "Move them up", () => {
                for (const f of deepPackages) moveTo(path.join(mods, f.rel), path.join(mods, f.rel.split("/")[0], path.basename(f.rel)));
                return `Moved ${deepPackages.length} package${deepPackages.length === 1 ? "" : "s"} up.`;
            })
        );
    }
    const empty = all.filter((f) => /\.(package|ts4script)$/i.test(f.rel) && size(path.join(mods, f.rel)) === 0 && free(f.rel));
    if (empty.length) {
        out.push(
            issue("sims-empty", "error", `${empty.length} empty mod file${empty.length === 1 ? "" : "s"}`, "A file with nothing in it is a broken download, and can stop the game loading.", empty.map((f) => `Mods/${f.rel}`), "Set them aside", () => {
                for (const f of empty) setAside(game.id, path.join(mods, f.rel), `Mods/${f.rel}`);
                return `Set aside ${empty.length} empty file${empty.length === 1 ? "" : "s"}.`;
            })
        );
    }
    // The same file twice: same name and size, in different folders. The one the launcher installed (or the shallowest) stays.
    const byName = new Map();
    for (const f of all.filter((f) => /\.(package|ts4script)$/i.test(f.rel))) {
        const keyName = `${path.basename(f.rel).toLowerCase()}|${size(path.join(mods, f.rel))}`;
        byName.set(keyName, [...(byName.get(keyName) ?? []), f.rel]);
    }
    const extra = [];
    for (const copies of byName.values()) {
        if (copies.length < 2) continue;
        const keep = copies.find((rel) => !free(rel)) ?? [...copies].sort((a, b) => a.split("/").length - b.split("/").length)[0];
        extra.push(...copies.filter((rel) => rel !== keep && free(rel)));
    }
    if (extra.length) {
        out.push(
            issue("sims-duplicates", "warn", `${extra.length} mod file${extra.length === 1 ? " is" : "s are"} in Mods twice`, "Two copies of the same file can make the game use the wrong one, or crash.", extra.map((rel) => `Mods/${rel}`), "Set the extra copies aside", () => {
                for (const rel of extra) setAside(game.id, path.join(mods, rel), `Mods/${rel}`);
                return `Set aside ${extra.length} extra cop${extra.length === 1 ? "y" : "ies"}.`;
            })
        );
    }
    const trayInMods = all.filter((f) => TRAY.test(f.rel) && free(f.rel));
    if (trayInMods.length) {
        out.push(
            issue("sims-tray-in-mods", "warn", `${trayInMods.length} Gallery file${trayInMods.length === 1 ? " is" : "s are"} in Mods`, "Lots, rooms and households belong in Tray, where the game's Library finds them.", trayInMods.map((f) => `Mods/${f.rel}`), "Move them to Tray", () => {
                for (const f of trayInMods) moveTo(path.join(mods, f.rel), path.join(tray, path.basename(f.rel)));
                return `Moved ${trayInMods.length} file${trayInMods.length === 1 ? "" : "s"} to Tray.`;
            })
        );
    }
    const packagesInTray = walk(tray, 3).filter((f) => !f.dir && /\.(package|ts4script)$/i.test(f.rel));
    if (packagesInTray.length) {
        out.push(
            issue("sims-mods-in-tray", "warn", `${packagesInTray.length} mod file${packagesInTray.length === 1 ? " is" : "s are"} in Tray`, "Packages and script mods only load from Mods.", packagesInTray.map((f) => `Tray/${f.rel}`), "Move them to Mods", () => {
                for (const f of packagesInTray) moveTo(path.join(tray, f.rel), path.join(mods, path.basename(f.rel)));
                return `Moved ${packagesInTray.length} file${packagesInTray.length === 1 ? "" : "s"} to Mods.`;
            })
        );
    }
    if (fs.existsSync(mods) && !fs.existsSync(path.join(mods, "Resource.cfg"))) {
        out.push(
            issue("sims-resource-cfg", "warn", "Mods has no Resource.cfg", "Without it, packages in folders inside Mods may not load.", ["Mods/Resource.cfg"], "Put it back", () => {
                const lines = ["Priority 500", "PackedFile *.package", ...[1, 2, 3, 4, 5].map((n) => `PackedFile ${"*/".repeat(n)}*.package`)];
                fs.writeFileSync(path.join(mods, "Resource.cfg"), `${lines.join("\r\n")}\r\n`);
                return "Put Resource.cfg back in Mods.";
            })
        );
    }
    out.push(...archives(game, mods, all, "Mods"));
    return out;
}

function bethesda(game, loc) {
    const out = [];
    if (!loc.gameDir) return out;
    const data = path.join(loc.gameDir, "Data");
    let order = null;
    try {
        order = plugins.loadOrder(game, loc);
    } catch {
        order = null;
    }
    if (order) {
        const full = order.fixed.length + order.plugins.filter((p) => p.active && !p.light).length;
        if (full > 254) {
            out.push(issue("plugin-limit", "error", `${full} full plugins are on: the game loads 254 at most`, "Turn some off, or use light (ESL) versions where mods offer them.", [], null));
        }
    }
    const files = (() => {
        try {
            return fs.readdirSync(data);
        } catch {
            return [];
        }
    })();
    const pluginBases = new Set(files.filter((n) => /\.(esp|esm|esl)$/i.test(n)).map((n) => n.replace(/\.(esp|esm|esl)$/i, "").toLowerCase()));
    const archiveExt = game.id === "fallout4" ? /\.ba2$/i : /\.bsa$/i;
    const official = /^(skyrim|fallout4|update|dawnguard|hearthfires|dragonborn|dlc\w*|cc[a-z0-9]+|_resourcepack|marketplace|creationclub)\b/i;
    const orphans = files.filter((n) => archiveExt.test(n) && !official.test(n)).filter((n) => !pluginBases.has(n.replace(archiveExt, "").replace(/ - (main|textures|meshes|sounds|voices|animations|misc|interface)(\d*)$/i, "").toLowerCase()));
    if (orphans.length) {
        out.push(issue("orphan-archives", "warn", `${orphans.length} archive${orphans.length === 1 ? "" : "s"} won't load`, "The game only loads an archive when a plugin of the same name does, so what's in these is missed.", orphans.map((n) => `Data/${n}`), null));
    }
    out.push(...archives(game, data, walk(data, 0).filter((f) => !f.dir), "Data"));
    return out;
}

function gta(game, loc) {
    const out = [];
    if (!loc.gameDir) return out;
    const root = loc.gameDir;
    if (fs.existsSync(path.join(root, "mods")) && !fs.existsSync(path.join(root, "OpenIV.asi"))) {
        out.push(issue("gta-openiv", "error", "The mods folder is ignored", "GTA V only reads the mods folder with OpenIV.asi in the game folder: install it from OpenIV (Tools → ASI Manager).", ["mods/"], null));
    }
    const asiInScripts = walk(path.join(root, "scripts"), 1).filter((f) => !f.dir && /\.asi$/i.test(f.rel));
    if (asiInScripts.length) {
        out.push(
            issue("gta-asi-in-scripts", "warn", `${asiInScripts.length} ASI plugin${asiInScripts.length === 1 ? " is" : "s are"} in scripts`, "ASI plugins only load from the game folder.", asiInScripts.map((f) => `scripts/${f.rel}`), "Move them", () => {
                for (const f of asiInScripts) moveTo(path.join(root, "scripts", f.rel), path.join(root, path.basename(f.rel)));
                return `Moved ${asiInScripts.length} ASI plugin${asiInScripts.length === 1 ? "" : "s"} to the game folder.`;
            })
        );
    }
    const dlc = path.join(root, "mods", "update", "x64", "dlcpacks");
    const broken = walk(dlc, 0).filter((f) => f.dir && !fs.existsSync(path.join(dlc, f.rel, "dlc.rpf")));
    if (broken.length) {
        out.push(issue("gta-dlcpacks", "error", `${broken.length} add-on${broken.length === 1 ? " is" : "s are"} incomplete`, "Each add-on in dlcpacks needs its dlc.rpf, or the game can't load it.", broken.map((f) => `mods/update/x64/dlcpacks/${f.rel}`), null));
    }
    out.push(...archives(game, root, walk(root, 0).filter((f) => !f.dir), ""), ...archives(game, path.join(root, "scripts"), walk(path.join(root, "scripts"), 0).filter((f) => !f.dir), "scripts"));
    return out;
}

function cyberpunk(game, loc) {
    const out = [];
    if (!loc.gameDir) return out;
    const root = loc.gameDir;
    const cet = path.join(root, "bin", "x64", "plugins", "cyber_engine_tweaks", "mods");
    const nested = [];
    const noInit = [];
    for (const f of walk(cet, 0).filter((f) => f.dir)) {
        if (fs.existsSync(path.join(cet, f.rel, "init.lua"))) continue;
        const inner = walk(path.join(cet, f.rel), 0).filter((g) => g.dir && fs.existsSync(path.join(cet, f.rel, g.rel, "init.lua")));
        if (inner.length === 1) nested.push({ outer: f.rel, inner: inner[0].rel });
        else noInit.push(f.rel);
    }
    if (nested.length) {
        out.push(
            issue("cet-nested", "error", `${nested.length} Cyber Engine Tweaks mod${nested.length === 1 ? " is" : "s are"} a folder too deep`, "CET only loads a mod whose init.lua is straight inside its folder.", nested.map((n) => `…/cyber_engine_tweaks/mods/${n.outer}/${n.inner}`), "Move them up", () => {
                for (const n of nested) {
                    const tmp = path.join(cet, `${n.outer}.unity-moving`);
                    fs.renameSync(path.join(cet, n.outer, n.inner), tmp);
                    fs.rmSync(path.join(cet, n.outer), { recursive: true, force: true });
                    fs.renameSync(tmp, path.join(cet, n.inner === n.outer ? n.outer : n.inner));
                }
                return `Moved ${nested.length} CET mod${nested.length === 1 ? "" : "s"} up.`;
            })
        );
    }
    if (noInit.length) out.push(issue("cet-no-init", "warn", `${noInit.length} folder${noInit.length === 1 ? "" : "s"} in CET's mods won't load`, "There's no init.lua in them, so Cyber Engine Tweaks skips them.", noInit.map((r) => `…/cyber_engine_tweaks/mods/${r}`), null));
    const stray = walk(root, 0).filter((f) => !f.dir && /\.(archive|xl)$/i.test(f.rel));
    if (stray.length) {
        out.push(
            issue("cp-stray-archives", "warn", `${stray.length} archive mod${stray.length === 1 ? " is" : "s are"} in the game folder`, "Archive mods only load from archive/pc/mod.", stray.map((f) => f.rel), "Move them", () => {
                for (const f of stray) moveTo(path.join(root, f.rel), path.join(root, "archive", "pc", "mod", f.rel));
                return `Moved ${stray.length} archive mod${stray.length === 1 ? "" : "s"} to archive/pc/mod.`;
            })
        );
    }
    const modDir = path.join(root, "archive", "pc", "mod");
    out.push(...archives(game, modDir, walk(modDir, 0).filter((f) => !f.dir), "archive/pc/mod"));
    return out;
}

/* SMAPI manifests allow comments and trailing commas. */
function manifest(file) {
    try {
        const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
        return JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1").replace(/,\s*([}\]])/g, "$1"));
    } catch {
        return undefined;
    }
}

const versionNumber = (v) => String(v ?? "0").split(/[.-]/).map((p) => parseInt(p, 10) || 0);
const newer = (a, b) => {
    const x = versionNumber(a);
    const y = versionNumber(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
    return false;
};

function stardew(game, loc) {
    const out = [];
    if (!loc.gameDir) return out;
    const modsDir = path.join(loc.gameDir, "Mods");
    const folders = walk(modsDir, 0).filter((f) => f.dir && !f.rel.startsWith("."));
    const noManifest = [];
    const broken = [];
    const byId = new Map();
    for (const folder of folders) {
        const files = walk(path.join(modsDir, folder.rel), 3).filter((f) => !f.dir && /(^|\/)manifest\.json$/i.test(f.rel));
        if (!files.length) {
            if (!walk(path.join(modsDir, folder.rel), 1).some((f) => ARCHIVE.test(f.rel))) noManifest.push(folder.rel);
            continue;
        }
        for (const file of files) {
            const data = manifest(path.join(modsDir, folder.rel, file.rel));
            if (data === undefined) broken.push(`${folder.rel}/${file.rel}`);
            else if (data?.UniqueID) {
                const id = String(data.UniqueID).toLowerCase();
                byId.set(id, [...(byId.get(id) ?? []), { folder: path.posix.dirname(`${folder.rel}/${file.rel}`), version: data.Version, name: data.Name ?? data.UniqueID }]);
            }
        }
    }
    if (noManifest.length) out.push(issue("smapi-no-manifest", "warn", `${noManifest.length} folder${noManifest.length === 1 ? " in Mods isn't a mod" : "s in Mods aren't mods"}`, "There's no manifest.json in them, so SMAPI skips them.", noManifest.map((r) => `Mods/${r}`), null));
    if (broken.length) out.push(issue("smapi-broken-manifest", "error", `${broken.length} mod${broken.length === 1 ? "'s manifest is" : "s' manifests are"} broken`, "SMAPI can't read them, so those mods don't load.", broken.map((r) => `Mods/${r}`), null));
    const twice = [...byId.values()].filter((copies) => copies.length > 1);
    if (twice.length) {
        const older = twice.flatMap((copies) => {
            const best = copies.reduce((a, b) => (newer(b.version, a.version) ? b : a));
            return copies.filter((c) => c !== best);
        });
        out.push(
            issue("smapi-twice", "error", `${twice.length} mod${twice.length === 1 ? " is" : "s are"} installed twice`, `SMAPI won't load either copy of ${twice.map((c) => c[0].name).join(", ")}.`, older.map((c) => `Mods/${c.folder}`), "Set the older copies aside", () => {
                for (const copy of older) setAside(game.id, path.join(modsDir, copy.folder), `Mods/${copy.folder}`);
                return `Set aside ${older.length} older cop${older.length === 1 ? "y" : "ies"}.`;
            })
        );
    }
    out.push(...archives(game, modsDir, walk(modsDir, 1).filter((f) => !f.dir), "Mods"));
    return out;
}

/* Archives left in a mod folder: the game can't read them. Fixed by installing them properly. */
function archives(game, dir, files, label) {
    const found = files.filter((f) => ARCHIVE.test(f.rel));
    if (!found.length) return [];
    return [
        issue(`archives:${label}`, "warn", `${found.length} unpacked download${found.length === 1 ? " is" : "s are"} in ${label || "the game folder"}`, `The game can't read ${found.length === 1 ? "it" : "them"} as ${found.length === 1 ? "it is" : "they are"}.`, found.map((f) => (label ? `${label}/${f.rel}` : f.rel)), "Install them properly", async () => {
            let done = 0;
            const problems = [];
            for (const f of found) {
                const abs = path.join(dir, f.rel);
                try {
                    await store.install(game.id, abs);
                    setAside(game.id, abs, label ? `${label}/${f.rel}` : f.rel);
                    done += 1;
                } catch (err) {
                    problems.push(`${path.basename(f.rel)}: ${err.message}`);
                }
            }
            return `Installed ${done} of ${found.length}.${problems.length ? ` ${problems.join(" ")}` : ""}`;
        }),
    ];
}

const CHECKS = { sims4: sims, skyrimse: bethesda, fallout4: bethesda, gtav: gta, cyberpunk2077: cyberpunk, stardew };

/* The problems found: [{ id, severity, title, detail, files, fix }]. */
function check(gameId) {
    const game = getGame(gameId);
    const loc = locate(gameId);
    try {
        return (CHECKS[gameId]?.(game, loc) ?? []).map((i) => ({ ...i, files: i.files.slice(0, 50), apply: undefined }));
    } catch {
        return [];
    }
}

/* Fixes one problem (found afresh). -> what was done. */
async function fix(gameId, id) {
    const game = getGame(gameId);
    const found = (CHECKS[gameId]?.(game, locate(gameId)) ?? []).find((i) => i.id === id);
    if (!found) return { done: "That's already sorted." };
    if (!found.apply) throw new Error("That one needs fixing by hand.");
    const done = await found.apply();
    store.touch(gameId);
    return { done };
}

module.exports = { check, fix };
