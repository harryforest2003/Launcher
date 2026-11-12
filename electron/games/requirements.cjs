const fs = require("fs");
const path = require("path");
const { getGame } = require("./registry.cjs");
const { locate } = require("./detect.cjs");
const { dataDir } = require("./storage.cjs");
const store = require("./store.cjs");
const nexus = require("./nexus.cjs");
const plugins = require("./plugins.cjs");
const { installFromUrl } = require("./remote.cjs");
const curseforge = require("../mods/providers/curseforge.cjs");
const { curseforgeFetch } = require("../curseforge.cjs");

/*
 * What installed mods need that isn't there:
 *  - what Nexus Mods lists as each mod's requirements (no key needed to ask);
 *  - CurseForge's required dependencies of the file installed;
 *  - frameworks the installed files can't work without (SKSE plugins need SKSE, ASI
 *    mods need Script Hook V, CET mods need Cyber Engine Tweaks, SMAPI mods need SMAPI);
 *  - what SMAPI mods' manifests list as dependencies;
 *  - masters Skyrim and Fallout 4 plugins need.
 * Each comes with how to get it: from Nexus Mods or CurseForge, or the site it's on.
 */

const WEEK = 7 * 24 * 60 * 60 * 1000;

/* ---------------- frameworks ---------------- */

/* Files under a folder of the game's (a few levels down), as paths relative to it. */
function filesUnder(root, rel, depth = 3) {
    const out = [];
    const walk = (dir, prefix, level) => {
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const child = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                out.push(`${child}/`);
                if (level < depth) walk(path.join(dir, entry.name), child, level + 1);
            } else out.push(child);
        }
    };
    walk(path.join(root, rel), rel, 0);
    return out;
}

/*
 * Frameworks per game: which files need it, how to tell it's installed, and where it's
 * got. A requirement Nexus lists by the same number (or a name the aliases match) counts
 * as met when the framework is installed however it got there.
 */
const FRAMEWORKS = {
    skyrimse: [
        { name: "Skyrim Script Extender (SKSE64)", nexus: "30379", aliases: /skse|skyrim script extender/i, needs: (f) => /^Data\/SKSE\/Plugins\/[^/]+\.dll$/i.test(f), installed: (has) => has("skse64_loader.exe") },
        { name: "Address Library for SKSE Plugins", nexus: "32444", aliases: /address library for skse/i, installed: (has, any) => any("Data/SKSE/Plugins", /^version(lib)?-[\d-]+\.bin$/i) },
    ],
    fallout4: [
        { name: "Fallout 4 Script Extender (F4SE)", nexus: "42147", aliases: /f4se|fallout 4 script extender/i, needs: (f) => /^Data\/F4SE\/Plugins\/[^/]+\.dll$/i.test(f), installed: (has) => has("f4se_loader.exe") },
        { name: "Address Library for F4SE Plugins", nexus: "47327", aliases: /address library for f4se/i, installed: (has, any) => any("Data/F4SE/Plugins", /^version-[\d-]+\.bin$/i) },
    ],
    cyberpunk2077: [
        { name: "Cyber Engine Tweaks", nexus: "107", aliases: /cyber engine tweaks|\bcet\b/i, needs: (f) => /^bin\/x64\/plugins\/cyber_engine_tweaks\/mods\/[^/]+\/$/i.test(f), installed: (has) => has("bin/x64/plugins/cyber_engine_tweaks.asi") },
        { name: "redscript", nexus: "1511", aliases: /redscript/i, needs: (f) => /^r6\/scripts\/.+\.reds$/i.test(f), installed: (has) => has("engine/tools/scc.exe") || has("engine/tools/scc") },
        { name: "RED4ext", nexus: "2380", aliases: /red4ext/i, needs: (f) => /^red4ext\/plugins\/[^/]+\/$/i.test(f), installed: (has) => has("red4ext/RED4ext.dll") },
        { name: "ArchiveXL", nexus: "4198", aliases: /archivexl/i, needs: (f) => /^archive\/pc\/mod\/[^/]+\.xl$/i.test(f), installed: (has) => has("red4ext/plugins/ArchiveXL") },
        { name: "TweakXL", nexus: "4197", aliases: /tweakxl/i, needs: (f) => /^r6\/tweaks\/.+\.(yaml|yml|tweak)$/i.test(f), installed: (has) => has("red4ext/plugins/TweakXL") },
    ],
    gtav: [
        { name: "Script Hook V", url: "http://www.dev-c.com/gtav/scripthookv/", aliases: /script ?hook ?v(?!\s*\.?\s*net)|asi loader/i, needs: (f) => /^[^/]+\.asi$/i.test(f) || /^scripts\/[^/]+$/i.test(f), installed: (has) => has("ScriptHookV.dll") && (has("dinput8.dll") || has("dinput8.dll.unity-off")) },
        { name: "Script Hook V .NET", url: "https://github.com/scripthookvdotnet/scripthookvdotnet/releases", aliases: /script ?hook ?v ?\.?\s*net|shvdn/i, needs: (f) => /^scripts\/[^/]+\.(dll|cs|vb)$/i.test(f), installed: (has) => has("ScriptHookVDotNet.asi") },
    ],
    stardew: [
        { name: "SMAPI - Stardew Modding API", nexus: "2400", aliases: /smapi|stardew modding api/i, needs: (f) => /^Mods\/[^/]+\/manifest\.json$/i.test(f), installed: (has) => has("StardewModdingAPI.exe") || has("StardewModdingAPI.dll") || has("StardewModdingAPI") },
    ],
    sims4: [],
};

