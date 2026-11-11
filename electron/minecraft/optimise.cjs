const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const instanceMods = require("./instanceMods.cjs");
const modSearch = require("./modSearch.cjs");
const { modInfo, modsIn } = require("./modInfo.cjs");
const { problemsWith } = require("./compat.cjs");
const { ensureDependencies } = require("./modDependencies.cjs");
const { addonCheck, missingDependencies } = require("./modUpdates.cjs");
const { requiredJava } = require("./javaRuntime.cjs");
const { downloadFile } = require("./net.cjs");

const run = promisify(execFile);

/*
 * Optimise: what's slowing an instance down, and a fix for each, like Lunar Client's
 * performance settings. It looks at the computer (graphics, memory, screen) and the
 * instance (its mods, shaders, Java settings, graphics settings and resource packs).
 *
 * Nothing changes until a fix is chosen, and every fix is recorded, so Undo puts back the
 * settings it changed and removes the mods it added. Mods are checked like updates are,
 * and any that wouldn't work with the instance are left out, with the reason.
 */

const BACKUP = "optimise-backup.json";

/* ---------------- the computer ---------------- */

let hardwareFound = null;

/* The graphics card that matters (a separate one over a built-in one), memory, threads, and a Retina screen. */
function hardware() {
    hardwareFound ??= findHardware().catch(() => ({ gpu: null, builtIn: false, weak: false, retina: false, memoryGb: Math.round(os.totalmem() / 2 ** 30), cores: os.cpus().length }));
    return hardwareFound;
}

async function findHardware() {
    let gpu = null;
    let builtIn = false;
    try {
        if (process.platform === "darwin") {
            const { stdout } = await run("system_profiler", ["SPDisplaysDataType", "-json"], { timeout: 20000 });
            const cards = JSON.parse(stdout).SPDisplaysDataType ?? [];
            const best = cards.find((card) => card.sppci_bus !== "spdisplays_builtin") ?? cards[0];
            gpu = best?.sppci_model ?? null;
            builtIn = best?.sppci_bus === "spdisplays_builtin";
        } else if (process.platform === "win32") {
            const { stdout } = await run("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController).Name"], { timeout: 20000 });
            const cards = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            gpu = cards.find((name) => !/Intel|Microsoft Basic/i.test(name) || /Arc/i.test(name)) ?? cards[0] ?? null;
        } else {
            const { stdout } = await run("lspci", [], { timeout: 20000 });
            const cards = stdout.split("\n").filter((line) => /VGA|3D controller|Display controller/.test(line)).map((line) => line.split(": ").slice(1).join(": "));
            gpu = cards.find((name) => !/Intel/i.test(name) || /Arc/i.test(name)) ?? cards[0] ?? null;
        }
    } catch {
        // Unknown graphics: treated as capable, so nothing is turned down on a guess.
    }

    // Built-in Intel graphics (not Arc) and AMD's built-in Radeon struggle with Minecraft;
    // Apple's M chips and separate cards don't.
    const name = gpu ?? "";
    const weak = (/Intel/i.test(name) && !/Arc/i.test(name)) || /Radeon\(TM\) Graphics|Radeon Graphics|Vega \d+ Graphics/i.test(name);
    if (/Intel|Radeon\(TM\) Graphics|Radeon Graphics|Vega \d+ Graphics/i.test(name) && process.platform !== "darwin") builtIn = !/Arc/i.test(name);

    let retina = false;
    try {
        retina = process.platform === "darwin" && require("electron").screen.getAllDisplays().some((display) => display.scaleFactor > 1);
    } catch {
        // No screen information (outside the app).
    }

    return { gpu, builtIn, weak, retina, memoryGb: Math.round(os.totalmem() / 2 ** 30), cores: os.cpus().length };
}

/* ---------------- speed mods ---------------- */

/*
 * The usual speed mods, by every id they (or a mod doing the same job) go by, and where
 * to get them on Modrinth, first choice first. Only offered when there's a build for the
 * instance's Minecraft version and loader.
 */
