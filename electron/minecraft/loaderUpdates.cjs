const fs = require("fs");
const path = require("path");
const instanceMods = require("./instanceMods.cjs");
const modUpdates = require("./modUpdates.cjs");
const { mixinFormatProblems } = require("./mixinFormat.cjs");
const { modInfo, modsIn } = require("./modInfo.cjs");
const { problemsWith, parseVersion, compare, LOADER_IDS } = require("./compat.cjs");
const { listLoaderVersions } = require("./loaders.cjs");
const { requiredJava } = require("./javaRuntime.cjs");
const { downloadFile } = require("./net.cjs");

/*
 * Changing an instance's mod loader to another build, as safely as a mod update: every mod
 * is checked against the new loader first. A mod that wouldn't accept it is updated with
 * it when a newer version of the mod would; if none would, the change waits and says why.
 * The loader and the mods it brought along go into one batch, which Undo puts back.
 */

const LOADER_NAMES = { fabric: "Fabric Loader", quilt: "Quilt Loader", forge: "Forge", neoforge: "NeoForge" };
// How many of the newest builds the list shows (Fabric has hundreds).
const SHOWN = 40;
// Newer versions of a mod tried, per mod, when looking for one that accepts the loader.
const TRIES = 3;

// Forge's builds are recorded as "1.20.1-47.4.10"; mods ask for "47.4.10".
const plainVersion = (version) => String(version ?? "").replace(/^\d+(\.\d+)*-(?=\d)/, "");
const isUnstable = (version) => /alpha|beta|pre|rc/i.test(version);
const sameVersion = (a, b) => plainVersion(a) === plainVersion(b);

function isNewer(a, b) {
    const pa = parseVersion(plainVersion(a));
    const pb = parseVersion(plainVersion(b));
    return Boolean(pa && pb && compare(pa, pb) > 0);
}

function loaderOf(instance) {
    const loader = String(instance.loader || "vanilla").toLowerCase();
    if (!LOADER_NAMES[loader]) throw new Error("This instance has no mod loader.");
    return { loader, loaderName: LOADER_NAMES[loader], loaderIds: new Set(LOADER_IDS[loader]) };
}

/* What the mods would make of the loader at `target`, with `changed` files new. */
function problemsAt(instance, folder, mods, target, changed = new Set()) {
    const { loader, loaderIds } = loaderOf(instance);
    return problemsWith({
        mods,
        changed,
        changedIds: loaderIds,
        mcVersion: instance.version,
        loader,
        loaderVersion: target,
        javaMajor: requiredJava(folder, instance).majorVersion,
    });
}

const withoutDisabled = (fileName) => fileName.replace(/\.disabled$/, "");

/*
 * The builds of the instance's loader to choose from, newest first, each with how many
 * enabled mods wouldn't accept it as they are.
 * -> { loaderName, current, newest, versions: [{ version, stable, installed, problems }] }
 */
async function loaderVersions(name, instance, folder) {
    const { loader, loaderName } = loaderOf(instance);
    const current = instance.loaderVersion;
    const all = await listLoaderVersions(loader, instance.version);

    // Betas are only offered to an instance already on one.
    const newest = all.find((v) => (v.stable || isUnstable(current)) && isNewer(v.version, current))?.version ?? null;

    const shown = all.slice(0, SHOWN);
    const mine = all.find((v) => sameVersion(v.version, current));
    if (mine && !shown.includes(mine)) shown.push(mine);

    const mods = await modsIn(instanceMods.modsDir(folder));
    return {
        loaderName,
        current,
        newest,
        versions: shown.map((v) => {
            const installed = sameVersion(v.version, current);
            const problems = installed ? [] : problemsAt(instance, folder, mods, v.version);
            return { version: v.version, stable: v.stable, installed, problems: new Set(problems.map((p) => p.fileName)).size };
        }),
    };
}

/*
 * A newer version of one mod that accepts the loader at `target` and fits with the rest,
 * found by downloading the newest few into `staging` and reading them. -> { update, mod } or null
 */