/* SMAPI dependencies people install most, by their manifest ID. */
const SMAPI_KNOWN = {
    "pathoschild.contentpatcher": { name: "Content Patcher", nexus: "1915" },
    "spacechase0.spacecore": { name: "SpaceCore", nexus: "1348" },
    "spacechase0.jsonassets": { name: "Json Assets", nexus: "1720" },
    "spacechase0.genericmodconfigmenu": { name: "Generic Mod Config Menu", nexus: "5098" },
    "esca.farmtypemanager": { name: "Farm Type Manager", nexus: "3231" },
    "cherry.expandedpreconditionsutility": { name: "Expanded Preconditions Utility", nexus: "6529" },
};

/* SMAPI manifests allow comments and trailing commas. */
function readManifest(file) {
    try {
        const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
        return JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1").replace(/,\s*([}\]])/g, "$1"));
    } catch {
        return null;
    }
}

/* ---------------- Nexus Mods' lists of requirements ---------------- */

const cacheFile = () => path.join(dataDir(), "nexus-requirements.json");

function readCache() {
    try {
        return JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
    } catch {
        return {};
    }
}

/* { modId: [{ modId, name, url, external, notes, sameGame }] } for some of a game's Nexus mods, cached a week. */
async function nexusRequirements(domain, modIds) {
    const cache = readCache();
    const wanted = [...new Set(modIds.map(String))];
    const stale = wanted.filter((id) => !cache[`${domain}/${id}`] || Date.now() - cache[`${domain}/${id}`].at > WEEK);
    for (let i = 0; i < stale.length; i += 40) {
        const batch = stale.slice(i, i + 40);
        const data = await nexus.gqlQuery(
            `query($ids: [CompositeDomainWithIdInput!]!) {
                legacyModsByDomain(ids: $ids) { nodes { modId game { id } modRequirements { nexusRequirements { nodes { modId modName gameId url externalRequirement notes } } } } }
            }`,
            { ids: batch.map((id) => ({ gameDomain: domain, modId: Number(id) })) }
        );
        for (const node of data.legacyModsByDomain.nodes) {
            cache[`${domain}/${node.modId}`] = {
                at: Date.now(),
                requires: (node.modRequirements?.nexusRequirements?.nodes ?? []).map((r) => ({
                    modId: r.externalRequirement ? null : String(r.modId),
                    name: (r.modName ?? "").trim(),
                    url: r.url || null,
                    external: Boolean(r.externalRequirement),
                    notes: r.notes ?? "",
                    sameGame: String(r.gameId) === String(node.game?.id),
                })),
            };
        }
        for (const id of batch) cache[`${domain}/${id}`] ??= { at: Date.now(), requires: [] };
    }
    fs.writeFileSync(cacheFile(), JSON.stringify(cache));
    return Object.fromEntries(wanted.map((id) => [id, cache[`${domain}/${id}`]?.requires ?? []]));
}

