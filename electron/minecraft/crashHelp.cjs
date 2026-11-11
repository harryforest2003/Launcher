const fs = require("fs");
const path = require("path");
const { modsIn } = require("./modInfo.cjs");

/*
 * Works out why Minecraft crashed, from its log, the crash report it wrote and any
 * crash file Java left, and which mods are most likely involved. Each cause has a plain
 * title, what was found, and the mods it points at, so the page can offer to disable them.
 */

// A class file version to the Java it needs: 52 is Java 8, 65 is Java 21.
const javaForClassVersion = (version) => Math.floor(Number(version)) - 44;

function newestFile(dir, matches, since) {
    let best = null;
    try {
        for (const name of fs.readdirSync(dir)) {
            if (!matches(name)) continue;
            const full = path.join(dir, name);
            const { mtimeMs } = fs.statSync(full);
            if (mtimeMs >= since && (!best || mtimeMs > best.mtimeMs)) best = { name, full, mtimeMs };
        }
    } catch {
        // No such folder.
    }
    return best;
}

const unique = (list) => [...new Map(list.filter(Boolean).map((mod) => [mod.fileName, mod])).values()];
const asRef = (mod) => ({ fileName: mod.fileName, name: mod.name, enabled: mod.enabled });

/* The mod a Java class belongs to, from the packages in each jar. */
function modForClass(mods, className) {
    const dir = className.replace(/\.[^.]+$/, "").replace(/\./g, "/");
    let best = null;
    for (const mod of mods) {
        for (const root of mod.packages) {
            if ((dir === root || dir.startsWith(root + "/")) && (!best || root.length > best.root.length)) best = { mod, root };
        }
    }
    return best?.mod ?? null;
}