async function findFix(name, instance, folder, item, mods, target, staging) {
    let listed;
    try {
        listed = await modUpdates.listVersions(name, instance, `mod/${item.fileName}`);
    } catch {
        return null;
    }
    const installed = listed.versions.find((v) => v.installed);
    const since = Date.parse(installed?.published ?? item.modrinthVersion?.published ?? 0) || 0;
    let newer = listed.versions.filter((v) => !v.installed && Date.parse(v.published) > since);
    // A stable release tries stable releases first.
    if ((installed?.channel ?? item.modrinthVersion?.type ?? "release") === "release") {
        newer = [...newer.filter((v) => v.channel === "release"), ...newer.filter((v) => v.channel !== "release")];
    }

    for (const version of newer.slice(0, TRIES)) {
        try {
            const update = await modUpdates.updateTo(item, version.id);
            const dir = path.join(staging, version.id);
            const file = path.join(dir, path.basename(update.file.fileName));
            await downloadFile(update.file.url, file, { sha1: update.file.sha1 });
            const info = await modInfo(file);
            if (!info) continue;

            const mod = { ...info, fileName: path.basename(file), name: item.displayName, enabled: item.enabled };
            const after = [...mods.filter((m) => withoutDisabled(m.fileName) !== item.fileName), mod];
            const problems = problemsAt(instance, folder, after, target, new Set([mod.fileName])).filter((p) => p.fileName === mod.fileName);
            problems.push(...(await modUpdates.missingDependencies([mod], after, instance)));
            problems.push(...(await modUpdates.addonCheck(folder, mods, [{ fileName: mod.fileName, file, name: mod.name, version: update.latest, enabled: mod.enabled, replacesFileName: item.fileName }])));
            if (!problems.length) return { update, mod };
        } catch {
            // This one couldn't be read or downloaded; try the next.
        }
    }
    return null;
}

// The latest plan for each instance, which applyLoaderChange carries out.
const plans = new Map();

/*
 * What changing to `target` would take: the mods to update with it, and the reasons any
 * mod still wouldn't work. Mods are only looked for when updating; going back to an older
 * loader just says which mods need a newer one.
 * -> { loaderName, current, target, upgrade, fixes: [{ name, from, to }], blocking: [text], otherUpdates }
 */
async function planLoaderChange(name, instance, folder, target, { onProgress } = {}) {
    const { loader, loaderName } = loaderOf(instance);
    const current = instance.loaderVersion;
    if (sameVersion(target, current)) throw new Error(`This instance already has ${loaderName} ${current}.`);
    const available = await listLoaderVersions(loader, instance.version);
    if (!available.some((v) => v.version === target)) throw new Error(`${loaderName} ${target} isn't available for Minecraft ${instance.version}.`);

    const upgrade = isNewer(target, current);
    const mods = await modsIn(instanceMods.modsDir(folder));
    const affected = [...new Set(problemsAt(instance, folder, mods, target).map((p) => p.fileName))];

    const fixes = [];
    const searched = new Set();
    const staging = path.join(folder, "update-staging", `loader-${Date.now()}`);
    try {
        if (upgrade && affected.length) {
            if (!modUpdates.checkedItems(name)) {
                onProgress?.({ stage: "updates", percent: 5, detail: "Checking your mods" });
                await modUpdates.checkUpdates(name, instance, folder);
            }
            const items = modUpdates.checkedItems(name);
            for (const [index, fileName] of affected.entries()) {
                const item = items?.get(`mod/${withoutDisabled(fileName)}`);
                if (!item?.projectId) continue;
                onProgress?.({
                    stage: "updates",
                    percent: 10 + Math.round((index / affected.length) * 80),
                    detail: `Looking for a version of ${item.displayName} that works with ${loaderName} ${target}`,
                });
                searched.add(fileName);
                const fix = await findFix(name, instance, folder, item, mods, target, staging);
                if (fix) fixes.push(fix);
            }
        }
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
        try {
            fs.rmdirSync(path.dirname(staging)); // Only goes if nothing else is downloading.
        } catch {
            // Not empty.
        }
    }

    // Everything together, with the fixes in: anything left stops the change.
    const replaced = new Set(fixes.map((f) => f.update.fileName));
    const after = [...mods.filter((m) => !replaced.has(withoutDisabled(m.fileName))), ...fixes.map((f) => f.mod)];
    const remaining = problemsAt(instance, folder, after, target, new Set(fixes.map((f) => f.mod.fileName)));
    remaining.push(...(await modUpdates.missingDependencies(fixes.map((f) => f.mod), after, instance)));
    // Mods that patch the game in a way the target loader can't read (going back to an older one).
    onProgress?.({ stage: "updates", percent: 95, detail: "Checking how your mods patch the game" });
    const modsDir = instanceMods.modsDir(folder);
    const staying = after.filter((m) => m.enabled && !fixes.some((f) => f.mod === m)).map((m) => ({ fileName: m.fileName, file: path.join(modsDir, m.fileName), name: m.name, enabled: true }));
    remaining.push(...(await mixinFormatProblems({ folder, instance, loaderVersion: target, mods: staying, incoming: staying })));

    const blocking = [];
    for (const fileName of new Set(remaining.map((p) => p.fileName))) {
        const found = remaining.filter((p) => p.fileName === fileName);
        let text = `${found[0].name} ${found.map((p) => p.text).join("; ")}.`;
        if (upgrade && searched.has(fileName) && !replaced.has(withoutDisabled(fileName))) text += ` None of its newer versions work with ${loaderName} ${target} either.`;
        else if (upgrade && affected.includes(fileName) && !searched.has(fileName)) text += " It isn't from Modrinth or CurseForge, so there's no newer version to try.";
        blocking.push(text);
    }

    const fixKeys = new Set(fixes.map((f) => f.update.key));
    const pending = modUpdates.pendingUpdates(name);
    const otherUpdates = pending ? [...pending.values()].filter((u) => !fixKeys.has(u.key)).length : 0;

    plans.set(name, { target, current, fixes: fixes.map((f) => f.update), blocking });
    onProgress?.({ stage: "updates", percent: 100, detail: "Checked" });
    return {
        loaderName,
        current,
        target,
        upgrade,
        fixes: fixes.map((f) => ({ name: f.update.name, from: f.update.current, to: f.update.latest })),
        blocking,
        otherUpdates,
    };
}