/* ---------------- what's missing ---------------- */

const nexusIdOf = (mod) => (mod.source?.provider === "nexus" && mod.source.modId ? String(mod.source.modId) : mod.source?.nexus?.modId ? String(mod.source.nexus.modId) : null);
const simple = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/*
 * What's missing for a game's mods: [{ key, name, kind, modId, url, neededBy, auto, note }].
 * kind: "nexus" | "curseforge" | "web" (a site's page) | "search" (a best guess on Nexus) |
 * "master" (a plugin file). auto: sure enough to fetch without asking.
 */
async function missing(gameId) {
    const game = getGame(gameId);
    const loc = locate(gameId);
    const state = store.readState(gameId);
    const listed = store.list(gameId).mods;
    const found = new Map();
    const need = (entry, by) => {
        const existing = found.get(entry.key);
        if (existing) {
            if (by && !existing.neededBy.includes(by)) existing.neededBy.push(by);
            return;
        }
        found.set(entry.key, { ...entry, neededBy: by ? [by] : [] });
    };
    if (!loc.gameDir && game.id !== "sims4") return [];

    const root = loc.gameDir;
    const has = (rel) => Boolean(root) && fs.existsSync(path.join(root, rel));
    const any = (rel, pattern) => {
        try {
            return fs.readdirSync(path.join(root, rel)).some((name) => pattern.test(name));
        } catch {
            return false;
        }
    };
    const frameworks = (FRAMEWORKS[gameId] ?? []).map((fw) => ({ ...fw, isInstalled: Boolean(root) && fw.installed(has, any) }));

    // What's installed, to tell a requirement's met: Nexus numbers, names, frameworks.
    const installedNexus = new Set(state.mods.map(nexusIdOf).filter(Boolean));
    const installedCurse = new Set(state.mods.filter((m) => m.source?.provider === "curseforge").map((m) => String(m.source.modId)));
    const names = listed.map((mod) => simple(mod.name));
    const metByName = (name) => {
        const wanted = simple(name);
        return Boolean(wanted) && names.some((have) => have === wanted || (wanted.length > 5 && have.includes(wanted)));
    };
    const metByFramework = (req) => frameworks.some((fw) => fw.isInstalled && ((req.modId && fw.nexus === req.modId) || fw.aliases.test(req.name)));

    // 1. Frameworks the files need: each mod's files (or, for ones added by hand, where they are).
    if (root) {
        const owners = new Map();
        for (const mod of state.mods.filter((m) => m.enabled)) for (const file of mod.files) if (file.base === "game") owners.set(file.to, mod.name);
        const gameFiles = ["", "scripts", "Data/SKSE/Plugins", "Data/F4SE/Plugins", "bin/x64/plugins/cyber_engine_tweaks/mods", "r6/scripts", "r6/tweaks", "red4ext/plugins", "archive/pc/mod", "Mods"].flatMap((rel) =>
            rel ? filesUnder(root, rel, rel === "Mods" ? 1 : 3) : fs.existsSync(root) ? fs.readdirSync(root).filter((n) => fs.statSync(path.join(root, n)).isFile()) : []
        );
        for (const fw of frameworks) {
            if (fw.isInstalled || !fw.needs) continue;
            for (const file of gameFiles) {
                if (!fw.needs(file)) continue;
                const owner = owners.get(file.replace(/\/$/, "")) ?? [...owners.entries()].find(([to]) => to.startsWith(file))?.[1] ?? `${file.replace(/\/$/, "").split("/").pop()} (added by hand)`;
                need({ key: fw.nexus ? `nexus:${fw.nexus}` : `web:${fw.url}`, name: fw.name, kind: fw.nexus ? "nexus" : "web", modId: fw.nexus ?? null, url: fw.url ?? null, auto: true }, owner);
            }
        }
    }

    // 2. Nexus Mods' lists.
    if (game.nexus) {
        const ids = state.mods.map(nexusIdOf).filter(Boolean);
        let lists = {};
        try {
            lists = ids.length ? await nexusRequirements(game.nexus, ids) : {};
        } catch {
            lists = {};
        }
        for (const mod of state.mods) {
            const id = nexusIdOf(mod);
            for (const req of (id && lists[id]) || []) {
                if (req.modId && !req.sameGame) continue;
                if ((req.modId && installedNexus.has(req.modId)) || metByFramework(req) || metByName(req.name)) continue;
                if (req.modId) need({ key: `nexus:${req.modId}`, name: req.name, kind: "nexus", modId: req.modId, url: null, auto: true, note: req.notes }, mod.name);
                else if (req.url) need({ key: `web:${req.url}`, name: req.name, kind: "web", modId: null, url: req.url, auto: true, note: req.notes }, mod.name);
            }
        }
    }

    // 3. CurseForge's required dependencies of the file installed.
    for (const mod of state.mods.filter((m) => m.source?.provider === "curseforge" && m.source.fileId)) {
        try {
            const res = await curseforgeFetch(`/mods/${mod.source.modId}/files/${mod.source.fileId}`);
            if (!res.ok) continue;
            const deps = ((await res.json()).data?.dependencies ?? []).filter((d) => d.relationType === 3 && !installedCurse.has(String(d.modId)));
            for (const dep of deps) {
                let name = `CurseForge mod ${dep.modId}`;
                let url = null;
                try {
                    const info = await curseforgeFetch(`/mods/${dep.modId}`);
                    if (info.ok) {
                        const project = (await info.json()).data;
                        name = project.name;
                        url = project.links?.websiteUrl ?? null;
                    }
                } catch {
                    // Named by number.
                }
                if (metByName(name)) continue;
                need({ key: `cf:${dep.modId}`, name, kind: "curseforge", modId: String(dep.modId), url, auto: true }, mod.name);
            }
        } catch {
            // CurseForge can be asked again next time.
        }
    }

    // 4. SMAPI mods' own dependencies.
    if (gameId === "stardew" && root) {
        const manifests = filesUnder(root, "Mods", 2).filter((f) => /\/manifest\.json$/i.test(f)).map((f) => readManifest(path.join(root, f))).filter(Boolean);
        const ids = new Set(manifests.map((m) => String(m.UniqueID ?? "").toLowerCase()).filter(Boolean));
        for (const manifest of manifests) {
            const deps = [...(manifest.Dependencies ?? []).filter((d) => d && d.IsRequired !== false), ...(manifest.ContentPackFor ? [manifest.ContentPackFor] : [])];
            for (const dep of deps) {
                const id = String(dep.UniqueID ?? "").toLowerCase();
                if (!id || ids.has(id) || id === "smapi") continue;
                const known = SMAPI_KNOWN[id];
                const words = (dep.UniqueID.split(".").pop() ?? dep.UniqueID).replace(/([a-z])([A-Z])/g, "$1 $2");
                if (known) need({ key: `nexus:${known.nexus}`, name: known.name, kind: "nexus", modId: known.nexus, url: null, auto: true }, manifest.Name ?? manifest.UniqueID);
                else if (!metByName(words)) need({ key: `search:${id}`, name: words, kind: "search", modId: null, url: `https://www.nexusmods.com/stardewvalley/search/?gsearch=${encodeURIComponent(words)}`, auto: false, note: `Its ID is ${dep.UniqueID}.` }, manifest.Name ?? manifest.UniqueID);
            }
        }
    }

    // 5. Masters Skyrim and Fallout 4 plugins need.
    if (game.bethesda && root) {
        const order = plugins.loadOrder(game, loc);
        for (const plugin of order.plugins) {
            for (const problem of plugin.problems.filter((p) => p.kind === "missing")) {
                const words = problem.master.replace(/\.(esp|esm|esl)$/i, "");
                if (metByName(words)) continue;
                need({ key: `master:${problem.master.toLowerCase()}`, name: problem.master, kind: "master", modId: null, url: `https://www.nexusmods.com/${game.nexus}/search/?gsearch=${encodeURIComponent(words)}`, auto: false, note: "A plugin file other plugins need." }, plugin.name);
            }
        }
    }

    return [...found.values()];
}

