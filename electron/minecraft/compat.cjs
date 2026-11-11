/*
 * Whether a set of mods can run together, from what each jar says: the versions of
 * Minecraft, the loader, Java and other mods it requires, and the mods it breaks with.
 * Used before an update goes in, so one that would stop the game starting is caught
 * first. Anything that can't be read with certainty counts as fine, so it never blocks
 * on a guess.
 */

const BUILT_IN_NAMES = {
    minecraft: "Minecraft",
    java: "Java",
    fabricloader: "Fabric Loader",
    "fabric-loader": "Fabric Loader",
    quilt_loader: "Quilt Loader",
    forge: "Forge",
    neoforge: "NeoForge",
};

/* "0.29.2-beta.1+mc26.2" -> { parts: [0, 29, 2], pre: "beta.1" }, or null. */
function parseVersion(text) {
    const clean = String(text ?? "").trim().replace(/^v/i, "").split("+")[0];
    const match = clean.match(/^(\d+(?:\.\d+)*)(?:-(.*))?$/);
    if (!match) return null;
    return { parts: match[1].split(".").map(Number), pre: match[2] ?? null };
}

/* -1, 0 or 1. A pre-release comes before its release; "1.2" equals "1.2.0". */
function compare(a, b) {
    const length = Math.max(a.parts.length, b.parts.length);
    for (let i = 0; i < length; i++) {
        const diff = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
        if (diff) return Math.sign(diff);
    }
    if (a.pre === b.pre) return 0;
    if (a.pre === null) return 1;
    if (b.pre === null) return -1;
    // "0.29.2-" (an empty pre-release) is the lowest of all.
    if (a.pre === "") return -1;
    if (b.pre === "") return 1;
    return a.pre < b.pre ? -1 : 1;
}

/* One Fabric/Quilt term: ">=1.2", "<2", "~1.2", "^1.2", "1.20.x", "=1.2", "1.2". */
function fabricTerm(version, term) {
    const match = term.match(/^(>=|<=|>|<|=|~|\^)?(.+)$/);
    if (!match) return true;
    const [, op = "=", text] = match;

    // Wildcards ("1.20.x", "1.20.*") match by prefix.
    if (/[x*]$/i.test(text) && op === "=") {
        const prefix = text.replace(/\.?[x*]$/i, "").split(".").map(Number);
        return prefix.every((n, i) => version.parts[i] === n);
    }

    const target = parseVersion(text);
    if (!target) return true;
    const c = compare(version, target);
    switch (op) {
        case ">=": return c >= 0;
        case "<=": return c <= 0;
        case ">": return c > 0;
        case "<": return c < 0;
        case "~": return c >= 0 && version.parts[0] === target.parts[0] && (version.parts[1] ?? 0) === (target.parts[1] ?? 0);
        case "^": return c >= 0 && version.parts[0] === target.parts[0];
        default: return c === 0;
    }
}

/* A Maven range, as Forge uses: "[1.0,2.0)", "[1.0,)", "(,2]", "1.0" (any), or several, comma-joined. */
function mavenRange(version, range) {
    const text = range.trim();
    if (!/^[[(]/.test(text)) return true; // A bare version is only a recommendation.
    const ranges = text.match(/[[(][^\])]*[\])]/g) ?? [];
    return ranges.some((part) => {
        const [low, high] = part.slice(1, -1).split(",").map((s) => s.trim());
        const single = !part.includes(",");
        if (single) {
            const exact = parseVersion(low);
            return !exact || compare(version, exact) === 0;
        }
        const lo = low ? parseVersion(low) : null;
        const hi = high ? parseVersion(high) : null;
        if ((low && !lo) || (high && !hi)) return true;
        if (lo && (part.startsWith("[") ? compare(version, lo) < 0 : compare(version, lo) <= 0)) return false;
        if (hi && (part.endsWith("]") ? compare(version, hi) > 0 : compare(version, hi) >= 0)) return false;
        return true;
    });
}

/* Whether a version meets any of the predicates (each predicate's space-separated terms all hold). */
function satisfies(versionText, predicates, flavour) {
    const version = parseVersion(versionText);
    if (!version) return true;
    return predicates.some((predicate) => {
        const text = String(predicate).trim();
        if (!text || text === "*") return true;
        if (flavour === "forge") return mavenRange(version, text);
        return text.split(/\s+/).every((term) => fabricTerm(version, term));
    });
}