const SPEED_MODS = [
    { name: "Sodium", ids: ["sodium", "embeddium", "rubidium", "magnesium"], projects: ["sodium", "embeddium"], why: "Draws the world far faster", clashesWith: ["optifabric", "optifine"] },
    { name: "Lithium", ids: ["lithium", "canary", "radium"], projects: ["lithium"], why: "Speeds up the game's own work: mobs, redstone and chunks" },
    { name: "FerriteCore", ids: ["ferritecore"], projects: ["ferrite-core"], why: "Uses much less memory" },
    { name: "Entity Culling", ids: ["entityculling"], projects: ["entityculling"], why: "Skips drawing mobs and chests you can't see" },
    { name: "ImmediatelyFast", ids: ["immediatelyfast"], projects: ["immediatelyfast"], why: "Draws text, items and the HUD faster" },
    { name: "ModernFix", ids: ["modernfix"], projects: ["modernfix"], why: "Starts faster and uses less memory" },
    { name: "More Culling", ids: ["moreculling"], projects: ["moreculling"], why: "Skips drawing more of the blocks you can't see" },
    { name: "Dynamic FPS", ids: ["dynamic_fps", "dynamicfps"], projects: ["dynamic-fps"], why: "Slows the game right down while it's in the background, so it doesn't heat your computer" },
    {
        name: "retiNO",
        ids: ["retino"],
        projects: ["retino"],
        why: "Draws at normal resolution on the Retina screen instead of four times the pixels: slightly softer, much faster",
        when: (hw) => hw.retina && hw.weak,
    },
];

/* The speed mods this instance doesn't have, that have a build for it: [{ name, why, project, file }]. */
async function missingSpeedMods(instance, mods, hw) {
    const loader = String(instance.loader || "vanilla").toLowerCase();
    if (loader === "vanilla") return [];
    const ids = new Set(mods.flatMap((mod) => mod.ids).map((id) => id.toLowerCase()));
    const files = mods.map((mod) => mod.fileName.toLowerCase());

    const wanted = SPEED_MODS.filter(
        (mod) =>
            !mod.ids.some((id) => ids.has(id)) &&
            !(mod.clashesWith ?? []).some((id) => ids.has(id) || files.some((file) => file.includes(id))) &&
            (!mod.when || mod.when(hw))
    );

    const found = await Promise.all(
        wanted.map(async (mod) => {
            for (const project of mod.projects) {
                try {
                    const file = await modSearch.resolveModFile("modrinth", project, instance.version, loader, "mod");
                    return { name: mod.name, why: mod.why, project, file };
                } catch {
                    // No build of this one for the version; try the next.
                }
            }
            return null;
        })
    );
    return found.filter(Boolean);
}

/*
 * Mods that cost a lot of speed for what they do, by id. Advice only: they're there
 * because someone wanted them.
 */
const HEAVY_MODS = [
    { ids: ["distanthorizons"], name: "Distant Horizons", why: "draws far-off terrain, the heaviest kind of mod there is" },
    { ids: ["physicsmod"], name: "Physics Mod", why: "simulates physics for blocks and mobs" },
    { ids: ["essential", "essential-container", "essential-loader"], name: "Essential", why: "runs cosmetics, friends and its own menus in the background" },
    { ids: ["axiom"], name: "Axiom", why: "a building editor that's always running; turn it off when you're not building" },
    { ids: ["xaeroworldmap"], name: "Xaero's World Map", why: "maps the world as you explore, which takes memory and time" },
    { ids: ["xaerominimap"], name: "Xaero's Minimap", why: "draws a map on screen every frame" },
    { ids: ["effective"], name: "Effective", why: "adds splashes, waterfalls and fireflies everywhere" },
    { ids: ["visuality"], name: "Visuality", why: "adds lots of extra particles" },
    { ids: ["particlerain"], name: "Particle Rain", why: "turns rain and snow into thousands of particles" },
    { ids: ["sound_physics_remastered"], name: "Sound Physics Remastered", why: "works out echoes for every sound" },
    { ids: ["wakes"], name: "Wakes", why: "draws water wakes behind boats and swimmers" },
];

const heavyMods = (enabledMods) => HEAVY_MODS.filter((heavy) => enabledMods.some((mod) => mod.ids.some((id) => heavy.ids.includes(id.toLowerCase()))));

/* ---------------- the game's own settings ---------------- */

const gameDir = (folder) => path.join(folder, ".minecraft");