/* What one mod needs that's missing, by its name in the list. */
async function missingFor(gameId, modName) {
    return (await missing(gameId)).filter((entry) => entry.neededBy.includes(modName));
}

/*
 * What a Nexus mod needs that isn't installed, before it's installed (for installs that
 * go through the website): [entries as missing() gives].
 */
async function missingBeforeInstall(gameId, modId) {
    const game = getGame(gameId);
    if (!game.nexus) return [];
    const state = store.readState(gameId);
    const installedNexus = new Set(state.mods.map(nexusIdOf).filter(Boolean));
    const loc = locate(gameId);
    const has = (rel) => Boolean(loc.gameDir) && fs.existsSync(path.join(loc.gameDir, rel));
    const any = (rel, pattern) => {
        try {
            return fs.readdirSync(path.join(loc.gameDir, rel)).some((name) => pattern.test(name));
        } catch {
            return false;
        }
    };
    const frameworks = (FRAMEWORKS[gameId] ?? []).filter((fw) => loc.gameDir && fw.installed(has, any));
    const names = store.list(gameId).mods.map((mod) => simple(mod.name));
    const lists = await nexusRequirements(game.nexus, [modId]);
    return (lists[String(modId)] ?? [])
        .filter((req) => !req.modId || req.sameGame)
        .filter((req) => !(req.modId && installedNexus.has(req.modId)) && !frameworks.some((fw) => (req.modId && fw.nexus === req.modId) || fw.aliases.test(req.name)) && !names.includes(simple(req.name)))
        .map((req) =>
            req.modId
                ? { key: `nexus:${req.modId}`, name: req.name, kind: "nexus", modId: req.modId, url: null, auto: true, neededBy: [], note: req.notes }
                : { key: `web:${req.url}`, name: req.name, kind: "web", modId: null, url: req.url, auto: true, neededBy: [], note: req.notes }
        )
        .filter((entry) => entry.kind === "nexus" || entry.url);
}

