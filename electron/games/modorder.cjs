const fs = require("fs");
const os = require("os");
const path = require("path");
const plugins = require("./plugins.cjs");

/*
 * Which games have a load order that matters, and the ones that aren't Bethesda plugins:
 *
 *  - "plugins": Skyrim, Fallout, Oblivion, Starfield... (plugins.cjs, plugins.txt).
 *  - "modlist": Cyberpunk 2077's archive mods. They load by name, the first one winning where
 *    two change the same thing; archive/pc/mod/modlist.txt sets the order instead.
 *  - "rimworld": RimWorld's active mods in ModsConfig.xml. Later ones win, and each must load
 *    after what it needs and what its About.xml says to load after.
 *  - "bg3": Baldur's Gate 3's modsettings.lsx. Later ones win; the game's own modules stay first.
 * Games whose mods don't overlap, or that order them by what they need (Minecraft, Stardew
 * Valley's SMAPI), have none.
 */

const lower = (text) => String(text).toLowerCase();

/* ---------------- Bethesda games found on this computer ---------------- */

const SKSE = { name: "SKSE", url: "https://skse.silverlock.org" };
const SSE_OFFICIAL = ["skyrim.esm", "update.esm", "dawnguard.esm", "hearthfires.esm", "dragonborn.esm", "_resourcepack.esl"];

/*
 * The Bethesda games without a workspace of their own, by their Nexus Mods site, Steam app or
 * name. format: how plugins.txt lists them ("star" marks the ones on; "plain" lists only those,
 * with the whole order in loadorder.txt; "dates" lists only those, and the order is the plugin
 * files' dates). loot: LOOT's masterlist for the game.
 */
const BETHESDA_KIN = [
    {
        names: ["The Elder Scrolls V: Skyrim", "Skyrim", "The Elder Scrolls V: Skyrim Legendary Edition"],
        nexus: ["skyrim"],
        steam: ["72850"],
        bethesda: {
            appData: ["Skyrim"],
            format: "plain",
            extender: { ...SKSE, loader: "skse_loader.exe", prefix: "skse_" },
            official: ["skyrim.esm", "update.esm"],
            ccc: null,
            loot: "skyrim",
        },
    },
    {
        names: ["The Elder Scrolls V: Skyrim VR", "Skyrim VR"],
        nexus: ["skyrimvr"],
        steam: ["611670"],
        bethesda: {
            appData: ["Skyrim VR"],
            extender: { ...SKSE, name: "SKSEVR", loader: "sksevr_loader.exe", prefix: "sksevr_" },
            official: [...SSE_OFFICIAL, "skyrimvr.esm"],
            ccc: null,
            loot: "skyrimse",
        },
    },
    {
        names: ["Enderal: Forgotten Stories (Special Edition)", "Enderal Special Edition"],
        nexus: ["enderalspecialedition"],
        steam: ["976620"],
        bethesda: {
            appData: ["Enderal Special Edition"],
            extender: { ...SKSE, loader: "skse64_loader.exe", prefix: "skse64_" },
            official: [...SSE_OFFICIAL, "enderal - forgotten stories.esm"],
            ccc: null,
            loot: "enderal",
        },
    },
    {
        names: ["The Elder Scrolls IV: Oblivion", "Oblivion", "The Elder Scrolls IV: Oblivion Game of the Year Edition", "The Elder Scrolls IV: Oblivion Game of the Year Edition Deluxe"],
        nexus: ["oblivion"],
        steam: ["22330", "900883"],
        bethesda: {
            appData: ["Oblivion"],
            format: "dates",
            extender: { name: "OBSE", loader: "obse_loader.exe", prefix: "obse_", url: "https://github.com/llde/xOBSE" },
            official: ["oblivion.esm"],
            ccc: null,
            loot: "oblivion",
        },
    },
    {
        names: ["Fallout 3", "Fallout 3: Game of the Year Edition", "Fallout 3 GOTY"],
        nexus: ["fallout3"],
        steam: ["22300", "22370"],
        bethesda: {
            appData: ["Fallout3"],
            format: "dates",
            extender: { name: "FOSE", loader: "fose_loader.exe", prefix: "fose_", url: "https://fose.silverlock.org" },
            official: ["fallout3.esm"],
            ccc: null,
            loot: "fallout3",
        },
    },
    {
        names: ["Fallout: New Vegas", "Fallout New Vegas", "Fallout: New Vegas Ultimate Edition"],
        nexus: ["newvegas"],
        steam: ["22380", "22490"],
        bethesda: {
            appData: ["FalloutNV"],
            format: "dates",
            extender: { name: "NVSE", loader: "nvse_loader.exe", prefix: "nvse_", url: "https://github.com/xNVSE/NVSE" },
            official: ["falloutnv.esm"],
            ccc: null,
            loot: "falloutnv",
        },
    },
    {
        names: ["Fallout 4 VR"],
        nexus: ["fallout4vr"],
        steam: ["611660"],
        bethesda: {
            appData: ["Fallout4VR"],
            extender: { name: "F4SEVR", loader: "f4sevr_loader.exe", prefix: "f4sevr_", url: "https://f4se.silverlock.org" },
            official: ["fallout4.esm", "fallout4_vr.esm"],
            ccc: null,
            loot: "fallout4",
        },
    },
    {
        names: ["Starfield"],
        nexus: ["starfield"],
        steam: ["1716740"],
        bethesda: {
            appData: ["Starfield"],
            extender: { name: "SFSE", loader: "sfse_loader.exe", prefix: "sfse_", url: "https://sfse.silverlock.org" },
            official: ["starfield.esm", "constellation.esm", "oldmars.esm", "blueprintships-starfield.esm", "sfbgs003.esm", "sfbgs004.esm", "sfbgs006.esm", "sfbgs007.esm", "sfbgs008.esm", "shatteredspace.esm"],
            ccc: "Starfield.ccc",
            loot: "starfield",
        },
    },
];