function readOptions(folder) {
    const file = path.join(gameDir(folder), "options.txt");
    try {
        const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
        const values = {};
        for (const line of lines) {
            const at = line.indexOf(":");
            if (at > 0) values[line.slice(0, at)] = line.slice(at + 1);
        }
        return { file, lines, values };
    } catch {
        return null;
    }
}

/* Writes changed values back, keeping every other line as it was. */
function writeOptions(options, changes) {
    const lines = options.lines.map((line) => {
        const at = line.indexOf(":");
        const key = at > 0 ? line.slice(0, at) : null;
        return key && key in changes ? `${key}:${changes[key]}` : line;
    });
    fs.writeFileSync(options.file, lines.join("\n"));
}

const unquote = (value) => String(value ?? "").replace(/^"|"$/g, "");
const onOff = (value) => (value === "true" ? "on" : "off");

/*
 * The graphics settings worth turning down: [{ key, label, from, to, value }]. Only the
 * settings this version of Minecraft has are looked at, as each version names them its
 * own way. On weak graphics they're turned down further.
 */
function graphicsChanges(values, hw) {
    const changes = [];
    const add = (key, label, from, to, value) => changes.push({ key, label, from, to, value });
    const number = (key) => (key in values ? Number(values[key]) : NaN);

    // 26.x: a preset; older versions: a number (0 fast, 1 fancy, 2 fabulous).
    if ("graphicsPreset" in values) {
        const preset = unquote(values.graphicsPreset);
        if (hw.weak && (preset === "fancy" || preset === "fabulous")) add("graphicsPreset", "Graphics", preset, "fast", '"fast"');
        else if (preset === "fabulous") add("graphicsPreset", "Graphics", preset, "fancy", '"fancy"');
    } else if ("graphicsMode" in values) {
        const names = ["fast", "fancy", "fabulous"];
        const mode = number("graphicsMode");
        if (hw.weak && mode >= 1) add("graphicsMode", "Graphics", names[mode] ?? mode, "fast", "0");
        else if (mode === 2) add("graphicsMode", "Graphics", "fabulous", "fancy", "1");
    }
    if (values.improvedTransparency === "true") add("improvedTransparency", "Improved transparency", "on", "off", "false");

    const maxRender = hw.weak ? 8 : 12;
    if (number("renderDistance") > maxRender) add("renderDistance", "Render distance", `${values.renderDistance} chunks`, `${maxRender} chunks`, String(maxRender));
    const maxSimulation = hw.weak ? 6 : 8;
    if (number("simulationDistance") > maxSimulation) add("simulationDistance", "Simulation distance", `${values.simulationDistance} chunks`, `${maxSimulation} chunks`, String(maxSimulation));

    if (values.entityShadows === "true") add("entityShadows", "Entity shadows", "on", "off", "false");
    if (number("particles") === 0) add("particles", "Particles", "all", "decreased", "1");

    const maxBlend = hw.weak ? 1 : 2;
    if (number("biomeBlendRadius") > maxBlend) add("biomeBlendRadius", "Biome blend", `${values.biomeBlendRadius * 2 + 1}×${values.biomeBlendRadius * 2 + 1}`, `${maxBlend * 2 + 1}×${maxBlend * 2 + 1}`, String(maxBlend));

    // Clouds: 26.x says renderClouds, older versions cloudStatus; "true" is fancy.
    for (const key of ["renderClouds", "cloudStatus"]) {
        if (!(key in values)) continue;
        const clouds = unquote(values[key]);
        if (clouds === "true" || clouds === "fancy") add(key, "Clouds", "fancy", "fast", values[key].startsWith('"') ? '"fast"' : "fast");
    }

    if (hw.weak) {
        if (number("entityDistanceScaling") > 0.75) add("entityDistanceScaling", "Entity distance", `${Math.round(number("entityDistanceScaling") * 100)}%`, "75%", "0.75");
        if (values.ao === "true") add("ao", "Smooth lighting", onOff(values.ao), "off", "false");
        if (number("mipmapLevels") > 2) add("mipmapLevels", "Mipmap levels", values.mipmapLevels, "2", "2");
        if (number("cloudRange") > 64) add("cloudRange", "Cloud distance", `${values.cloudRange} chunks`, "32 chunks", "32");
    }
    return changes;
}

/* ---------------- shaders ---------------- */

