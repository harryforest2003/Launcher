const fs = require("fs");
const path = require("path");

/*
 * Where each file of a mod goes, game by game. A planner is given the mod's files (paths
 * relative to where it was unpacked, "/"-separated) and returns:
 *
 *   placements  [{ from, base, to }]  copy `from` to `to` under base "game" or "docs"
 *   skipped     [{ file, reason }]    files that can't be put in place by copying
 *   notes       [text]                what else it needs, or what to do by hand
 *   plugins     [name]                Bethesda plugins (.esp/.esm/.esl) to turn on
 *
 * The aim is the layout each game's own mod tools produce, so a mod installed here works
 * the same as one installed by hand from its instructions.
 */

const lower = (text) => String(text).toLowerCase();
const ext = (file) => lower(path.posix.extname(file));
const base = (file) => path.posix.basename(file);
const dirOf = (file) => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "");
const under = (file, dir) => (dir ? (lower(file).startsWith(lower(dir) + "/") ? file.slice(dir.length + 1) : null) : file);

// Read-me files, pictures and links that come with mods but don't go in the game.
const DOC = /^(readme|read me|read_me|changelog|change log|changes|license|licence|credits|install(ation)?( instructions)?|instructions|faq)([ ._-].*)?\.(txt|md|rtf|pdf|html?|docx?)$|\.(url|pdf|jpe?g|png|gif|webp|bmp|psd|docx?|rtf|html?|md)$/i;
// Also "skse64_readme.txt" and the like: a read-me named after the mod.
const NAMED_DOC = /(^|[\s._-])(readme|read me|changelog|changes|license|licence|credits|instructions)([\s._-].*)?\.(txt|md|rtf|pdf|html?)$/i;
const isDoc = (file) => DOC.test(base(file)) || NAMED_DOC.test(base(file));

/* The folder everything is in, when it's all wrapped in one folder with nothing beside it. */
function wrapper(files, keep = () => false) {
    let prefix = "";
    for (;;) {
        const rest = files.map((file) => under(file, prefix)).filter((file) => file !== null);
        const tops = new Set(rest.map((file) => (file.includes("/") ? file.split("/")[0] : null)));
        if (tops.size !== 1 || tops.has(null)) return prefix;
        const [top] = tops;
        if (keep(top)) return prefix;
        prefix = prefix ? `${prefix}/${top}` : top;
    }
}

