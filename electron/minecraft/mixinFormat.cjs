const fs = require("fs");
const os = require("os");
const path = require("path");
const { withZip } = require("./zipFile.cjs");
const { modInfo } = require("./modInfo.cjs");
const { parseClass } = require("./mixinCheck.cjs");
const { compare, parseVersion } = require("./compat.cjs");
const { downloadFile } = require("./net.cjs");

/*
 * Mods written with a newer way of patching the game than the instance's loader can read.
 * A mod says which Minecraft and loader versions it needs, but not this: it only shows in
 * its compiled patches (mixins). ViaFabricPlus 5.0.3 writes @Redirect with a list of @At;
 * MixinExtras before 0.5.5 (bundled in Fabric Loader before 0.19.5) reads that as a single
 * one, and the game crashes at startup with "ArrayList cannot be cast to AnnotationNode"
 * while patching the class (Player, for ViaFabricPlus).
 *
 * Each format below is what a mod's mixins use and the first MixinExtras (and Fabric
 * Loader) that reads it. Anything that can't be read counts as fine, as in compat.cjs.
 */

const REDIRECT = "Lorg/spongepowered/asm/mixin/injection/Redirect;";

const FORMATS = [
    {
        id: "redirect-at-list",
        needs: "0.5.5",
        fabricLoader: "0.19.5",
        matches: (annotation) => annotation.type === REDIRECT && Array.isArray(annotation.values?.at),
    },
];

const versionKey = (file) => {
    const { size, mtimeMs } = fs.statSync(file);
    return `${file}:${size}:${mtimeMs}`;
};

const cache = new Map();
function cached(key, make) {
    if (!cache.has(key)) cache.set(key, make().catch(() => null));
    return cache.get(key);
}

const list = (value) => (Array.isArray(value) ? value : []);

/* The newer formats a jar's own mixins use: [format id]. */
function formatsUsed(file) {
    return cached(`formats:${versionKey(file)}`, async () => {
        const info = await modInfo(file);
        if (!info?.mixinConfigs?.length) return [];
        return withZip(file, async (directory) => {
            const byPath = new Map(directory.files.map((entry) => [entry.path, entry]));
            const used = new Set();
            for (const config of info.mixinConfigs) {
                const entry = byPath.get(config.replace(/^\//, ""));
                if (!entry) continue;
                let json;
                try {
                    json = JSON.parse((await entry.buffer()).toString("utf8").replace(/^﻿/, ""));
                } catch {
                    continue;
                }
                const pkg = String(json.package ?? "").replace(/\./g, "/");
                for (const name of [...list(json.mixins), ...list(json.client), ...list(json.server)]) {
                    const classEntry = byPath.get(`${pkg ? `${pkg}/` : ""}${String(name).replace(/\./g, "/")}.class`);
                    if (!classEntry) continue;
                    const buffer = await classEntry.buffer();
                    // Only classes that could hold one are read in full.
                    if (!buffer.includes(REDIRECT)) continue;
                    const parsed = parseClass(buffer);
                    for (const method of parsed?.methods ?? []) {
                        for (const annotation of method.annotations ?? []) {
                            for (const format of FORMATS) if (format.matches(annotation)) used.add(format.id);
                        }
                    }
                }
            }
            return [...used];
        });
    }).then((used) => used ?? []);
}

/* The MixinExtras a jar carries inside it (META-INF/jars/mixinextras-fabric-0.5.5.jar): its version, or null. */
function bundledMixinExtras(file) {
    return cached(`bundled:${versionKey(file)}`, () =>
        withZip(file, (directory) => {
            const versions = directory.files
                .map((entry) => entry.path.match(/^META-INF\/jars\/mixinextras-[a-z]+-(\d+(?:\.\d+)+)\.jar$/)?.[1])
                .filter(Boolean);
            return highest(versions);
        })
    );
}

function highest(versions) {
    return versions.filter((v) => parseVersion(v)).sort((a, b) => compare(parseVersion(b), parseVersion(a)))[0] ?? null;
}

/*
 * The loader's own jar: from the instance's libraries, or for a Fabric Loader it doesn't
 * have yet (one it may update to), from Fabric's Maven, kept in a temporary folder.
 */
async function loaderJar(folder, loader, loaderVersion) {
    const local = {
        fabric: path.join(folder, "libraries", "net", "fabricmc", "fabric-loader", loaderVersion, `fabric-loader-${loaderVersion}.jar`),
        quilt: path.join(folder, "libraries", "org", "quiltmc", "quilt-loader", loaderVersion, `quilt-loader-${loaderVersion}.jar`),
    }[loader];
    if (local && fs.existsSync(local)) return local;
    if (loader !== "fabric") return null;
    const kept = path.join(os.tmpdir(), "unity-launcher-loaders", `fabric-loader-${loaderVersion}.jar`);
    if (!fs.existsSync(kept)) {
        fs.mkdirSync(path.dirname(kept), { recursive: true });
        await downloadFile(`https://maven.fabricmc.net/net/fabricmc/fabric-loader/${loaderVersion}/fabric-loader-${loaderVersion}.jar`, kept);
    }
    return kept;
}

/*
 * The MixinExtras the game would run with: the newest of the loader's and any a mod
 * carries (the newest one present is the one used). Null if it can't be told.
 */
async function mixinExtrasVersion(folder, loader, loaderVersion, files) {
    let fromLoader = null;
    try {
        const jar = await loaderJar(folder, loader, loaderVersion);
        if (jar) fromLoader = await bundledMixinExtras(jar);
    } catch {
        // Unknown.
    }
    if (!fromLoader) return null;
    const fromMods = await Promise.all(files.map((file) => bundledMixinExtras(file).catch(() => null)));
    return highest([fromLoader, ...fromMods.filter(Boolean)]);
}

/*
 * Problems the incoming mods' patches would cause: [{ fileName, name, text }], each on an
 * incoming file. `mods` is everything that would be installed, as { file, enabled }, so a
 * mod carrying a newer MixinExtras counts. Only Fabric and Quilt are checked.
 */
async function mixinFormatProblems({ folder, instance, loaderVersion = instance.loaderVersion, mods, incoming }) {
    const loader = String(instance.loader || "vanilla").toLowerCase();
    if (loader !== "fabric" && loader !== "quilt") return [];
    const used = await Promise.all(incoming.map(async (mod) => ({ mod, formats: await formatsUsed(mod.file).catch(() => []) })));
    const needing = used.filter((entry) => entry.formats.length);
    if (!needing.length) return [];

    const have = await mixinExtrasVersion(
        folder,
        loader,
        loaderVersion,
        mods.filter((mod) => mod.enabled !== false && mod.file && fs.existsSync(mod.file)).map((mod) => mod.file)
    );
    if (!have) return [];

    const problems = [];
    for (const { mod, formats } of needing) {
        for (const id of formats) {
            const format = FORMATS.find((f) => f.id === id);
            if (compare(parseVersion(have), parseVersion(format.needs)) >= 0) continue;
            const loaderName = loader === "quilt" ? "a newer Quilt Loader" : `Fabric Loader ${format.fabricLoader} or newer`;
            problems.push({
                fileName: mod.fileName,
                name: mod.name,
                text: `is written for ${loaderName} (it patches the game in a way this loader, ${loaderVersion}, can't read, and the game would crash at startup)`,
            });
        }
    }
    return problems;
}

module.exports = { mixinFormatProblems, formatsUsed, mixinExtrasVersion, FORMATS };