/* "<0.30.0-" -> "older than 0.30.0", ">=0.17" -> "0.17 or newer", for messages. */
function describe(predicates) {
    return predicates
        .map((predicate) =>
            String(predicate)
                .trim()
                .split(/\s+/)
                .map((term) => {
                    const match = term.match(/^(>=|<=|>|<|=|~|\^)?(.+?)-?$/);
                    if (!match) return term;
                    const [, op, v] = match;
                    return op === ">=" ? `${v} or newer` : op === ">" ? `newer than ${v}` : op === "<=" ? `${v} or older` : op === "<" ? `older than ${v}` : op === "~" ? `${v}.x` : op === "^" ? `${v.split(".")[0]}.x` : v;
                })
                .join(" and ")
        )
        .join(", or ");
}

/*
 * Problems a set of mods would have. `mods` is what would be installed (modInfo of each,
 * with fileName, name, enabled); `changed` the file names that are new, and `changedIds`
 * anything else that would change (the loader, when it's updated). Only problems that
 * involve a change are returned: what the new files need, what other mods need from them,
 * and what every mod needs from a changed loader. Missing mods aren't problems here;
 * they're fetched separately.
 *
 * -> [{ fileName, name, text }]
 */
function problemsWith({ mods, changed, changedIds = new Set(), mcVersion, loader, loaderVersion, javaMajor }) {
    const enabled = mods.filter((mod) => mod.enabled);
    const versionOf = new Map();
    const nameOf = new Map(Object.entries(BUILT_IN_NAMES));
    const fileOf = new Map();
    for (const mod of enabled) {
        for (const id of mod.ids) {
            versionOf.set(id, mod.version);
            nameOf.set(id, mod.name);
            fileOf.set(id, mod.fileName);
        }
    }
    versionOf.set("minecraft", mcVersion);
    if (javaMajor) versionOf.set("java", String(javaMajor));
    const loaderPlain = String(loaderVersion ?? "").replace(/^\d+(\.\d+)*-/, ""); // Forge's "1.20.1-47.4.28"
    const loaderIds = LOADER_IDS[loader] ?? [];
    for (const id of loaderIds) versionOf.set(id, loaderPlain);

    const problems = [];
    const add = (mod, text) => {
        if (!problems.some((p) => p.fileName === mod.fileName && p.text === text)) problems.push({ fileName: mod.fileName, name: mod.name, text });
    };

    for (const mod of enabled) {
        const isNew = changed.has(mod.fileName);
        for (const [id, predicates] of Object.entries(mod.requires ?? {})) {
            const have = versionOf.get(id);
            if (!have) continue; // Not installed: fetched separately, or bundled.
            const idChanged = changedIds.has(id);
            const otherIsNew = changed.has(fileOf.get(id));
            if (!isNew && !otherIsNew && !idChanged) continue;
            if (!satisfies(have, predicates, mod.flavour)) {
                const who = nameOf.get(id) ?? id;
                if (idChanged) add(mod, `needs ${who} ${describe(predicates)}, not ${have}`);
                else if (isNew) add(mod, `needs ${who} ${describe(predicates)}, and this instance has ${have}`);
                else add({ fileName: fileOf.get(id), name: who }, `would break ${mod.name}, which needs ${who} ${describe(predicates)}`);
            }
        }
        for (const [id, predicates] of Object.entries(mod.breaks ?? {})) {
            const have = versionOf.get(id);
            const idChanged = changedIds.has(id);
            if (!have || !(fileOf.has(id) || idChanged)) continue;
            const otherIsNew = changed.has(fileOf.get(id));
            if (!isNew && !otherIsNew && !idChanged) continue;
            if (satisfies(have, predicates, mod.flavour)) {
                const who = nameOf.get(id) ?? id;
                if (isNew || idChanged) add(mod, `doesn't work with ${who} ${have}`);
                else add({ fileName: fileOf.get(id), name: who }, `doesn't work with ${mod.name}, which says it breaks with ${who} ${describe(predicates)}`);
            }
        }
    }
    return problems;
}

/* The ids mods use to ask for each loader. */
const LOADER_IDS = { fabric: ["fabricloader", "fabric-loader"], quilt: ["quilt_loader"], forge: ["forge"], neoforge: ["neoforge"] };

module.exports = { satisfies, problemsWith, describe, parseVersion, compare, LOADER_IDS, BUILT_IN_NAMES };