/*
 * Changes the loader to `target` with the mods its plan updates, all or nothing: the mods
 * are downloaded and checked first, then the loader is installed, then the files are
 * swapped. alsoUpdate then installs the instance's other updates that fit, into the same
 * batch. changeLoader(target, onProgress) installs the loader and returns { from, to }.
 * -> { loader: { name, from, to }, updated, skipped, failed, batch }, or
 *    { needsConfirm, problems } when mods wouldn't work and force isn't set.
 */
async function applyLoaderChange(name, instance, folder, target, { force = false, alsoUpdate = false, onProgress, changeLoader }) {
    const { loaderName } = loaderOf(instance);
    let plan = plans.get(name);
    if (!plan || plan.target !== target || plan.current !== instance.loaderVersion) {
        await planLoaderChange(name, instance, folder, target, { onProgress });
        plan = plans.get(name);
    }
    if (plan.blocking.length && !force) return { needsConfirm: true, problems: plan.blocking };

    const moved = { ...instance, loaderVersion: target };
    let switched = null;
    const first = await modUpdates.runUpdates(moved, folder, plan.fixes, {
        mode: force ? "force" : "ask",
        requireAll: true,
        onProgress,
        beforeSwap: async () => {
            onProgress?.({ stage: "updates", percent: 68, detail: `Installing ${loaderName} ${target}` });
            switched = await changeLoader(target, (p) => onProgress?.({ stage: "updates", percent: 68, detail: p.detail ?? `Installing ${loaderName} ${target}` }));
            return { type: "loader", name: loaderName, from: switched.from.loaderVersion, to: switched.to.loaderVersion, oldVersionId: switched.from.versionId, newVersionId: switched.to.versionId };
        },
    });
    if (first.needsConfirm) return first;
    plans.delete(name);

    const result = { loader: { name: loaderName, from: switched.from.loaderVersion, to: switched.to.loaderVersion }, ...first };
    const pending = modUpdates.pendingUpdates(name);
    for (const update of plan.fixes) pending?.delete(update.key);

    if (alsoUpdate && pending?.size) {
        const others = [...pending.values()];
        const more = await modUpdates.runUpdates(moved, folder, others, { mode: "skip", onProgress, batchId: first.batch?.id });
        for (const update of others) pending.delete(update.key);
        result.updated = [...result.updated, ...more.updated];
        result.skipped = [...result.skipped, ...more.skipped];
        result.failed = [...result.failed, ...more.failed];
        result.batch = more.batch ?? result.batch;
    }
    return result;
}

module.exports = { loaderVersions, planLoaderChange, applyLoaderChange, LOADER_NAMES };
