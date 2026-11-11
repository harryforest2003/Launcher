const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const modSearch = require("./modSearch.cjs");
const instanceMods = require("./instanceMods.cjs");
const { ensureDependencies } = require("./modDependencies.cjs");
const { pool } = require("./net.cjs");

/*
 * Starter mods: performance and quality-of-life projects added to every new instance,
 * each in the build for that instance's Minecraft version and loader, with whatever it
 * needs. One without a build for that version is skipped and named. The list is kept in
 * the profile and changed in Settings; this is what it starts as.
 */

const mod = (projectId, name) => ({ source: "modrinth", projectId, name, type: "mod", enabled: true });

const DEFAULT_STARTER_MODS = [
    mod("zV5r3pPn", "3D Skin Layers"),
    mod("N6n5dqoA", "Axiom"),
    mod("g96Z4WVZ", "BadOptimizations"),
    mod("ONZm0H7Y", "Better Block Entities"),
    mod("n6PXGAoM", "Better Statistics Screen"),
    mod("8shC1gFX", "BetterF3"),
    mod("Wnxd13zP", "Clumps"),
    mod("VSNURh3q", "Concurrent Chunk Management Engine"),
    mod("ETlrkaYF", "Cubes Without Borders"),
    mod("LQ3K71Q1", "Dynamic FPS"),
    mod("dWMHBEAQ", "Elytra Contrails"),
    mod("8H6RXl2q", "EnhancedTooltips"),
    mod("NNAgCjsB", "Entity Culling"),
    mod("k2ZPuTBm", "Essential Mod"),
    mod("5ZwdcRci", "ImmediatelyFast"),
    mod("Boon8xwi", "Inventory Essentials"),
    mod("fQEb0iXm", "Krypton"),
    mod("bEpr0Arc", "Litematica"),
    mod("uXn3roAp", "Litematica Inventory Highlight"),
    mod("LBqlnT0v", "Litematica Quick-Share Addon"),
    mod("OWsxlyPe", "Litematica RawMaterials"),
    mod("T3G2Q24n", "LitematicDownloader"),
    mod("gvQqBUqZ", "Lithium"),
    mod("mOgUt4GM", "Mod Menu"),
    mod("TjSm1wrD", "ModernFix-mVUS"),
    mod("8qkXwOnk", "More Chat History"),
    mod("51shyZVL", "More Culling"),
    mod("aC3cM3Vq", "Mouse Tweaks"),
    mod("R2gvNqxX", "Not Enough FPS"),
    mod("RSeLon5O", "Particle Core"),
    mod("8aoMKplv", "Punchy!"),
    mod("nfn13YXA", "Roughly Enough Items (REI)"),
    mod("V8XJ8f5f", "Roughly Enough Professions (REP)"),
    mod("Ps1zyz6x", "ScalableLux"),
    mod("2M01OLQq", "Shulker Box Tooltip"),
    mod("9eGKb6K1", "Simple Voice Chat"),
    mod("AANobbMI", "Sodium"),
    mod("PtjYWJkn", "Sodium Extra"),
    mod("NKvLVQMc", "Symbol Chat"),
    { ...mod("ANp3uBXk", "Trimmable Minimal Armor (Mod Support)"), type: "resourcepack" },
    mod("1u6JkXh5", "WorldEdit"),
    mod("1bokaNcj", "Xaero's Minimap"),
    mod("NcUtCpym", "Xaero's World Map"),
];

const TYPES = new Set(["mod", "resourcepack", "shader", "datapack"]);

function listPath() {
    return path.join(app.getPath("userData"), "starter-mods.json");
}

function readList() {
    try {
        const stored = JSON.parse(fs.readFileSync(listPath(), "utf8"));
        if (Array.isArray(stored)) return stored;
    } catch {
        // None saved yet.
    }
    return DEFAULT_STARTER_MODS.map((entry) => ({ ...entry }));
}

function writeList(list) {
    const clean = list
        .filter((entry) => entry && typeof entry.projectId === "string" && TYPES.has(entry.type))
        .map((entry) => ({
            source: entry.source === "curseforge" ? "curseforge" : "modrinth",
            projectId: entry.projectId,
            name: String(entry.name || entry.projectId).slice(0, 100),
            type: entry.type,
            enabled: entry.enabled !== false,
        }));

    fs.mkdirSync(path.dirname(listPath()), { recursive: true });
    fs.writeFileSync(listPath(), JSON.stringify(clean, null, 2));
    return clean;
}