/* The plugin rules for a game found or listed elsewhere, when it's one of Bethesda's; keyFor matches names. */
function bethesdaFor(def, keyFor) {
    const key = keyFor(def.name);
    const kin = BETHESDA_KIN.find(
        (entry) => (def.nexus && entry.nexus.includes(def.nexus)) || (def.steamAppIds ?? []).some((id) => entry.steam.includes(String(id))) || entry.names.some((name) => keyFor(name) === key)
    );
    return kin ? structuredClone(kin.bethesda) : null;
}

/* ---------------- which kind ---------------- */

// Cyberpunk on a Mac loads archive mods through archive-loader, which has no order to set.
const archiveLoader = (loc) => process.platform === "darwin" && !/[\\/]drive_c[\\/]/.test(loc?.gameDir ?? "");

/* "plugins", "modlist", "rimworld", "bg3", or null where the order doesn't matter. */
function kindOf(game, loc) {
    if (game.bethesda) return "plugins";
    const steam = new Set((game.steamAppIds ?? []).map(String));
    const has = (rel) => Boolean(loc?.gameDir) && fs.existsSync(path.join(loc.gameDir, rel));
    if (game.layout === "cyberpunk" || has("archive/pc/content")) return archiveLoader(loc) ? null : "modlist";
    if (game.nexus === "rimworld" || steam.has("294100") || has("Data/Core/About/About.xml") || has("RimWorldMac.app/Data/Core/About/About.xml")) return "rimworld";
    if (game.nexus === "baldursgate3" || steam.has("1086940") || has("Data/Gustav.pak") || has("Data/GustavX.pak")) return "bg3";
    return null;
}

/* ---------------- Cyberpunk: modlist.txt ---------------- */

const modlistDir = (loc) => path.join(loc.gameDir, "archive", "pc", "mod");
const byName = (a, b) => (lower(a) < lower(b) ? -1 : lower(a) > lower(b) ? 1 : 0);

function readLines(file) {
    try {
        return fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    } catch {
        return [];
    }
}

/* Which installed mod each game file came from, by its path in the game's folder. */
function owners(game) {
    const owner = new Map();
    try {
        for (const mod of require("./store.cjs").readState(game.id).mods) for (const file of mod.files ?? []) owner.set(lower(file.to), mod.name);
    } catch {
        // Nothing installed through the launcher.
    }
    return owner;
}