/* Shaders that are on through Iris (or Oculus, its NeoForge/Forge port): { mod, pack, file } or null. */
function shadersOn(folder, mods) {
    const shaderMod = mods.find((mod) => mod.enabled && mod.ids.some((id) => id === "iris" || id === "oculus"));
    if (!shaderMod) return null;
    for (const name of ["iris.properties", "oculus.properties"]) {
        const file = path.join(gameDir(folder), "config", name);
        let text;
        try {
            text = fs.readFileSync(file, "utf8");
        } catch {
            continue;
        }
        const enabled = /^enableShaders\s*=\s*true\s*$/m.test(text);
        const pack = text.match(/^shaderPack\s*=\s*(.+)$/m)?.[1]?.trim();
        if (enabled && pack) return { mod: shaderMod.name, pack: pack.replace(/\.zip$/i, ""), file };
    }
    return null;
}

/* ---------------- Java ---------------- */

// The Minecraft Launcher's own garbage collection settings: shorter pauses, so fewer stutters.
const SMOOTH_GC = "-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M";

/* Memory for this many mods, within half the computer's memory. */
function memoryFor(modCount, hw) {
    const wanted = modCount < 40 ? 4 : modCount < 120 ? 6 : 8;
    const most = Math.max(2, Math.floor(hw.memoryGb / 2));
    return { wanted: Math.min(wanted, most), most };
}

function javaChanges(instance, globalJvmArgs, modCount, hw) {
    const changes = [];
    const ram = Number(instance.ram) || 4;
    const { wanted, most } = memoryFor(modCount, hw);
    if (ram > most) changes.push({ key: "ram", label: "Memory", from: `${ram} GB`, to: `${most} GB`, value: most, reason: `more than half your computer's ${hw.memoryGb} GB leaves too little for everything else` });
    else if (ram < wanted) changes.push({ key: "ram", label: "Memory", from: `${ram} GB`, to: `${wanted} GB`, value: wanted, reason: `${modCount} mods need more room` });

    const args = String(instance.jvmArgs || globalJvmArgs || "").trim();
    if (!/-XX:\+Use\w+GC/.test(args)) {
        changes.push({
            key: "jvmArgs",
            label: "Garbage collection",
            from: "Java's default",
            to: "Minecraft Launcher's (fewer stutters)",
            value: [args, SMOOTH_GC].filter(Boolean).join(" "),
        });
    }
    return changes;
}

/* ---------------- resource packs ---------------- */

function folderSize(target) {
    try {
        const stat = fs.statSync(target);
        if (!stat.isDirectory()) return stat.size;
        return fs.readdirSync(target).reduce((sum, name) => sum + folderSize(path.join(target, name)), 0);
    } catch {
        return 0;
    }
}

/* The resource packs that are on, largest first: [{ name, size }]. */
function activePacks(folder, values) {
    let list = [];
    try {
        list = JSON.parse(values.resourcePacks ?? "[]");
    } catch {
        return [];
    }
    return list
        .filter((entry) => String(entry).startsWith("file/"))
        .map((entry) => {
            const name = String(entry).slice(5);
            return { name: name.replace(/\.zip$/i, ""), size: folderSize(path.join(gameDir(folder), "resourcepacks", name)) };
        })
        .sort((a, b) => b.size - a.size);
}