/* The first stack trace's frames: where the crash happened, outermost last. */
function stackFrames(text) {
    const frames = [];
    for (const line of text.split("\n")) {
        const frame = line.match(/^\s+at ([\w.$]+)\.[\w$<>]+\(/);
        if (frame) frames.push(frame[1]);
        else if (frames.length && !/^\s+(\.\.\.|Caused by|Suppressed)/.test(line) && line.trim() && !/^\s+at /.test(line)) break;
        if (frames.length >= 40) break;
    }
    return frames;
}

/*
 * { gameDir, ram, lines, exitCode, startedAt } -> { crashed: false } or
 * { crashed: true, summary, causes, exitCode, reportFile, jvmCrashFile, description }
 */
async function analyzeCrash({ gameDir, ram, lines, exitCode = null, startedAt = 0 }) {
    const since = startedAt ? startedAt - 5000 : 0;
    const report = newestFile(path.join(gameDir, "crash-reports"), (name) => name.endsWith(".txt"), since);
    const jvmCrash = newestFile(gameDir, (name) => /^hs_err_pid\d+\.log$/.test(name), since);

    const logText = lines.join("\n");
    const reportText = report ? fs.readFileSync(report.full, "utf8") : "";
    const jvmText = jvmCrash ? fs.readFileSync(jvmCrash.full, "utf8").split("\n").slice(0, 80).join("\n") : "";
    const text = `${reportText}\n${logText}`;

    const crashed =
        (exitCode !== null && exitCode !== 0) ||
        Boolean(report || jvmCrash) ||
        /---- Minecraft Crash Report ----|Exception in thread "main"|Incompatible mods? (found|set)|Missing or unsupported mandatory dependencies/.test(logText);
    if (!crashed) return { crashed: false };

    const mods = await modsIn(path.join(gameDir, "mods"));
    const enabled = mods.filter((mod) => mod.enabled);
    const byId = new Map();
    for (const mod of enabled) for (const id of mod.ids) byId.set(id.toLowerCase(), mod);
    const byFile = new Map(enabled.map((mod) => [mod.fileName.toLowerCase(), mod]));
    const byMixin = new Map();
    for (const mod of enabled) for (const config of mod.mixinConfigs) byMixin.set(config.toLowerCase(), mod);
    const nameOf = (id, fallback) => byId.get(String(id).toLowerCase())?.name ?? fallback ?? id;

    const causes = [];
    const add = (cause) => {
        if (!causes.some((other) => other.title === cause.title)) causes.push({ fix: null, mods: [], ...cause, mods: unique(cause.mods ?? []).map(asRef) });
    };

    // Out of memory.
    if (/java\.lang\.OutOfMemoryError/.test(text)) {
        add({
            kind: "memory",
            title: "Minecraft ran out of memory",
            detail: `It was allowed ${ram} GB.`,
            fix: "Give it more RAM in this instance's Settings, or remove some heavy mods.",
        });
    }

    // Built for a newer Java than the one it ran on.
    const tooNew = text.match(/([\w/$.]+) has been compiled by a more recent version of the Java Runtime \(class file version ([\d.]+)\), this version of the Java Runtime only recognizes class file versions up to ([\d.]+)/);
    if (tooNew) {
        const need = javaForClassVersion(tooNew[2]);
        const have = javaForClassVersion(tooNew[3]);
        const mod = modForClass(enabled, tooNew[1].replace(/\//g, "."));
        add({
            kind: "java",
            title: `Needs Java ${need}`,
            detail: `${mod ? mod.name : "Part of the game"} needs Java ${need}, but it ran on Java ${have}.`,
            fix: "Set this instance's Java to Automatic in its Settings, which picks the right one.",
            mods: [mod],
        });
    }

    // Fabric and Quilt: a mod needs, or clashes with, another (or Minecraft, or Java).
    for (const match of text.matchAll(/^\s*-\s*(?:Installed )?[Mm]od ['"](.+?)['"] \(([^)]+)\) (\S+) (requires|recommends|is incompatible with|conflicts with|breaks) (.+?)$/gm)) {
        const [line, subjectName, subjectId, , relation, rest] = match;
        const dep = rest.match(/mod ['"](.+?)['"] \(([^)]+)\)/);
        const depName = dep?.[1] ?? "another mod";
        const depId = dep?.[2] ?? "";
        const subject = byId.get(subjectId.toLowerCase());

        if (depId === "java") {
            add({ kind: "java", title: `${subjectName} needs a different Java`, detail: line.trim().replace(/^-\s*/, ""), fix: "Set this instance's Java to Automatic in its Settings.", mods: [subject] });
        } else if (depId === "minecraft") {
            add({ kind: "version", title: `${subjectName} isn't made for this Minecraft version`, detail: line.trim().replace(/^-\s*/, ""), fix: `Update ${subjectName}, or remove it.`, mods: [subject] });
        } else if (/requires|recommends/.test(relation)) {
            const missing = /which is missing/.test(rest);
            add({
                kind: "dependency",
                title: missing ? `${subjectName} needs ${depName}, which isn't installed` : `${subjectName} needs a different version of ${depName}`,
                detail: line.trim().replace(/^-\s*/, ""),
                fix: missing ? `Add ${depName} from Add Content, or remove ${subjectName}.` : `Update ${depName} or ${subjectName} so they match.`,
                mods: [subject, byId.get(depId.toLowerCase())],
            });
        } else {
            add({
                kind: "conflict",
                title: `${subjectName} doesn't work with ${depName}`,
                detail: line.trim().replace(/^-\s*/, ""),
                fix: `Remove or disable one of them.`,
                mods: [subject, byId.get(depId.toLowerCase())],
            });
        }
    }
    const solution = text.match(/A potential solution has been determined[^:\n]*:\n((?:[ \t]*-.+\n?)+)/);
    if (solution && causes.length) {
        const steps = solution[1].trim().split("\n").map((step) => step.trim().replace(/^-\s*/, "")).join(" ");
        for (const cause of causes) {
            if (cause.kind === "dependency" || cause.kind === "conflict" || cause.kind === "version") cause.fix = `Fabric suggests: ${steps}`;
        }
    }

    // Forge and NeoForge: a missing or wrong dependency.
    for (const match of text.matchAll(/Mod ID: '([\w-]+)', Requested by: '([\w-]+)', Expected range: '([^']*)', Actual version: '([^']*)'/g)) {
        const [, depId, byWho, range, actual] = match;
        const missing = /MISSING/i.test(actual);
        add({
            kind: "dependency",
            title: `${nameOf(byWho)} needs ${nameOf(depId)}${missing ? ", which isn't installed" : ""}`,
            detail: `It needs ${depId} ${range}, ${missing ? "which isn't installed" : `but ${actual} is installed`}.`,
            fix: missing ? `Add ${depId} from Add Content, or remove ${nameOf(byWho)}.` : `Update ${depId} to a version in ${range}.`,
            mods: [byId.get(byWho.toLowerCase()), byId.get(depId.toLowerCase())],
        });
    }

    // The same mod twice.
    const seen = new Map();
    for (const mod of enabled) {
        for (const id of mod.ids.slice(0, 1)) {
            if (seen.has(id)) {
                add({
                    kind: "duplicate",
                    title: `${mod.name} is installed twice`,
                    detail: `${seen.get(id).fileName} and ${mod.fileName} are both ${mod.name}.`,
                    fix: "Remove the older one.",
                    mods: [seen.get(id), mod],
                });
            } else {
                seen.set(id, mod);
            }
        }
    }

    // A mod couldn't patch Minecraft (a failed mixin).
    const mixinMods = [];
    for (const match of text.matchAll(/Mixin apply (?:for mod ([\w-]+) )?failed ([\w.-]+\.json)/g)) {
        mixinMods.push(match[1] ? byId.get(match[1].toLowerCase()) : null, byMixin.get(match[2].toLowerCase()));
    }
    for (const line of text.split("\n").filter((l) => /mixin|inject/i.test(l) && /(Exception|Error|failed)/.test(l))) {
        for (const match of line.matchAll(/from mod ([\w-]+)/g)) mixinMods.push(byId.get(match[1].toLowerCase()));
        for (const match of line.matchAll(/([\w.-]+\.mixins?\.json)/g)) mixinMods.push(byMixin.get(match[1].toLowerCase()));
    }
    for (const mod of unique(mixinMods)) {
        add({
            kind: "mixin",
            title: `${mod.name} couldn't patch Minecraft`,
            detail: "Its changes to the game failed to apply.",
            fix: `This usually means ${mod.name} is for a different Minecraft version, or clashes with another mod. Update it, or disable it.`,
            mods: [mod],
        });
    }

    // Where in the code it crashed: suspected mods, jar names in the trace, then packages.
    const description = reportText.match(/^Description: (.+)$/m)?.[1] ?? null;
    const exception = (reportText || logText).match(/^((?:[\w$]+\.)+[\w$]*(?:Exception|Error)(?:: .+)?)$/m)?.[1] ?? null;
    const suspects = [];
    for (const match of text.matchAll(/Suspected Mods?: (.+)/g)) {
        for (const part of match[1].split(/,\s*/)) {
            const id = part.match(/\(([\w-]+)\)/)?.[1];
            suspects.push(id ? byId.get(id.toLowerCase()) : null);
        }
    }
    for (const match of text.matchAll(/\[([^[\]\s/]+?\.jar)(?:%23\d+)?[!:%\]]/g)) suspects.push(byFile.get(match[1].toLowerCase()));
    for (const match of text.matchAll(/TRANSFORMER\/([\w-]+)@/g)) if (!/^(minecraft|neoforge|forge)$/.test(match[1])) suspects.push(byId.get(match[1].toLowerCase()));
    if (!suspects.some(Boolean)) {
        for (const className of stackFrames(reportText || logText.slice(Math.max(0, logText.lastIndexOf("Exception") - 2000)))) {
            suspects.push(modForClass(enabled, className));
        }
    }
    const suspected = unique(suspects).slice(0, 4);
    if (suspected.length && !causes.some((cause) => cause.kind === "dependency" || cause.kind === "mixin")) {
        add({
            kind: "mod-code",
            title: `It crashed inside ${suspected.map((mod) => mod.name).join(", ")}`,
            detail: [description && `While: ${description.toLowerCase()}.`, exception].filter(Boolean).join(" "),
            fix: `Update ${suspected.length === 1 ? "it" : "them"}, or disable ${suspected.length === 1 ? "it" : "one at a time"} to see if the crash stops.`,
            mods: suspected,
        });
    }

    // Java itself crashed, often in the graphics driver.
    if (jvmText) {
        const frame = jvmText.match(/# Problematic frame:\n#\s*(.+)/)?.[1] ?? null;
        const graphics = /(nvoglv|atio6axx|ig\d+icd|libGL|nvidia|amdgpu|radeon|lwjgl|opengl|AppleMetal|AGX|Metal)/i.test(jvmText);
        const shaderMods = enabled.filter((mod) => mod.ids.some((id) => /^(iris|oculus|optifabric|sodium|embeddium|rubidium)$/.test(id)));
        add(
            graphics
                ? { kind: "graphics", title: "The graphics driver crashed", detail: frame ? `In ${frame}.` : "", fix: "Update your graphics drivers. Shader and rendering mods are the usual ones involved; try disabling them.", mods: shaderMods }
                : { kind: "java-crash", title: "Java itself crashed", detail: frame ? `In ${frame}.` : "", fix: "Try Repair, or the latest Java for this version (Automatic in the instance's Settings)." }
        );
    }

    if (!causes.length) {
        const errors = lines.filter((line) => /\b(ERROR|FATAL)\b|Exception|Error:|Caused by/.test(line)).slice(-3);
        add({
            kind: "unknown",
            title: `Minecraft stopped with an error${exitCode !== null ? ` (exit code ${exitCode})` : ""}`,
            detail: errors.join("\n") || "It didn't say why.",
            fix: "The log below shows what happened just before.",
        });
    }

    return {
        crashed: true,
        summary: causes[0].title,
        causes,
        exitCode,
        description,
        reportFile: report?.name ?? null,
        jvmCrashFile: jvmCrash?.name ?? null,
    };
}

module.exports = { analyzeCrash, javaForClassVersion };