function modlist(game, loc) {
    const dir = modlistDir(loc);
    let files = [];
    try {
        files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && /\.archive$/i.test(e.name)).map((e) => e.name);
    } catch {
        files = [];
    }
    const present = new Map(files.map((name) => [lower(name), name]));
    // Ones listed load first, in its order; the rest after, by name.
    const listed = [...new Set(readLines(path.join(dir, "modlist.txt")).map(lower))].filter((name) => present.has(name)).map((name) => present.get(name));
    const rest = files.filter((name) => !listed.includes(name)).sort(byName);
    const owner = owners(game);
    const entries = [...listed, ...rest].map((file) => {
        const mod = owner.get(lower(`archive/pc/mod/${file}`));
        return { id: file, name: mod ?? file.replace(/\.archive$/i, ""), note: mod ? file : null, active: true, fixed: false, problems: [] };
    });
    return { kind: "modlist", file: path.join(dir, "modlist.txt"), toggles: false, entries };
}

function writeModlist(game, loc, wanted) {
    const current = modlist(game, loc).entries.map((e) => e.id);
    const order = [...wanted.map((e) => current.find((id) => lower(id) === lower(e.id))).filter(Boolean)];
    for (const id of current) if (!order.includes(id)) order.push(id);
    fs.mkdirSync(modlistDir(loc), { recursive: true });
    fs.writeFileSync(path.join(modlistDir(loc), "modlist.txt"), `${order.join("\r\n")}\r\n`);
}

/* ---------------- RimWorld: ModsConfig.xml ---------------- */

function rimworldConfig() {
    const rel = ["Config", "ModsConfig.xml"];
    if (process.platform === "win32") return path.join(process.env.USERPROFILE ?? os.homedir(), "AppData", "LocalLow", "Ludeon Studios", "RimWorld by Ludeon Studios", ...rel);
    if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "RimWorld", ...rel);
    return path.join(os.homedir(), ".config", "unity3d", "Ludeon Studios", "RimWorld by Ludeon Studios", ...rel);
}

const CORE = "ludeon.rimworld";
// A Workshop copy of a mod also installed by hand is listed with "_steam" on the end.
const baseId = (id) => lower(id).replace(/_steam$/, "");
const tag = (xml, name) => xml.match(new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`, "i"))?.[1] ?? null;
const items = (xml, name) => {
    const block = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "";
    return [...block.matchAll(/<li>\s*([^<]*?)\s*<\/li>/gi)].map((m) => lower(m[1])).filter(Boolean);
};

/* A mod's About.xml: { id, name, after, before, needs: [{ id, name }] }, or null. */
function about(dir) {
    let xml;
    try {
        xml = fs.readFileSync(path.join(dir, "About", "About.xml"), "utf8");
    } catch {
        return null;
    }
    const depsBlock = xml.match(/<modDependencies>([\s\S]*?)<\/modDependencies>/i)?.[1] ?? "";
    const needs = [...depsBlock.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((m) => ({ id: lower(tag(m[1], "packageId") ?? ""), name: tag(m[1], "displayName") })).filter((d) => d.id);
    const own = xml.replace(/<modDependencies(ByVersion)?>[\s\S]*?<\/modDependencies(ByVersion)?>/gi, "");
    const id = tag(own, "packageId");
    if (!id) return null;
    return {
        id: lower(id),
        name: tag(own, "name") ?? id,
        after: [...items(own, "loadAfter"), ...items(own, "forceLoadAfter")],
        before: [...items(own, "loadBefore"), ...items(own, "forceLoadBefore")],
        needs,
    };
}

/* The mods on this computer: the game's own (Data), ones added by hand (Mods) and the Workshop's. */
function rimworldMods(loc) {
    const found = new Map();
    const roots = [loc.gameDir, path.join(loc.gameDir, "RimWorldMac.app")].filter((root) => fs.existsSync(path.join(root, "Data")) || fs.existsSync(path.join(root, "Mods")));
    const workshop = path.resolve(loc.gameDir, "..", "..", "workshop", "content", "294100");
    const folders = [...roots.flatMap((root) => [path.join(root, "Data"), path.join(root, "Mods")]), workshop];
    for (const folder of folders) {
        let dirs = [];
        try {
            dirs = fs.readdirSync(folder, { withFileTypes: true }).filter((e) => e.isDirectory());
        } catch {
            continue;
        }
        for (const dir of dirs) {
            const mod = about(path.join(folder, dir.name));
            if (mod && !found.has(mod.id)) found.set(mod.id, mod);
        }
    }
    return found;
}

function rimworldActive(xml) {
    const block = xml.match(/<activeMods>([\s\S]*?)<\/activeMods>/i);
    if (!block) return [];
    return [...block[1].matchAll(/<li>\s*([^<]*?)\s*<\/li>/gi)].map((m) => m[1]).filter(Boolean);
}

function rimworldConfigText() {
    const file = rimworldConfig();
    try {
        return { file, xml: fs.readFileSync(file, "utf8") };
    } catch {
        return { file, xml: null };
    }
}

/* What's wrong with each mod that's on, in this order. */
function rimworldProblems(order, mods) {
    const position = new Map(order.map((id, i) => [baseId(id), i]));
    const nameOf = (id, fallback) => mods.get(id)?.name ?? fallback ?? id;
    return order.map((id, i) => {
        const mod = mods.get(baseId(id));
        if (!mod) return [];
        const problems = [];
        for (const need of mod.needs) {
            if (!mods.has(need.id)) problems.push(`Needs ${nameOf(need.id, need.name)}, which isn't installed`);
            else if (!position.has(need.id)) problems.push(`Needs ${nameOf(need.id, need.name)}, which is turned off`);
            else if (position.get(need.id) > i) problems.push(`Needs ${nameOf(need.id, need.name)}, which loads after it`);
        }
        for (const other of mod.after) if (position.get(other) > i && !mod.needs.some((n) => n.id === other)) problems.push(`Should load after ${nameOf(other)}`);
        for (const other of mod.before) if (position.get(other) < i) problems.push(`Should load before ${nameOf(other)}`);
        return problems;
    });
}