const megabytes = (bytes) => `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;

/* ---------------- the check ---------------- */

/*
 * What's slowing the instance down. -> { hardware, running, items, undo }, where each item
 * is { id, state: "fix" | "tip" | "ok", title, detail, list, action }: "fix" has a change
 * that should help, "tip" is advice (or an optional change), "ok" needs nothing.
 */
async function check(instance, folder, { running = false, globalJvmArgs = "" } = {}) {
    const hw = await hardware();
    const mods = await modsIn(instanceMods.modsDir(folder));
    const enabledMods = mods.filter((mod) => mod.enabled);
    const items = [];

    // Speed mods.
    const loader = String(instance.loader || "vanilla").toLowerCase();
    if (loader === "vanilla") {
        items.push({ id: "mods", state: "tip", title: "Speed mods", detail: "Speed mods like Sodium need a mod loader. This instance is vanilla, so a Fabric instance of the same version would run faster." });
    } else {
        const missing = await missingSpeedMods(instance, mods, hw);
        items.push(
            missing.length
                ? {
                      id: "mods",
                      state: "fix",
                      title: "Speed mods",
                      detail: `${missing.length === 1 ? "One speed mod is" : `${missing.length} speed mods are`} missing. Each is checked against your other mods before it goes in.`,
                      list: missing.map((mod) => ({ label: mod.name, text: mod.why })),
                      action: `Add ${missing.length === 1 ? missing[0].name : `${missing.length} mods`}`,
                  }
                : { id: "mods", state: "ok", title: "Speed mods", detail: "All the usual speed mods for this version are in." }
        );
    }

    // Shaders.
    const shaders = shadersOn(folder, enabledMods);
    items.push(
        shaders
            ? {
                  id: "shaders",
                  state: hw.weak ? "fix" : "tip",
                  title: "Shaders",
                  detail: hw.weak
                      ? `${shaders.pack} is on. Shaders are the heaviest thing you can run, and too much for ${hw.gpu ?? "built-in graphics"}.`
                      : `${shaders.pack} is on. Shaders cost a lot of speed; turn them off when you want more.`,
                  action: "Turn off shaders",
              }
            : { id: "shaders", state: "ok", title: "Shaders", detail: "Shaders are off." }
    );

    // Java.
    const java = javaChanges(instance, globalJvmArgs, enabledMods.length, hw);
    items.push(
        java.length
            ? {
                  id: "java",
                  state: "fix",
                  title: "Java settings",
                  detail: "How much memory Minecraft has, and how it cleans up after itself. The default cleaning causes stutters.",
                  list: java.map((change) => ({ label: change.label, text: `${change.from} → ${change.to}${change.reason ? ` (${change.reason})` : ""}` })),
                  action: "Use these",
              }
            : { id: "java", state: "ok", title: "Java settings", detail: `${instance.ram} GB of memory with smooth garbage collection.` }
    );

    // Graphics settings.
    const options = readOptions(folder);
    const graphics = options ? graphicsChanges(options.values, hw) : [];
    items.push(
        !options
            ? { id: "graphics", state: "tip", title: "Graphics settings", detail: "Play once, and the game's settings can be checked." }
            : graphics.length
            ? {
                  id: "graphics",
                  state: "fix",
                  title: "Graphics settings",
                  detail: hw.weak ? "Turned down for built-in graphics." : "The settings that cost the most for the least difference.",
                  list: graphics.map((change) => ({ label: change.label, text: `${change.from} → ${change.to}` })),
                  action: "Change these",
              }
            : { id: "graphics", state: "ok", title: "Graphics settings", detail: "Already set for speed." }
    );

    // Heavy mods: advice only, as they're there because someone wanted them.
    const heavy = heavyMods(enabledMods);
    items.push(
        heavy.length
            ? {
                  id: "heavy",
                  state: "tip",
                  title: "Heavy mods",
                  detail: "These cost the most speed. Turn off any you're not using in the Content tab: a mod that's off keeps its settings for when you turn it back on.",
                  list: heavy.map((mod) => ({ label: mod.name, text: mod.why })),
              }
            : { id: "heavy", state: "ok", title: "Heavy mods", detail: "None of the known heavy mods are on." }
    );

    // Resource packs: advice only, as they're what the game looks like.
    const packs = options ? activePacks(folder, options.values) : [];
    const large = packs.filter((pack) => pack.size >= 10 * 1024 * 1024);
    items.push(
        large.length
            ? {
                  id: "packs",
                  state: "tip",
                  title: "Resource packs",
                  detail: `${packs.length} packs are on. Large ones take memory and can cause stutters; turn off any you don't need in Options → Resource Packs.`,
                  list: large.map((pack) => ({ label: pack.name, text: megabytes(pack.size) })),
              }
            : { id: "packs", state: "ok", title: "Resource packs", detail: packs.length ? `${packs.length} small pack${packs.length === 1 ? "" : "s"} on.` : "None on." }
    );

    return { hardware: hw, running, items, undo: lastOptimise(folder) };
}

/* ---------------- the fixes ---------------- */

function readBackup(folder) {
    try {
        return JSON.parse(fs.readFileSync(path.join(folder, BACKUP), "utf8"));
    } catch {
        return null;
    }
}

function lastOptimise(folder) {
    const backup = readBackup(folder);
    return backup ? { time: backup.time } : null;
}