/* The mod's name from its file name: "SkyUI_5_2_SE-12604-5-2SE-1573851403.7z" -> "SkyUI 5 2 SE". */
function nameFromFile(file) {
    return path
        .basename(file, path.extname(file))
        .replace(/-\d{2,7}(-[\w]+)*-\d{9,11}$/, "") // Nexus' "-modid-version-timestamp"
        .replace(/[_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim() || "Mod";
}

// A folder name from a mod's name: no separators, and never "." or ".." (or only dots),
// which would put the mod in the folder itself or the one above it.
const safeFolder = (name) => {
    const clean = String(name).replace(/[\u0000-\u001f/\\:*?"<>|]/g, "_").trim().slice(0, 80);
    return /^\.*$/.test(clean) ? "Mod" : clean;
};

/* ---------------- The Sims 4 ---------------- */

const SIMS_TRAY = new Set([".trayitem", ".blueprint", ".bpi", ".hhi", ".sgi", ".householdbinary", ".room", ".rmi"]);

function sims4(files, ctx) {
    const result = { placements: [], skipped: [], notes: [], plugins: [] };
    const folder = safeFolder(ctx.modName);
    for (const file of files) {
        const kind = ext(file);
        if (kind === ".package") result.placements.push({ from: file, base: "docs", to: `Mods/${folder}/${base(file)}` });
        // Script mods only load one folder deep, so they sit right in the mod's folder.
        else if (kind === ".ts4script") result.placements.push({ from: file, base: "docs", to: `Mods/${folder}/${base(file)}` });
        else if (SIMS_TRAY.has(kind)) result.placements.push({ from: file, base: "docs", to: `Tray/${base(file)}` });
        else if (!isDoc(file) && kind !== ".cfg") result.skipped.push({ file, reason: "not a Sims 4 mod file" });
    }
    if (result.placements.some((p) => p.to.endsWith(".ts4script"))) {
        result.notes.push("This is a script mod: Script Mods Allowed must be on in Game Options → Other (Settings here can turn it on).");
    }
    if (result.placements.some((p) => p.base === "docs" && p.to.startsWith("Tray/"))) {
        result.notes.push("Lots, rooms or Sims from this are in your Library in game (Gallery → My Library).");
    }
    return result;
}

/* ---------------- Grand Theft Auto V ---------------- */

const GTA_ROOT_FILES = /^(scripthookv\.dll|dinput8\.dll|scripthookvdotnet\d*\.(dll|asi)|scripthookvdotnet\.asi|openiv\.asi|nativetrainer\.asi)$/i;
const GTA_IN_ARCHIVES = new Set([".ytd", ".yft", ".ydr", ".ydd", ".ycd", ".ymt", ".ytyp", ".ybn", ".ymap", ".awc", ".gxt2", ".meta", ".ynv", ".ynd"]);

function gtav(files, ctx) {
    const result = { placements: [], skipped: [], notes: [], plugins: [] };
    const has = (rel) => ctx.gameHas?.(rel);
    let needsHook = false;
    let needsDotNet = false;
    const dlcs = new Set();
    const oivs = [];
    let inArchives = 0;

    // A folder laid out like the game's own (scripts\, mods\, .asi files beside it) goes
    // in as it is: that's how most mods with several parts are packed.
    const anchors = new Set();
    for (const file of files) {
        const parts = file.split("/");
        const name = lower(parts.at(-1));
        if (name.endsWith(".asi") || GTA_ROOT_FILES.test(name)) anchors.add(dirOf(file));
        const at = parts.findIndex((part) => /^(scripts|mods|menyoostuff)$/i.test(part));
        if (at >= 0) anchors.add(parts.slice(0, at).join("/"));
    }
    const anchor = [...anchors].sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length)[0];

    for (const file of files) {
        const name = base(file);
        const kind = ext(file);
        const rel = anchor !== undefined ? under(file, anchor) : null;

        if (kind === ".oiv") {
            oivs.push(name);
            result.skipped.push({ file, reason: "an OpenIV package: install it with OpenIV's Package Installer" });
            continue;
        }
        if (lower(name) === "dlc.rpf") {
            // An add-on (cars, clothes): its own folder in dlcpacks.
            const parts = file.split("/");
            const at = parts.findIndex((part) => lower(part) === "dlcpacks");
            const pack = safeFolder(at >= 0 && parts[at + 1] && parts[at + 1] !== name ? parts[at + 1] : parts.at(-2) ?? ctx.modName).toLowerCase().replace(/\s+/g, "");
            dlcs.add(pack);
            result.placements.push({ from: file, base: "game", to: `mods/update/x64/dlcpacks/${pack}/dlc.rpf` });
            continue;
        }
        if (rel !== null && rel !== undefined && !(rel.indexOf("/") === -1 && isDoc(rel))) {
            if (GTA_IN_ARCHIVES.has(kind) && !/^(scripts|menyoostuff)\//i.test(rel)) {
                inArchives++;
                result.skipped.push({ file, reason: "replaces a file inside the game's archives, which needs OpenIV" });
                continue;
            }
            result.placements.push({ from: file, base: "game", to: rel });
            if (kind === ".asi" || /\.(dll|cs|vb)$/i.test(rel)) needsHook = true;
            if (/^scripts\//i.test(rel) && /\.(dll|cs|vb)$/i.test(rel)) needsDotNet = true;
            continue;
        }
        if (kind === ".asi" || GTA_ROOT_FILES.test(name)) {
            result.placements.push({ from: file, base: "game", to: name });
            needsHook = true;
            continue;
        }
        if ([".cs", ".vb", ".dll"].includes(kind)) {
            result.placements.push({ from: file, base: "game", to: `scripts/${name}` });
            needsHook = needsDotNet = true;
            continue;
        }
        if ([".ini", ".xml", ".json"].includes(kind) && files.some((other) => dirOf(other) === dirOf(file) && /\.(asi|dll|cs|vb)$/i.test(other))) {
            // A script's or plugin's settings go beside it.
            const beside = files.find((other) => dirOf(other) === dirOf(file) && /\.(asi|dll|cs|vb)$/i.test(other));
            result.placements.push({ from: file, base: "game", to: /\.asi$/i.test(beside) || GTA_ROOT_FILES.test(base(beside)) ? name : `scripts/${name}` });
            continue;
        }
        if (GTA_IN_ARCHIVES.has(kind)) {
            inArchives++;
            result.skipped.push({ file, reason: "replaces a file inside the game's archives, which needs OpenIV" });
            continue;
        }
        if (!isDoc(file)) result.skipped.push({ file, reason: "not a file GTA V loads by itself" });
    }

    const placing = (pattern) => result.placements.some((p) => pattern.test(base(p.to)));
    if (needsHook && !has("ScriptHookV.dll") && !placing(/^scripthookv\.dll$/i)) {
        result.notes.push("Needs Script Hook V and its ASI Loader, from dev-c.com (they're not on Nexus).");
    }
    if (needsDotNet && !has("ScriptHookVDotNet.asi") && !placing(/^scripthookvdotnet/i)) {
        result.notes.push("Needs Script Hook V .NET (on Nexus Mods) for the scripts it puts in the scripts folder.");
    }
    if (dlcs.size) {
        result.notes.push(
            `Add-on${dlcs.size === 1 ? "" : "s"} put in mods\\update\\x64\\dlcpacks: add ${[...dlcs].map((pack) => `<Item>dlcpacks:/${pack}/</Item>`).join(" and ")} to dlclist.xml (inside mods\\update\\update.rpf\\common\\data) with OpenIV, unless you use an add-on loader.`
        );
        if (!has("OpenIV.asi")) result.notes.push("The mods folder needs OpenIV.asi (installed from OpenIV's ASI Manager).");
    }
    if (oivs.length) result.notes.push(`${oivs.join(", ")} ${oivs.length === 1 ? "is an OpenIV package" : "are OpenIV packages"}: open ${oivs.length === 1 ? "it" : "them"} in OpenIV → Package Installer.`);
    if (inArchives) result.notes.push(`${inArchives} file${inArchives === 1 ? "" : "s"} replace${inArchives === 1 ? "s" : ""} files inside the game's archives: put them in with OpenIV, as the mod's instructions say.`);
    return result;
}

/* ---------------- Skyrim and Fallout 4 ---------------- */

const DATA_DIRS = new Set([
    "meshes", "textures", "scripts", "interface", "sound", "music", "skse", "f4se", "seq", "strings", "materials", "video",
    "lodsettings", "grass", "shadersfx", "calientetools", "nemesis_engine", "tools", "facegen", "distantlod", "lod", "terrain",
    "vis", "programs", "mcm", "dialogueviews", "netscriptframework", "platform", "sky", "scripts.bsa",
]);
const PLUGIN = /\.(esp|esm|esl)$/i;
const DATA_FILE = /\.(esp|esm|esl|bsa|ba2|ini)$/i;

function bethesda(files, ctx) {
    const result = { placements: [], skipped: [], notes: [], plugins: [] };
    const extender = ctx.game.bethesda.extender;
    const fomodConfig = files.find((file) => /(^|\/)fomod\/moduleconfig\.xml$/i.test(file));
    if (fomodConfig) return fomod(files, ctx, fomodConfig);

    // The folder that matches the game's Data folder: one called Data, or one holding
    // plugins, archives or the usual folders (meshes, textures...).
    const isDataLevel = (dir) => {
        const inside = files.map((file) => under(file, dir)).filter((file) => file !== null);
        return inside.some((rel) => (rel.includes("/") ? DATA_DIRS.has(lower(rel.split("/")[0])) : DATA_FILE.test(rel)));
    };
    const dataDirs = new Set();
    for (const file of files) {
        const parts = file.split("/");
        const at = parts.findIndex((part) => lower(part) === "data");
        if (at >= 0) dataDirs.add(parts.slice(0, at + 1).join("/"));
    }
    const prefix = wrapper(files, (top) => lower(top) === "data" || DATA_DIRS.has(lower(top)));
    let dataRoot = [...dataDirs].sort((a, b) => a.length - b.length)[0];
    if (dataRoot === undefined) dataRoot = isDataLevel(prefix) ? prefix : null;
    // Script extenders: their loader and DLLs go beside the game's exe.
    const extenderFile = (name) => lower(name) === extender.loader || (lower(name).startsWith(extender.prefix) && /\.(dll|exe)$/i.test(name));

    for (const file of files) {
        const name = base(file);
        if (extenderFile(name)) {
            result.placements.push({ from: file, base: "game", to: name });
            continue;
        }
        const rel = dataRoot !== null ? under(file, dataRoot) : null;
        if (rel === null) {
            if (!isDoc(file) && !/^src\//i.test(under(file, prefix) ?? "")) result.skipped.push({ file, reason: "outside the mod's Data files" });
            continue;
        }
        if (!rel.includes("/") && isDoc(rel)) continue;
        result.placements.push({ from: file, base: "game", to: `Data/${rel}` });
        if (!rel.includes("/") && PLUGIN.test(rel)) result.plugins.push(rel);
    }
    if (dataRoot === null && !result.placements.length) result.notes.push("Couldn't find the mod's Data files (plugins, meshes, textures...) in it.");
    extenderNote(result, ctx);
    return result;
}

function extenderNote(result, ctx) {
    const extender = ctx.game.bethesda.extender;
    const usesIt = result.placements.some((p) => new RegExp(`^Data/${extender.name}/plugins/`, "i").test(p.to));
    const bringsIt = result.placements.some((p) => lower(base(p.to)) === extender.loader);
    if (usesIt && !bringsIt && !ctx.gameHas?.(extender.loader)) result.notes.push(`Needs ${extender.name}, from ${extender.url}. Launch the game with it (Play does, once it's installed).`);
}

/* ---------------- FOMOD installers (Skyrim, Fallout) ---------------- */

/* A small XML reader: elements with their attributes and children, enough for FOMOD's config. */
function parseXml(text) {
    const root = { name: "#root", attrs: {}, children: [] };
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let match;
    while ((match = re.exec(text))) {
        const [, cdata, closing, name, attrText, selfClosing, textNode] = match;
        const top = stack.at(-1);
        if (cdata !== undefined) top.text = (top.text ?? "") + cdata;
        else if (textNode !== undefined) top.text = (top.text ?? "") + textNode;
        else if (name && closing) {
            if (stack.length > 1) stack.pop();
        } else if (name) {
            const attrs = {};
            for (const [, key, double, single] of attrText.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[key] = (double ?? single).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
            const node = { name, attrs, children: [] };
            top.children.push(node);
            if (!selfClosing) stack.push(node);
        }
    }
    return root;
}

const kids = (node, name) => (node?.children ?? []).filter((child) => lower(child.name) === lower(name));
const kid = (node, name) => kids(node, name)[0] ?? null;

function fomod(files, ctx, configFile) {
    const result = { placements: [], skipped: [], notes: [], plugins: [] };
    const root = dirOf(dirOf(configFile)); // The folder holding "fomod".
    let text = fs.readFileSync(path.join(ctx.dir, configFile));
    // FOMOD configs are often UTF-16.
    text = text[0] === 0xff && text[1] === 0xfe ? text.toString("utf16le") : text.toString("utf8");
    const config = kid(parseXml(text.replace(/^﻿/, "")), "config");
    if (!config) {
        result.notes.push("Its installer (FOMOD) couldn't be read.");
        return result;
    }

    const byLower = new Map(files.map((file) => [lower(file), file]));
    const flags = new Map();
    const chosen = [];
    const add = (entry) => {
        const source = (entry.attrs.source ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        const destination = (entry.attrs.destination ?? (lower(entry.name) === "file" ? base(source) : "")).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        const from = root ? `${root}/${source}` : source;
        if (lower(entry.name) === "file") {
            const real = byLower.get(lower(from));
            if (real) result.placements.push({ from: real, base: "game", to: `Data/${destination || base(source)}` });
        } else {
            for (const file of files) {
                const rel = under(file, from);
                if (rel === null) continue;
                result.placements.push({ from: file, base: "game", to: `Data/${destination ? `${destination}/` : ""}${rel}` });
            }
        }
    };
    const install = (filesNode) => {
        for (const entry of filesNode?.children ?? []) if (/^(file|folder)$/i.test(entry.name)) add(entry);
    };

    install(kid(config, "requiredInstallFiles"));

    // Each group's options, chosen as the installer recommends.
    const typeOf = (plugin) => kid(kid(plugin, "typeDescriptor"), "type")?.attrs.name ?? kid(kid(kid(plugin, "typeDescriptor"), "dependencyType"), "defaultType")?.attrs.name ?? "Optional";
    for (const step of kids(kid(config, "installSteps"), "installStep")) {
        for (const group of kids(kid(step, "optionalFileGroups"), "group")) {
            const plugins = kids(kid(group, "plugins"), "plugin");
            const type = group.attrs.type ?? "SelectAny";
            const usable = plugins.filter((p) => typeOf(p) !== "NotUsable");
            const marked = usable.filter((p) => /^(Required|Recommended)$/.test(typeOf(p)));
            let picks;
            if (type === "SelectAll") picks = usable;
            else if (type === "SelectExactlyOne") picks = [marked[0] ?? usable[0]].filter(Boolean);
            else if (type === "SelectAtLeastOne") picks = marked.length ? marked : usable.slice(0, 1);
            else if (type === "SelectAtMostOne") picks = marked.slice(0, 1);
            else picks = marked;
            for (const plugin of picks) {
                install(kid(plugin, "files"));
                for (const flag of kids(kid(plugin, "conditionFlags"), "flag")) flags.set(flag.attrs.name, (flag.text ?? "").trim());
                chosen.push(`${group.attrs.name ?? "Options"}: ${plugin.attrs.name}`);
            }
        }
    }

    // Files installed when chosen options set flags.
    const met = (deps) => {
        if (!deps) return true;
        const checks = deps.children.map((child) => {
            if (lower(child.name) === "flagdependency") return (flags.get(child.attrs.flag) ?? "") === (child.attrs.value ?? "");
            if (lower(child.name) === "filedependency") return child.attrs.state !== "Active" || Boolean(ctx.gameHas?.(`Data/${child.attrs.file}`));
            if (lower(child.name) === "dependencies") return met(child);
            return true; // Game or mod manager versions: assumed fine.
        });
        return deps.attrs.operator === "Or" ? checks.some(Boolean) : checks.every(Boolean);
    };
    for (const pattern of kids(kid(kid(config, "conditionalFileInstalls"), "patterns"), "pattern")) {
        if (met(kid(pattern, "dependencies"))) install(kid(pattern, "files"));
    }

    // Later options overwrite earlier ones, as in the game's own mod managers.
    const last = new Map();
    for (const placement of result.placements) last.set(lower(placement.to), placement);
    result.placements = [...last.values()];
    result.plugins = result.placements.map((p) => p.to.slice(5)).filter((rel) => !rel.includes("/") && PLUGIN.test(rel));
    if (chosen.length) result.notes.push(`Its installer's recommended options were chosen: ${chosen.join("; ")}.`);
    if (!result.placements.length) result.notes.push("Its installer (FOMOD) had nothing to install with the recommended options.");
    extenderNote(result, ctx);
    return result;
}

/* ---------------- Cyberpunk 2077 ---------------- */

const CP_ROOTS = new Set(["archive", "bin", "r6", "red4ext", "engine", "mods", "archive-loader"]);

/*
 * Where a file laid out for the Windows version goes in the Mac version: { to } or
 * { reason } when it can't load there. On a Mac only redscript runs, and archive mods load
 * through archive-loader (Nexus Mods 33616) from archive-loader/mods/enabled.
 */
function cyberpunkMacPlace(to) {
    if (/\.xl$/i.test(to)) return { reason: "needs ArchiveXL, which only runs on Windows" };
    if (/^archive\/pc\/mod\/(?:.+\/)?[^/]+\.archive$/i.test(to)) return { to: `archive-loader/mods/enabled/${base(to)}` };
    if (/^archive\//i.test(to)) return { reason: "the Mac version doesn't load this from archive" };
    if (/^r6\/tweaks\//i.test(to)) return { reason: "needs TweakXL, which only runs on Windows" };
    if (/^bin\/x64\/plugins\/cyber_engine_tweaks\//i.test(to)) return { reason: "a Cyber Engine Tweaks mod: CET only runs on Windows" };
    if (/^bin\//i.test(to)) return { reason: "a Windows program file" };
    if (/^red4ext\//i.test(to)) return { reason: "needs RED4ext, which only runs on Windows" };
    if (/^mods\//i.test(to)) return { reason: "a REDmod mod: REDmod only runs on Windows" };
    return { to };
}

function cyberpunk(files, ctx) {
    const result = { placements: [], skipped: [], notes: [], plugins: [] };
    const onMac = (ctx.platform ?? process.platform) === "darwin";
    const folder = safeFolder(ctx.modName);
    const prefix = wrapper(files, (top) => CP_ROOTS.has(lower(top)));
    const tops = new Set(files.map((file) => under(file, prefix)).filter((rel) => rel?.includes("/")).map((rel) => lower(rel.split("/")[0])));
    const laidOut = [...tops].some((top) => CP_ROOTS.has(top));
    // Cyber Engine Tweaks mods: a folder with init.lua.
    const cetFolders = new Set(files.filter((file) => lower(base(file)) === "init.lua").map(dirOf));

    for (const file of files) {
        const rel = under(file, prefix);
        if (rel === null) continue;
        if (laidOut && rel.includes("/") && CP_ROOTS.has(lower(rel.split("/")[0]))) {
            result.placements.push({ from: file, base: "game", to: rel });
            continue;
        }
        const cet = [...cetFolders].find((dir) => under(file, dir) !== null);
        if (cet !== undefined && !laidOut) {
            const name = cet ? base(cet) : folder;
            result.placements.push({ from: file, base: "game", to: `bin/x64/plugins/cyber_engine_tweaks/mods/${name}/${under(file, cet)}` });
            continue;
        }
        const kind = ext(file);
        if (kind === ".archive" || kind === ".xl") result.placements.push({ from: file, base: "game", to: `archive/pc/mod/${base(file)}` });
        else if (kind === ".reds") result.placements.push({ from: file, base: "game", to: `r6/scripts/${folder}/${base(file)}` });
        else if (kind === ".yaml" || kind === ".yml" || kind === ".tweak") result.placements.push({ from: file, base: "game", to: `r6/tweaks/${folder}/${base(file)}` });
        else if (kind === ".dll") result.placements.push({ from: file, base: "game", to: `red4ext/plugins/${folder}/${base(file)}` });
        else if (!isDoc(file)) result.skipped.push({ file, reason: "not in a folder Cyberpunk 2077 loads mods from" });
    }

    if (onMac) {
        const kept = [];
        for (const placement of result.placements) {
            const moved = cyberpunkMacPlace(placement.to);
            if (moved.to) kept.push({ ...placement, to: moved.to });
            else result.skipped.push({ file: placement.from, reason: moved.reason });
        }
        result.placements = kept;
        if (!kept.length && files.some((file) => !isDoc(file))) {
            result.notes.push("Nothing in this mod loads in the Mac version of Cyberpunk 2077: there, only redscript mods run, and archive mods through archive-loader.");
        }
    }

    const placed = (pattern) => result.placements.some((p) => pattern.test(p.to));
    const frameworks = [
        { uses: /^bin\/x64\/plugins\/cyber_engine_tweaks\/mods\//i, has: "bin/x64/plugins/cyber_engine_tweaks.asi", name: "Cyber Engine Tweaks" },
        { uses: /^r6\/scripts\//i, has: onMac ? "engine/tools/scc" : "engine/tools/scc.exe", name: onMac ? "redscript for macOS" : "redscript" },
        { uses: /^archive-loader\/mods\/enabled\//i, has: "archive-loader/bin/archive-loader", name: "archive-loader" },
        { uses: /^red4ext\/plugins\//i, has: "red4ext/RED4ext.dll", name: "RED4ext" },
        { uses: /^r6\/tweaks\//i, has: "red4ext/plugins/TweakXL", name: "TweakXL" },
        { uses: /\.xl$/i, has: "red4ext/plugins/ArchiveXL", name: "ArchiveXL" },
    ];
    for (const framework of frameworks) {
        if (placed(framework.uses) && !ctx.gameHas?.(framework.has) && !placed(new RegExp(`^${framework.has.replace(/[.]/g, "\\.")}`, "i"))) {
            result.notes.push(`Needs ${framework.name} (on Nexus Mods).`);
        }
    }
    return result;
}

/* ---------------- Stardew Valley (SMAPI) ---------------- */

function smapi(files, ctx) {
    const result = { placements: [], skipped: [], notes: [], plugins: [] };
    const manifests = files.filter((file) => lower(base(file)) === "manifest.json").map(dirOf);
    // A mod folder inside another mod's folder belongs to it.
    const roots = manifests.filter((dir) => !manifests.some((other) => other !== dir && under(dir, other) !== null));
    for (const file of files) {
        const owner = roots.find((dir) => under(file, dir) !== null);
        if (owner === undefined) {
            if (!isDoc(file)) result.skipped.push({ file, reason: "not inside a SMAPI mod folder (one with manifest.json)" });
            continue;
        }
        const name = owner ? base(owner) : safeFolder(ctx.modName);
        result.placements.push({ from: file, base: "game", to: `Mods/${name}/${under(file, owner)}` });
    }
    if (!roots.length) result.notes.push("This isn't a SMAPI mod: there's no manifest.json in it.");
    if (roots.length && !ctx.gameHas?.("StardewModdingAPI.dll") && !ctx.gameHas?.("StardewModdingAPI")) result.notes.push("Needs SMAPI (smapi.io), the mod loader, installed into the game.");
    return result;
}

const PLANNERS = { sims4, gtav, bethesda, cyberpunk, smapi };

/* Where a mod's files go. ctx: { game, modName, dir (unpacked folder), gameHas(rel) } */
function plan(game, files, ctx) {
    const planner = PLANNERS[game.layout];
    if (!planner) throw new Error(`No install rules for ${game.name}.`);
    return planner(files, { ...ctx, game });
}

module.exports = { plan, nameFromFile, parseXml, wrapper };