function rimworld(game, loc) {
    const { file, xml } = rimworldConfigText();
    const mods = rimworldMods(loc);
    const active = xml ? rimworldActive(xml) : [];
    const activeSet = new Set(active.map(baseId));
    const problems = rimworldProblems(active, mods);
    const entry = (id, on, i) => ({
        id,
        name: mods.get(baseId(id))?.name ?? id,
        note: baseId(id),
        active: on,
        fixed: baseId(id) === CORE,
        problems: on ? problems[i] : [],
    });
    const off = [...mods.values()].filter((mod) => !activeSet.has(mod.id)).sort((a, b) => byName(a.name, b.name));
    return {
        kind: "rimworld",
        file: xml === null ? null : file,
        toggles: true,
        entries: [...active.map((id, i) => entry(id, true, i)), ...off.map((mod) => entry(mod.id, false))],
    };
}

function writeRimworld(game, loc, wanted) {
    const { file, xml } = rimworldConfigText();
    if (xml === null) throw new Error("RimWorld makes its mod list (ModsConfig.xml) the first time it starts. Start it once, then come back.");
    const on = [];
    for (const entry of wanted) if ((entry.active || baseId(entry.id) === CORE) && !on.some((id) => baseId(id) === baseId(entry.id))) on.push(String(entry.id));
    if (!on.some((id) => baseId(id) === CORE)) on.unshift(CORE);
    const indent = xml.match(/\n([ \t]*)<li>/)?.[1] ?? "    ";
    const outer = xml.match(/\n([ \t]*)<\/activeMods>/)?.[1] ?? "  ";
    const list = `<activeMods>\n${on.map((id) => `${indent}<li>${id}</li>`).join("\n")}\n${outer}</activeMods>`;
    const next = /<activeMods>[\s\S]*?<\/activeMods>|<activeMods\s*\/>/i.test(xml)
        ? xml.replace(/<activeMods>[\s\S]*?<\/activeMods>|<activeMods\s*\/>/i, list)
        : xml.replace(/<\/ModsConfigData>/i, `  ${list}\n</ModsConfigData>`);
    fs.writeFileSync(file, next);
}

/*
 * The order that works, changing as little as it can: what each mod needs turned on, then each
 * after what it needs and what it asks to load after, and before what it asks to load before.
 */