/* ---------------- getting one ---------------- */

/*
 * Gets a requirement: straight in from Nexus Mods (Premium) or CurseForge, or the page to
 * get it from. -> an install result, or { needsWebsite, modId, external }.
 */
async function get(gameId, entry, progress) {
    const game = getGame(gameId);
    if (entry.kind === "nexus") {
        const page = `https://www.nexusmods.com/${game.nexus}/mods/${entry.modId}`;
        if (!nexus.hasKey()) return { needsWebsite: `${page}?tab=files`, modId: entry.modId };
        const listing = await nexus.filesOf(game.nexus, entry.modId);
        const mains = (listing.files ?? []).filter((f) => f.category_name === "MAIN").sort((a, b) => (b.uploaded_timestamp ?? 0) - (a.uploaded_timestamp ?? 0));
        const file = mains[0] ?? (listing.files ?? []).filter((f) => f.category_name !== "ARCHIVED" && f.category_name !== "OLD_VERSION").sort((a, b) => (b.uploaded_timestamp ?? 0) - (a.uploaded_timestamp ?? 0))[0];
        if (!file) return { needsWebsite: `${page}?tab=files`, modId: entry.modId };
        const filePage = `${page}?tab=files&file_id=${file.file_id}&nmm=1`;
        const account = await nexus.whoAmI().catch(() => null);
        if (!account?.premium) return { needsWebsite: filePage, modId: entry.modId };
        try {
            const url = await nexus.downloadUrl(game.nexus, entry.modId, String(file.file_id));
            return await installFromUrl(game, url, { name: entry.name, source: { provider: "nexus", modId: entry.modId, fileId: String(file.file_id), version: file.version ?? "" } }, progress);
        } catch (err) {
            if (err.code === "PREMIUM_REQUIRED") return { needsWebsite: filePage, modId: entry.modId };
            throw err;
        }
    }
    if (entry.kind === "curseforge") {
        try {
            const file = await curseforge.resolveDownload(entry.modId, null);
            return await installFromUrl(game, file.downloadUrl, { name: entry.name, source: { provider: "curseforge", modId: entry.modId, fileId: String(file.id), version: file.name } }, progress);
        } catch (err) {
            if (err.code === "DISTRIBUTION_DENIED") return { needsWebsite: entry.url, external: true };
            throw err;
        }
    }
    return { needsWebsite: entry.url, external: true };
}

module.exports = { missing, missingFor, missingBeforeInstall, get, FRAMEWORKS };