/*
 * Applies the chosen fixes ("mods", "shaders", "java", "graphics"), working each out
 * afresh rather than trusting what the page was shown. What each changes is added to
 * the backup, first value kept, so Undo puts back how things were before any of them.
 * -> { done: [text], skipped: [{ name, reason }] }
 */
async function apply(instance, folder, ids, { globalJvmArgs = "", updateInstance, onProgress } = {}) {
    const hw = await hardware();
    const backup = readBackup(folder) ?? { time: null, options: {}, iris: null, java: {}, modsAdded: [] };
    const done = [];
    const skipped = [];
    const save = () => {
        backup.time = new Date().toISOString();
        fs.writeFileSync(path.join(folder, BACKUP), JSON.stringify(backup, null, 2));
    };

    if (ids.includes("graphics")) {
        const options = readOptions(folder);
        const changes = options ? graphicsChanges(options.values, hw) : [];
        if (changes.length) {
            for (const change of changes) if (!(change.key in backup.options)) backup.options[change.key] = options.values[change.key];
            writeOptions(options, Object.fromEntries(changes.map((change) => [change.key, change.value])));
            save();
            done.push(`Changed ${changes.length} graphics setting${changes.length === 1 ? "" : "s"}.`);
        }
    }

    if (ids.includes("shaders")) {
        const mods = await modsIn(instanceMods.modsDir(folder));
        const shaders = shadersOn(folder, mods.filter((mod) => mod.enabled));
        if (shaders) {
            const text = fs.readFileSync(shaders.file, "utf8");
            backup.iris ??= { file: path.basename(shaders.file), enableShaders: "true" };
            fs.writeFileSync(shaders.file, text.replace(/^enableShaders\s*=\s*true\s*$/m, "enableShaders=false"));
            save();
            done.push(`Turned off ${shaders.pack}. Turn it back on in Options → Video Settings → Shader Packs.`);
        }
    }

    if (ids.includes("java")) {
        const mods = await modsIn(instanceMods.modsDir(folder));
        const changes = javaChanges(instance, globalJvmArgs, mods.filter((mod) => mod.enabled).length, hw);
        if (changes.length) {
            const patch = Object.fromEntries(changes.map((change) => [change.key, change.value]));
            for (const key of Object.keys(patch)) if (!(key in backup.java)) backup.java[key] = instance[key] ?? null;
            updateInstance(patch);
            save();
            done.push(changes.map((change) => `${change.label}: ${change.to}`).join("; ") + ".");
        }
    }

    if (ids.includes("mods")) {
        const result = await addSpeedMods(instance, folder, hw, onProgress);
        if (result.added.length) {
            backup.modsAdded.push(...result.added);
            save();
            done.push(`Added ${result.names.join(", ")}${result.dependencies.length ? `, and ${result.dependencies.join(", ")} that ${result.dependencies.length === 1 ? "it needs" : "they need"}` : ""}.`);
        }
        skipped.push(...result.skipped);
    }

    return { done, skipped };
}

/*
 * Downloads the missing speed mods aside, checks them against the instance as updates
 * are checked, and puts in the ones that fit, then anything they need.
 */