function fixRimworld(game, loc) {
    const { entries } = rimworld(game, loc);
    const mods = rimworldMods(loc);
    const on = new Set(entries.filter((e) => e.active).map((e) => baseId(e.id)));
    const turnOn = [];
    for (let changed = true; changed; ) {
        changed = false;
        for (const id of [...on]) {
            for (const need of mods.get(id)?.needs ?? []) {
                if (on.has(need.id) || !mods.has(need.id)) continue;
                on.add(need.id);
                turnOn.push(mods.get(need.id).name);
                changed = true;
            }
        }
    }
    const order = [...entries.filter((e) => e.active).map((e) => e.id), ...entries.filter((e) => !e.active && on.has(baseId(e.id))).map((e) => e.id)];
    // Who has to come first for each.
    const first = new Map(order.map((id) => [baseId(id), new Set()]));
    for (const id of order) {
        const mod = mods.get(baseId(id));
        if (!mod) continue;
        for (const other of [...mod.needs.map((n) => n.id), ...mod.after]) if (first.has(other) && other !== mod.id) first.get(mod.id).add(other);
        for (const other of mod.before) if (first.has(other) && other !== mod.id) first.get(other).add(mod.id);
    }
    // The core game goes before anything that doesn't ask to go before it.
    for (const [id, set] of first) if (id !== CORE && first.has(CORE) && !first.get(CORE).has(id)) set.add(CORE);
    const sorted = [];
    const placed = new Set();
    const left = [...order];
    while (left.length) {
        let at = left.findIndex((id) => [...first.get(baseId(id))].every((other) => placed.has(other)));
        if (at < 0) at = 0; // Rules that contradict each other: keep the order there.
        const [id] = left.splice(at, 1);
        sorted.push(id);
        placed.add(baseId(id));
    }
    const moved = sorted.filter((id, i) => order.filter((o) => sorted.includes(o))[i] !== id).length;
    const rest = entries.filter((e) => !on.has(baseId(e.id))).map((e) => ({ id: e.id, active: false }));
    return { order: [...sorted.map((id) => ({ id, active: true })), ...rest], turnOn, moved };
}

/* ---------------- Baldur's Gate 3: modsettings.lsx ---------------- */

function bg3File(loc) {
    const rel = ["Larian Studios", "Baldur's Gate 3", "PlayerProfiles", "Public", "modsettings.lsx"];
    const local = plugins.appDataLocal(loc.gameDir);
    if (local) return path.join(local, ...rel);
    if (process.platform === "darwin") return path.join(os.homedir(), "Documents", ...rel);
    return null;
}

const attr = (block, id) => block.match(new RegExp(`<attribute\\s+id="${id}"[^>]*?\\svalue="([^"]*)"`, "i"))?.[1] ?? null;
// The game's own modules, which always load first.
const isBase = (block) => /^Gustav(Dev|X)?$/i.test(attr(block, "Folder") ?? "") || /^(GustavDev|GustavX|Gustav)$/i.test(attr(block, "Name") ?? "");

/* The Mods list: its blocks, where they sit in the file, and what's between them. */
function bg3Blocks(xml) {
    const start = xml.search(/<node\s+id="Mods"\s*>/i);
    if (start < 0) return null;
    const blocks = [];
    const re = /<node\s+id="ModuleShortDesc"\s*>[\s\S]*?<\/node>/gi;
    re.lastIndex = start;
    // The Mods list ends where the next list starts (old files have ModOrder too).
    const nextList = xml.slice(start + 1).search(/<node\s+id="(?!ModuleShortDesc)[^"]+"\s*>/i);
    const end = nextList < 0 ? xml.length : start + 1 + nextList;
    let match;
    while ((match = re.exec(xml)) && match.index < end) blocks.push({ text: match[0], at: match.index });
    return blocks;
}

function bg3Read(loc) {
    const file = bg3File(loc);
    if (!file) throw new Error("Baldur's Gate 3's mod list is only read on Windows, a Mac, or in a CrossOver bottle.");
    let xml = null;
    try {
        xml = fs.readFileSync(file, "utf8");
    } catch {
        xml = null;
    }
    return { file, xml, blocks: xml ? bg3Blocks(xml) ?? [] : [] };
}

function bg3(game, loc) {
    const { file, xml, blocks } = bg3Read(loc);
    const entries = blocks.map((block) => {
        const name = attr(block.text, "Name") ?? attr(block.text, "Folder") ?? "Unknown mod";
        return { id: attr(block.text, "UUID") ?? name, name, note: attr(block.text, "Folder"), active: true, fixed: isBase(block.text), problems: [] };
    });
    return { kind: "bg3", file: xml === null ? null : file, toggles: false, entries: [...entries.filter((e) => e.fixed), ...entries.filter((e) => !e.fixed)] };
}