function resetList() {
    try {
        fs.rmSync(listPath(), { force: true });
    } catch {
        // Already gone.
    }
    return readList();
}

/* Adds a project found by searching the launcher's catalog, as the page describes it. */
function addToList(project) {
    const source = project?.source === "curseforge" ? "curseforge" : project?.source === "modrinth" ? "modrinth" : null;
    const projectId = String(project?.projectId ?? "");
    const name = String(project?.name ?? "").trim();

    if (!source || !projectId || !name) throw new Error("That project couldn't be added.");
    if (!TYPES.has(project.type)) throw new Error(`${name} isn't a mod or pack, so it can't be a starter mod.`);

    const list = readList();
    // A project listed on both sites counts once, whichever listing it was added from.
    if (list.some((entry) => (entry.source === source && entry.projectId === projectId) || entry.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`${name} is already a starter mod.`);
    }

    return writeList([...list, { source, projectId, name, type: project.type, enabled: true }]);
}

/*
 * Installs the turned-on starter mods into a new instance. Each project, starter or
 * dependency, is installed once, however many mods need it. Never throws: what couldn't
 * be added is reported instead.
 */
async function installStarterMods(instance, folder, { onProgress } = {}) {
    const loader = String(instance.loader || "vanilla").toLowerCase();
    const entries = readList().filter((entry) => entry.enabled && (entry.type !== "mod" || loader !== "vanilla"));

    const summary = { added: [], dependencies: [], unavailable: [], failed: [] };
    if (!entries.length) return summary;

    const starterKeys = new Set(entries.map((entry) => `${entry.source}:${entry.projectId}`));
    const installs = new Map();
    // Shared, so a library many mods need (Fabric API, say) is looked up once.
    const visited = new Set();

    const installOnce = (key, details) => {
        if (!installs.has(key)) installs.set(key, instanceMods.installContent(folder, details));
        return installs.get(key);
    };

    let finished = 0;

    await pool(
        entries,
        async (entry) => {
            const key = `${entry.source}:${entry.projectId}`;

            try {
                let file;
                try {
                    file = await modSearch.resolveModFile(entry.source, entry.projectId, instance.version, loader, entry.type);
                } catch (err) {
                    if (err.code === "NO_BUILD") summary.unavailable.push(entry.name);
                    else summary.failed.push({ name: entry.name, reason: err.message });
                    return;
                }

                await installOnce(key, {
                    ...file,
                    type: file.targetType,
                    name: entry.name,
                    source: entry.source,
                    projectId: entry.projectId,
                });
                summary.added.push(entry.name);

                const deps = await modSearch
                    .collectDependencies(entry.source, entry.projectId, instance.version, loader, entry.type, { visited })
                    .catch(() => []);

                for (const dep of deps) {
                    const depKey = `${dep.source}:${dep.projectId}`;
                    const fresh = !installs.has(depKey);

                    try {
                        await installOnce(depKey, {
                            ...dep.file,
                            type: dep.file.targetType,
                            name: dep.info.name,
                            source: dep.source,
                            projectId: dep.projectId,
                            iconUrl: dep.info.icon,
                        });
                        if (fresh && !starterKeys.has(depKey)) summary.dependencies.push(dep.info.name);
                    } catch (err) {
                        console.warn(`Could not add ${dep.info.name}, needed by ${entry.name}:`, err.message);
                    }
                }
            } catch (err) {
                summary.failed.push({ name: entry.name, reason: err.message });
            } finally {
                finished += 1;
                onProgress?.({
                    stage: "starter",
                    percent: Math.round((finished / entries.length) * 100),
                    detail: `Adding starter mods: ${finished} of ${entries.length}`,
                });
            }
        },
        { concurrency: 4 }
    );

    // Then what the jars themselves say they need, which a site's page can miss.
    const check = await ensureDependencies(instance, folder, { onProgress });
    for (const name of check.added) if (!summary.dependencies.includes(name)) summary.dependencies.push(name);

    for (const list of [summary.added, summary.dependencies, summary.unavailable]) {
        list.sort((a, b) => a.localeCompare(b));
    }

    return summary;
}

module.exports = {
    DEFAULT_STARTER_MODS,
    readList,
    writeList,
    resetList,
    addToList,
    installStarterMods,
};