async function addSpeedMods(instance, folder, hw, onProgress) {
    const loader = String(instance.loader || "vanilla").toLowerCase();
    const dir = instanceMods.modsDir(folder);
    const current = await modsIn(dir);
    const missing = await missingSpeedMods(instance, current, hw);
    const staging = path.join(folder, "optimise-staging", String(Date.now()));
    const skipped = [];
    fs.mkdirSync(staging, { recursive: true });

    try {
        let candidates = [];
        for (const [index, mod] of missing.entries()) {
            onProgress?.({ stage: "optimise", percent: Math.round((index / Math.max(missing.length, 1)) * 60), detail: `Downloading ${mod.name}` });
            const file = path.join(staging, path.basename(mod.file.fileName));
            try {
                await downloadFile(mod.file.url, file, { sha1: mod.file.sha1 });
                const info = await modInfo(file);
                candidates.push({ mod, file, info: { ...(info ?? {}), ids: info?.ids ?? [], fileName: path.basename(file), name: mod.name, enabled: true } });
            } catch (err) {
                skipped.push({ name: mod.name, reason: `couldn't be downloaded (${err.message})` });
            }
        }

        // Left out if they wouldn't work with what's there, as an update would be.
        onProgress?.({ stage: "optimise", percent: 65, detail: "Checking they work with your mods" });
        const javaMajor = requiredJava(folder, instance).majorVersion;
        for (let round = 0; round < 4 && candidates.length; round++) {
            const mods = [...current, ...candidates.map((c) => c.info)];
            const problems = [
                ...problemsWith({ mods, changed: new Set(candidates.map((c) => c.info.fileName)), mcVersion: instance.version, loader, loaderVersion: instance.loaderVersion, javaMajor }),
                ...(await missingDependencies(candidates.map((c) => c.info), mods, instance)),
                ...(await addonCheck(folder, current, candidates.map((c) => ({ fileName: c.info.fileName, file: c.file, name: c.mod.name, version: c.info.version, enabled: true })))),
            ];
            const bad = new Set(problems.map((problem) => problem.fileName));
            if (!candidates.some((c) => bad.has(c.info.fileName))) break;
            for (const c of candidates.filter((c) => bad.has(c.info.fileName))) {
                skipped.push({ name: c.mod.name, reason: problems.filter((p) => p.fileName === c.info.fileName).map((p) => p.text).join("; ") });
            }
            candidates = candidates.filter((c) => !bad.has(c.info.fileName));
        }

        const before = new Set(fs.readdirSync(dir));
        const names = [];
        for (const c of candidates) {
            onProgress?.({ stage: "optimise", percent: 75, detail: `Adding ${c.mod.name}` });
            await instanceMods.installContent(folder, {
                type: "mod",
                localFile: c.file,
                fileName: c.info.fileName,
                name: c.mod.name,
                source: "modrinth",
                projectId: c.mod.project,
                versionNumber: c.mod.file.versionNumber,
            });
            names.push(c.mod.name);
        }

        let dependencies = [];
        if (names.length) {
            onProgress?.({ stage: "optimise", percent: 90, detail: "Adding what they need" });
            const added = new Set(fs.readdirSync(dir).filter((name) => !before.has(name)));
            const deps = await ensureDependencies(instance, folder, { only: [...added] });
            dependencies = deps.added;
        }
        onProgress?.({ stage: "done", percent: 100, detail: "Done" });
        return { added: fs.readdirSync(dir).filter((name) => !before.has(name)), names, dependencies, skipped };
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
        try {
            fs.rmdirSync(path.dirname(staging));
        } catch {
            // Something else is still there.
        }
    }
}

/* Puts back every setting Optimise changed and removes the mods it added. -> { restored: [text] } */
function undo(folder, { updateInstance }) {
    const backup = readBackup(folder);
    if (!backup) throw new Error("There's nothing to undo.");
    const restored = [];

    const keys = Object.keys(backup.options ?? {});
    if (keys.length) {
        const options = readOptions(folder);
        if (options) {
            writeOptions(options, backup.options);
            restored.push(`${keys.length} graphics setting${keys.length === 1 ? "" : "s"}`);
        }
    }

    if (backup.iris) {
        const file = path.join(gameDir(folder), "config", backup.iris.file);
        try {
            const text = fs.readFileSync(file, "utf8");
            fs.writeFileSync(file, text.replace(/^enableShaders\s*=\s*false\s*$/m, "enableShaders=true"));
            restored.push("shaders");
        } catch {
            // The shader settings have gone.
        }
    }

    if (Object.keys(backup.java ?? {}).length) {
        updateInstance(Object.fromEntries(Object.entries(backup.java).map(([key, value]) => [key, key === "jvmArgs" ? value ?? "" : value])));
        restored.push("Java settings");
    }

    const removed = [];
    for (const fileName of backup.modsAdded ?? []) {
        for (const candidate of [fileName, `${fileName}.disabled`]) {
            const file = path.join(instanceMods.modsDir(folder), candidate);
            if (fs.existsSync(file)) {
                instanceMods.deleteItem(folder, { type: "mod", fileName: fileName.replace(/\.disabled$/, "") });
                removed.push(fileName);
                break;
            }
        }
    }
    if (removed.length) restored.push(`removed ${removed.length} mod${removed.length === 1 ? "" : "s"}`);

    fs.rmSync(path.join(folder, BACKUP), { force: true });
    return { restored };
}

module.exports = { check, apply, undo, hardware, graphicsChanges, memoryFor, SMOOTH_GC };