function writeBg3(game, loc, wanted) {
    const { file, xml, blocks } = bg3Read(loc);
    if (xml === null || !blocks.length) throw new Error("Baldur's Gate 3 makes its mod list (modsettings.lsx) the first time it starts. Start it once, then come back.");
    const uuid = (block) => lower(attr(block.text, "UUID") ?? "");
    const rank = new Map(wanted.map((e, i) => [lower(e.id), i]));
    const base = blocks.filter((b) => isBase(b.text));
    const mods = blocks.filter((b) => !isBase(b.text)).map((b, i) => ({ b, i })).sort((x, y) => (rank.get(uuid(x.b)) ?? 1e6 + x.i) - (rank.get(uuid(y.b)) ?? 1e6 + y.i)).map((x) => x.b);
    const order = [...base, ...mods];
    // Each block goes where one was, so the file's layout stays as it was.
    let next = "";
    let from = 0;
    blocks.forEach((block, i) => {
        next += xml.slice(from, block.at) + order[i].text;
        from = block.at + block.text.length;
    });
    next += xml.slice(from);
    // Files from before Patch 7 also list the UUIDs in ModOrder.
    next = next.replace(/(<node\s+id="ModOrder"\s*>\s*<children>)([\s\S]*?)(<\/children>\s*<\/node>)/i, (all, open, inner, close) => {
        const modules = [...inner.matchAll(/<node\s+id="Module"\s*>[\s\S]*?<\/node>/gi)].map((m) => m[0]);
        if (!modules.length) return all;
        const pos = new Map(order.map((b, i) => [uuid(b), i]));
        const sorted = [...modules].sort((a, b) => (pos.get(lower(attr(a, "UUID") ?? "")) ?? 1e6) - (pos.get(lower(attr(b, "UUID") ?? "")) ?? 1e6));
        let k = 0;
        return open + inner.replace(/<node\s+id="Module"\s*>[\s\S]*?<\/node>/gi, () => sorted[k++]) + close;
    });
    fs.writeFileSync(file, next);
}

/* ---------------- the shared calls ---------------- */

const READ = { modlist, rimworld, bg3 };
const WRITE = { modlist: writeModlist, rimworld: writeRimworld, bg3: writeBg3 };

function need(game, loc) {
    const kind = kindOf(game, loc);
    if (!kind || kind === "plugins") throw new Error(`${game.name} has no mod order to set here.`);
    if (!loc.gameDir) throw new Error(`${game.name}'s folder wasn't found. Choose it in its Settings.`);
    return kind;
}

/* { kind, file, toggles, entries: [{ id, name, note, active, fixed, problems }], fix: { turnOn, moved } } */
function read(game, loc) {
    const kind = need(game, loc);
    const order = READ[kind](game, loc);
    let fix = { turnOn: [], moved: 0 };
    if (kind === "rimworld" && order.file) {
        const plan = fixRimworld(game, loc);
        fix = { turnOn: plan.turnOn, moved: plan.moved };
    }
    return { ...order, fix };
}

/* Sets the order: entries [{ id, active }], top to bottom. */
function write(game, loc, entries) {
    const kind = need(game, loc);
    WRITE[kind](
        game,
        loc,
        (Array.isArray(entries) ? entries : []).map((e) => ({ id: String(e?.id ?? ""), active: e?.active !== false })).filter((e) => e.id)
    );
    return read(game, loc);
}

/* Puts it in an order that works, where the game's mods say what they need (RimWorld). */
function fix(game, loc) {
    const kind = need(game, loc);
    if (kind !== "rimworld") return read(game, loc);
    const plan = fixRimworld(game, loc);
    writeRimworld(game, loc, plan.order);
    return { ...read(game, loc), done: { turnOn: plan.turnOn, moved: plan.moved } };
}

/* How many mods are in an order that won't work, for the game's Home. */
function problems(game, loc) {
    const kind = kindOf(game, loc);
    if (kind !== "rimworld" || !loc.gameDir) return 0;
    return rimworld(game, loc).entries.filter((e) => e.problems.length).length;
}

module.exports = { BETHESDA_KIN, bethesdaFor, kindOf, read, write, fix, problems, rimworldConfig, bg3File };
