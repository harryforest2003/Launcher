const fs = require("fs");
const path = require("path");
const { modsIn, modInfo } = require("./modInfo.cjs");
const modSearch = require("./modSearch.cjs");
const instanceMods = require("./instanceMods.cjs");

/*
 * Makes sure mods have the mods they need. Each jar says what it requires
 * (fabric.mod.json, quilt.mod.json or mods.toml), which catches what a site's page
 * leaves out and mods added from GitHub, where there's no page at all. Anything missing
 * is looked up on Modrinth by its mod ID, installed for the instance's version and
 * loader, and then checked the same way, since a dependency can need more.
 *
 * A download is only kept if the jar really is the mod that was needed, so a Modrinth
 * project that merely shares the name can't slip in.
 */

// Provided by the game, Java or the loader itself.
const BUILT_IN = new Set(["minecraft", "java", "fabricloader", "fabric-loader", "quilt_loader", "forge", "neoforge", "fml", "javafml", "lowcodefml", "mixinextras_neoforge"]);

// Mod IDs whose Modrinth project is named differently.
const PROJECT_FOR_ID = {
    fabric: "fabric-api",
    architectury: "architectury-api",
    owo: "owo-lib",
    yet_another_config_lib_v3: "yacl",
    yet_another_config_lib: "yacl",
    forgeconfigapiport: "forge-config-api-port",
    puzzleslib: "puzzles-lib",
    cloth_config: "cloth-config",
    "cloth-config2": "cloth-config",
    kotlinforforge: "kotlin-for-forge",
    resourcefullib: "resourceful-lib",
    bookshelf: "bookshelf-lib",
    yungsapi: "yungs-api",
    fzzy_config: "fzzy-config",
    supermartijn642corelib: "supermartijn642s-core-lib",
    supermartijn642configlib: "supermartijn642s-config-lib",
};

// Mod IDs that are modules of one bigger mod: the pattern, its project, and its own ID.
const FAMILIES = [
    [/^fabric-(.+-v\d+|api-base)$/, "fabric-api", "fabric-api"],
    [/^cardinal-components/, "cardinal-components-api", "cardinal-components"],
];

/* The Modrinth projects to try for a mod ID, most likely first. */
function projectsFor(id) {
    const family = FAMILIES.find(([pattern]) => pattern.test(id));
    if (family) return [family[1]];
    return [...new Set([PROJECT_FOR_ID[id], id, id.replace(/_/g, "-")].filter(Boolean))];
}

/* Whether a jar with these IDs is the mod needed for this ID. */
function satisfies(ids, id) {
    if (ids.includes(id)) return true;
    // A module that's gone from this version of the bigger mod: still the right mod.
    const family = FAMILIES.find(([pattern]) => pattern.test(id));
    return Boolean(family && ids.includes(family[2]));
}

/*
 * Installs what the instance's mods need and don't have. `only` limits the check to
 * those files (the mods just added) and whatever gets added for them; without it every
 * enabled mod is checked. Returns { added: [names], disabled: [{ name, neededBy }],
 * notFound: [{ id, neededBy: [names] }] }. Never throws.
 */
async function ensureDependencies(instance, folder, { only = null, onProgress } = {}) {
    const result = { added: [], disabled: [], notFound: [] };
    const loader = String(instance.loader || "vanilla").toLowerCase();
    if (loader === "vanilla") return result;

    const dir = instanceMods.modsDir(folder);
    const tried = new Set();
    let check = only ? new Set(only) : null;

    try {
        for (let round = 0; round < 5; round++) {
            const mods = await modsIn(dir);
            const enabled = mods.filter((mod) => mod.enabled);
            const providers = new Map();
            for (const mod of enabled) {
                for (const id of [...mod.ids, ...mod.provides]) {
                    const key = id.toLowerCase();
                    providers.set(key, [...(providers.get(key) ?? []), mod]);
                }
            }
            const disabledById = new Map();
            for (const mod of mods.filter((mod) => !mod.enabled)) for (const id of mod.ids) disabledById.set(id.toLowerCase(), mod);

            // What each missing mod ID is needed by.
            const needed = new Map();
            for (const mod of enabled) {
                if (check && !check.has(mod.fileName)) continue;
                // Another mod provides everything this one is (ViaFabricPlus carries
                // ViaVersion, say), so the loader uses that one and ignores this jar.
                if (mod.ids.length && mod.ids.every((id) => (providers.get(id.toLowerCase()) ?? []).some((other) => other !== mod))) continue;

                for (const id of mod.depends) {
                    const key = id.toLowerCase();
                    if (BUILT_IN.has(key) || providers.has(key)) continue;
                    const off = disabledById.get(key);
                    if (off) {
                        if (!result.disabled.some((entry) => entry.name === off.name)) result.disabled.push({ name: off.name, neededBy: mod.name });
                        continue;
                    }
                    if (tried.has(key)) continue;
                    needed.set(key, [...(needed.get(key) ?? []), mod.name]);
                }
            }
            if (!needed.size) break;

            // Several IDs can be one project (Fabric API's modules): fetch each once.
            const added = [];
            const fetched = new Map();
            let done = 0;
            for (const [id, neededBy] of needed) {
                tried.add(id);
                onProgress?.({ stage: "dependencies", percent: Math.round((done++ / needed.size) * 100), detail: `Adding what ${neededBy[0]} needs` });

                const key = projectsFor(id).join("|");
                if (!fetched.has(key)) fetched.set(key, installById(id, instance, folder, loader, dir));
                const installed = await fetched.get(key);

                if (installed?.fresh) {
                    installed.fresh = false;
                    result.added.push(installed.name);
                    added.push(installed.fileName);
                } else if (!installed) {
                    result.notFound.push({ id, neededBy });
                }
            }
            if (!added.length) break;
            check = new Set(added);
        }
    } catch (err) {
        console.warn("Checking mod dependencies failed:", err.message);
    }

    result.added.sort((a, b) => a.localeCompare(b));
    return result;
}

/* Finds the mod with this ID on Modrinth and installs it, or null. */
async function installById(id, instance, folder, loader, dir) {
    for (const slug of projectsFor(id)) {
        let project;
        let file;
        try {
            project = await modSearch.getModrinthProject(slug);
            if (project.type !== "mod") continue;
            file = await modSearch.resolveModFile("modrinth", project.id, instance.version, loader, "mod");
        } catch {
            continue;
        }

        // Never overwrite a jar that's already there.
        if (fs.existsSync(path.join(dir, file.fileName)) || fs.existsSync(path.join(dir, `${file.fileName}.disabled`))) continue;

        let installed;
        try {
            installed = await instanceMods.installContent(folder, {
                ...file,
                type: file.targetType,
                name: project.name,
                source: "modrinth",
                projectId: project.id,
                iconUrl: project.icon,
            });
        } catch {
            continue;
        }

        const info = await modInfo(path.join(dir, installed.fileName));
        const ids = [...(info?.ids ?? []), ...(info?.provides ?? [])].map((other) => other.toLowerCase());
        if (satisfies(ids, id)) return { name: project.name, fileName: installed.fileName, fresh: true };

        // Not the mod that was needed after all.
        try {
            instanceMods.deleteItem(folder, { type: "mod", fileName: installed.fileName });
        } catch {
            // Already gone.
        }
    }
    return null;
}

module.exports = { ensureDependencies, projectsFor };
