const fs = require("fs");
const path = require("path");
const { modsIn } = require("./modInfo.cjs");

/*
 * Works out why Minecraft crashed, from its log, the crash report it wrote and any crash
 * file Java left. Each cause says, in plain words, what went wrong, quotes the exact line
 * that shows it (and where that line is, so the page can jump to it), names the mod to
 * blame when one is, and gives a fix only when the evidence points to one.
 *
 * The line that matters is usually the deepest "Caused by:" of the exception that
 * stopped the game: everything above it is the game passing the problem up.
 */

// A class file version to the Java it needs: 52 is Java 8, 65 is Java 21.
const javaForClassVersion = (version) => Math.floor(Number(version)) - 44;

/* ---------------- reading the files ---------------- */

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

// "[14:19:27] [main/ERROR]:", Forge's "[11Nov2026 14:19:27.123] [main/ERROR] [x/]:", or no time.
const HEADER = /^(?:\[[^\]]*\] )?\[[^\]]*\/(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\]/;
const LEVELS = { TRACE: "info", DEBUG: "info", INFO: "info", WARN: "warn", WARNING: "warn", ERROR: "error", FATAL: "error" };
const EXCEPTION = /^\s*(?:Caused by: |Suppressed: )?((?:[a-zA-Z_$][\w$]*\.)+[\w$]*(?:Exception|Error|Throwable))(?::\s?(.*))?$/;

/*
 * Each line's level. A line without its own "[time] [thread/LEVEL]" header (a stack trace,
 * the list under "Warnings were found!") belongs to the entry above it.
 */
function lineLevels(lines) {
    let current = "info";
    return lines.map((line) => {
        if (line.startsWith("[Unity Launcher]")) return "launcher";
        const header = line.match(HEADER);
        if (header) {
            current = LEVELS[header[1]];
            return current;
        }
        if (/^Exception in thread /.test(line)) {
            current = "error";
            return current;
        }
        // A trace printed straight to the console, outside any log entry.
        if (current === "info" && (EXCEPTION.test(line) || /^\s+at \S/.test(line))) return "error";
        return current;
    });
}

/* ---------------- stack traces ---------------- */

/*
 * The exceptions in some lines, as chains: the exception first logged, then each
 * "Caused by:" (and "Suppressed:") under it, with their frames and line numbers.
 */
function exceptionChains(lines) {
    const chains = [];
    let chain = null;
    let node = null;

    lines.forEach((line, index) => {
        const thread = line.match(/^Exception in thread "[^"]*" (.+)$/);
        const exception = (thread ? thread[1] : line).match(EXCEPTION);
        const frame = line.match(/^\s+at (\S+?)\(([^)]*)\)(.*)$/);

        if (exception && !frame) {
            const relation = /^\s*Caused by: /.test(line) ? "cause" : /^\s*Suppressed: /.test(line) ? "suppressed" : "top";
            if (relation === "top" || !chain) {
                chain = { nodes: [], start: index };
                chains.push(chain);
            }
            node = { relation, indent: line.match(/^\s*/)[0].length, exception: exception[1], message: exception[2] ?? "", index, line, frames: [] };
            chain.nodes.push(node);
        } else if (frame && node) {
            node.frames.push({ ...parseFrame(frame[1], frame[3]), index, line });
        } else if (node && /^\s+\.\.\. \d+ (more|common frames omitted)/.test(line)) {
            // Frames shared with the exception above.
        } else if (chain && line.trim()) {
            chain = null;
            node = null;
        }
    });

    return chains;
}

/* "knot//net.foo.Bar.baz", "TRANSFORMER/create@0.5.1/com.simibubi.X.y", plus what follows the brackets. */
function parseFrame(token, rest) {
    const method = token.split("/").pop();
    return {
        className: method.replace(/\.[^.]+$/, ""),
        transformerMod: token.match(/(?:^|\/)([\w-]+)@[^/]+\//)?.[1] ?? null,
        jar: (rest ?? "").match(/\[([^[\]\s/]+?\.jar)/)?.[1] ?? null,
        mixinConfigs: [...(rest ?? "").matchAll(/([\w.-]+\.mixins?\.json)/g)].map((m) => m[1]),
    };
}

/* The chain that stopped the game: the crash report's, or the last one the log called an error. */
function crashChain(reportLines, logLines, levels) {
    const reportChain = exceptionChains(reportLines)[0];
    if (reportChain) return { chain: reportChain, source: "report" };

    const chains = exceptionChains(logLines).filter((chain) => {
        const intro = logLines[chain.start - 1] ?? "";
        return levels[chain.start] === "error" || /\b(ERROR|FATAL)\]|crash/i.test(intro) || /^Exception in thread/.test(logLines[chain.start]);
    });
    const last = chains.at(-1);
    return last ? { chain: last, source: "log" } : null;
}

/* The deepest "Caused by:" of the chain's own line (not of a "Suppressed:" beside it). */
function rootOf(chain) {
    const top = chain.nodes[0];
    const main = chain.nodes.filter((node) => node.relation !== "suppressed" && node.indent === top.indent);
    return { root: main.at(-1), main };
}

/* ---------------- what belongs to whom ---------------- */

// Classes that are part of Minecraft itself.
const GAME = /^(net\.minecraft|com\.mojang\.(blaze3d|math|realmsclient))\./;

// Classes Minecraft or the mod loader bring with them, not mods.
const GAME_LIBRARIES = [
    [/^org\.lwjgl\./, "LWJGL, the library Minecraft draws and plays sound with"],
    [/^io\.netty\./, "Netty, Minecraft's networking library"],
    [/^com\.mojang\.(authlib|brigadier|datafixers|serialization|logging|text2speech|jtracy)\./, "one of Mojang's libraries"],
    [/^(com\.google|org\.apache|it\.unimi|org\.joml|org\.slf4j|oshi|com\.ibm\.icu|com\.sun\.jna|org\.objectweb|net\.java|org\.jcraft|org\.jline)\./, "one of Minecraft's libraries"],
    [/^(net\.fabricmc\.loader|org\.quiltmc\.loader|cpw\.mods|net\.minecraftforge\.fml|net\.neoforged\.fml|org\.spongepowered\.asm)\./, "part of the mod loader"],
];

// Library mods other mods often need, by the packages their code is in.
const KNOWN_MODS = [
    [/^net\.fabricmc\.fabric\./, "Fabric API"],
    [/^dev\.architectury\./, "Architectury API"],
    [/^me\.shedaniel\.(clothconfig2|autoconfig)\./, "Cloth Config API"],
    [/^fi\.dy\.masa\.malilib\./, "MaLiLib"],
    [/^software\.bernie\.geckolib/, "GeckoLib"],
    [/^io\.wispforest\.owo\./, "owo-lib"],
    [/^dev\.isxander\.yacl/, "YetAnotherConfigLib"],
    [/^fuzs\.puzzleslib\./, "Puzzles Lib"],
    [/^fuzs\.forgeconfigapiport\./, "Forge Config API Port"],
    [/^net\.blay09\.mods\.balm\./, "Balm"],
    [/^com\.terraformersmc\.modmenu\./, "Mod Menu"],
    [/^dev\.emi\.trinkets\./, "Trinkets"],
    [/^top\.theillusivec4\.curios\./, "Curios API"],
    [/^com\.teamresourceful\.resourcefullib\./, "Resourceful Lib"],
    [/^com\.natamus\.collective\./, "Collective"],
    [/^net\.mehvahdjukaar\.moonlight\./, "Moonlight Lib"],
    [/^team\.creative\.creativecore\./, "CreativeCore"],
    [/^vazkii\.patchouli\./, "Patchouli"],
    [/^mod\.azure\.azurelib\./, "AzureLib"],
    [/^net\.darkhax\.bookshelf\./, "Bookshelf"],
    [/^eu\.midnightdust\.lib\./, "MidnightLib"],
    [/^(org\.ladysnake|dev\.onyxstudios)\.cca\./, "Cardinal Components API"],
    [/^net\.irisshaders\.iris\./, "Iris Shaders"],
    [/^net\.caffeinemc\.mods\.sodium\./, "Sodium"],
    [/^kotlin\./, "Kotlin (Fabric Language Kotlin, or Kotlin for Forge)"],
];

const libraryOf = (className) => GAME_LIBRARIES.find(([pattern]) => pattern.test(className))?.[1] ?? null;
const knownModOf = (className) => KNOWN_MODS.find(([pattern]) => pattern.test(className))?.[1] ?? null;

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

const unique = (list) => [...new Map(list.filter(Boolean).map((mod) => [mod.fileName, mod])).values()];
const asRef = (mod) => ({ fileName: mod.fileName, name: mod.name, enabled: mod.enabled });
const listNames = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const dotted = (name) => name.replace(/\//g, ".");

/* ---------------- the analysis ---------------- */

/*
 * { gameDir, ram, lines, exitCode, startedAt, mcVersion } -> { crashed: false } or
 * { crashed: true, summary, causes, exitCode, reportFile, jvmCrashFile, description }
 *
 * Each cause: { kind, title, detail, fix, action, mods, evidence }, where evidence is the
 * line that shows it: { text, source: "log" | "report" | "java", index } (index into that
 * source's lines, so the log view can jump to it), and action is the button that does
 * the fix: "repair", "settings", "add-content" or null.
 */
async function analyzeCrash({ gameDir, ram, lines, exitCode = null, startedAt = 0, mcVersion = null }) {
    const since = startedAt ? startedAt - 5000 : 0;
    const report = newestFile(path.join(gameDir, "crash-reports"), (name) => name.endsWith(".txt"), since);
    const jvmCrash = newestFile(gameDir, (name) => /^hs_err_pid\d+\.log$/.test(name), since);

    const logLines = lines;
    const levels = lineLevels(logLines);
    const reportText = report ? fs.readFileSync(report.full, "utf8") : "";
    const reportLines = reportText ? reportText.split(/\r?\n/) : [];
    const jvmLines = jvmCrash ? fs.readFileSync(jvmCrash.full, "utf8").split(/\r?\n/).slice(0, 120) : [];
    const logText = logLines.join("\n");

    const crashed =
        (exitCode !== null && exitCode !== 0) ||
        Boolean(report || jvmCrash) ||
        /---- Minecraft Crash Report ----|Exception in thread "main"|Incompatible mods? (found|set)|Missing or unsupported mandatory dependencies|crashed on startup/.test(logText);
    if (!crashed) return { crashed: false };

    const mods = await modsIn(path.join(gameDir, "mods"));
    const enabled = mods.filter((mod) => mod.enabled);
    const byId = new Map();
    for (const mod of enabled) for (const id of mod.ids) byId.set(id.toLowerCase(), mod);
    const byFile = new Map(enabled.map((mod) => [mod.fileName.toLowerCase(), mod]));
    const byMixin = new Map();
    for (const mod of enabled) for (const config of mod.mixinConfigs) byMixin.set(config.toLowerCase(), mod);
    const modById = (id) => (id ? byId.get(String(id).toLowerCase()) ?? null : null);
    const nameOf = (id) => modById(id)?.name ?? id;
    const forMinecraft = mcVersion ? ` made for Minecraft ${mcVersion}` : " made for this Minecraft version";

    // Searchable lines: the log's errors (with their level) and the whole crash report.
    const errorLines = [
        ...logLines.map((text, index) => ({ text, source: "log", index })).filter((_, index) => levels[index] === "error"),
        ...reportLines.map((text, index) => ({ text, source: "report", index })),
    ];
    const evidenceAt = (source, index, text) => ({ text: text.trim(), source, index });
    const firstMatch = (pattern) => {
        const found = errorLines.find((line) => pattern.test(line.text));
        return found ? evidenceAt(found.source, found.index, found.text) : null;
    };

    const causes = [];
    const add = (cause) => {
        if (causes.some((other) => other.title === cause.title)) return;
        causes.push({ fix: null, action: null, detail: "", evidence: null, ...cause, mods: unique(cause.mods ?? []).map(asRef) });
    };

    /* The mod a stack frame is in: Forge names it, a crash report names the jar, else by package. */
    const modForFrame = (frame) => {
        if (frame.transformerMod && !/^(minecraft|forge|neoforge|fml|mixin)$/.test(frame.transformerMod)) {
            const mod = modById(frame.transformerMod);
            if (mod) return mod;
        }
        if (frame.jar) {
            const mod = byFile.get(frame.jar.toLowerCase());
            if (mod) return mod;
        }
        return modForClass(enabled, frame.className);
    };

    /* ---- 1. What the mod loader itself refused (definite, so first). ---- */

    // Fabric and Quilt. "recommends" and "suggests" are only warnings, so they don't count.
    for (const line of errorLines) {
        const match = line.text.match(
            /^\s*-\s*(?:Installed )?[Mm]od ['"](.+?)['"] \(([^)]+)\) (\S+) (requires|depends on|is incompatible with|breaks|conflicts with) (.+?) of (?:mod ['"](.+?)['"] \(([^)]+)\)|([\w.-]+))(.*)$/
        );
        if (!match) continue;
        const [, subjectName, subjectId, , relation, wanted, depNameGiven, depIdGiven, depIdBare, tail] = match;
        const depId = depIdGiven ?? depIdBare;
        const depName = depNameGiven ?? modById(depId)?.name ?? depId;
        const subject = modById(subjectId);
        const evidence = evidenceAt(line.source, line.index, line.text.replace(/^\s*-\s*/, ""));
        const have = tail.match(/wrong version is present: (.+?)!?$/)?.[1];

        if (depId === "java") {
            add({ kind: "java", depId, title: `${subjectName} needs a different version of Java`, detail: `It needs ${wanted} of Java.`, evidence, fix: "Choose a different Java for this instance in its Settings.", action: "settings", mods: [subject] });
        } else if (depId === "minecraft") {
            add({ kind: "version", depId, title: `${subjectName} isn't made for Minecraft ${mcVersion ?? "this version"}`, detail: `It needs ${wanted} of Minecraft.`, evidence, fix: `Get the version of ${subjectName}${forMinecraft}, or remove it.`, mods: [subject] });
        } else if (/requires|depends/.test(relation)) {
            const missing = /which is missing/.test(tail);
            add({
                kind: "dependency",
                depId,
                title: missing ? `${subjectName} needs ${depName}, which isn't installed` : `${subjectName} needs a different version of ${depName}`,
                detail: missing ? (wanted === "any version" ? "" : `It needs ${wanted} of ${depName}.`) : `It needs ${wanted} of ${depName}${have ? `, but ${have} is installed` : ""}.`,
                evidence,
                fix: missing ? `Add ${depName} from Add Content.` : `Install ${wanted} of ${depName}.`,
                action: missing ? "add-content" : null,
                mods: [subject, modById(depId)],
            });
        } else {
            add({
                kind: "conflict",
                depId,
                title: `${subjectName} doesn't work with ${depName}`,
                detail: `${subjectName} says it ${relation} ${wanted} of ${depName}.`,
                evidence,
                fix: "Disable one of them.",
                mods: [subject, modById(depId)],
            });
        }
    }
    // Fabric's own suggestions ("Install malilib, any version."), each on the cause it's about.
    const solution = (reportText + "\n" + logText).match(/A potential solution has been determined[^:\n]*:\n((?:[ \t]*-.+\n?)+)/);
    if (solution) {
        const steps = solution[1].trim().split("\n").map((step) => step.trim().replace(/^-\s*/, ""));
        for (const cause of causes) {
            const about = steps.filter((step) => cause.depId && new RegExp(`\\b${cause.depId.replace(/[^\w-]/g, "")}\\b`, "i").test(step));
            if (about.length) cause.fix = `The mod loader suggests: ${about.join(" ")}`;
        }
    }
    for (const cause of causes) delete cause.depId;

    // Forge and NeoForge.
    for (const line of [...errorLines, ...logLines.map((text, index) => ({ text, source: "log", index }))]) {
        const match = line.text.match(/Mod ID: '([\w-]+)', Requested by: '([\w-]+)', Expected range: '([^']*)', Actual version: '([^']*)'/);
        if (!match) continue;
        const [, depId, byWho, range, actual] = match;
        const missing = /MISSING/i.test(actual);
        add({
            kind: "dependency",
            title: `${nameOf(byWho)} needs ${nameOf(depId)}${missing ? ", which isn't installed" : ` ${range}`}`,
            detail: missing ? `It needs ${depId} ${range}.` : `It needs ${depId} ${range}, but ${actual} is installed.`,
            evidence: evidenceAt(line.source, line.index, line.text),
            fix: missing ? `Add ${nameOf(depId)} from Add Content.` : `Install a version of ${nameOf(depId)} in ${range}.`,
            action: missing ? "add-content" : null,
            mods: [modById(byWho), modById(depId)],
        });
    }

    // The same mod twice, when the loader complained about it.
    if (/duplicate|multiple (copies|versions)|mods? with (the same )?id/i.test(errorLines.map((line) => line.text).join("\n"))) {
        const seen = new Map();
        for (const mod of enabled) {
            const id = mod.ids[0];
            if (!id) continue;
            if (seen.has(id)) {
                add({
                    kind: "duplicate",
                    title: `${mod.name} is installed twice`,
                    detail: `${seen.get(id).fileName} and ${mod.fileName} are both ${mod.name}.`,
                    evidence: firstMatch(new RegExp(`duplicate|${id}`, "i")),
                    fix: "Remove the older one.",
                    mods: [seen.get(id), mod],
                });
            } else {
                seen.set(id, mod);
            }
        }
    }
    const loaderRefused = causes.length > 0;

    /* ---- 2. The exception that stopped the game. ---- */

    const found = crashChain(reportLines, logLines, levels);
    if (found && !loaderRefused) {
        const { chain, source } = found;
        const { root, main } = rootOf(chain);
        const evidence = evidenceAt(source, root.index, root.line);
        const allFrames = chain.nodes.flatMap((node) => node.frames);

        // The mod nearest the problem: walk out from the root cause until a frame is a mod's.
        const nearest = () => {
            for (const node of [...main].reverse()) {
                for (const frame of node.frames) {
                    const mod = modForFrame(frame);
                    if (mod) return mod;
                }
            }
            return null;
        };
        // Every mod the exception passed through, or names ("provided by 'axiom'").
        const touched = () =>
            unique([
                ...allFrames.map(modForFrame),
                ...chain.nodes.flatMap((node) => [...node.message.matchAll(/provided by '([\w-]+)'|from mod ([\w-]+)/g)].map((m) => modById(m[1] ?? m[2]))),
            ]);

        // "Could not initialize class X" is a class that failed earlier, not a missing one.
        const missingToken = root.message.trim().split(/\s/)[0];
        const missingClass =
            /ClassNotFoundException|NoClassDefFoundError/.test(root.exception) && /[./]/.test(missingToken) && !/^Could not/.test(root.message)
                ? dotted(missingToken)
                : null;
        const missingMember = /NoSuchMethodError|NoSuchFieldError|AbstractMethodError|IncompatibleClassChangeError/.test(root.exception);
        const mixinNode = [...chain.nodes].reverse().find((node) => /mixin|injection/i.test(node.exception) && !/RuntimeException/.test(node.exception));

        if (/OutOfMemoryError/.test(root.exception)) {
            add({ kind: "memory", title: "Minecraft ran out of memory", detail: `It was allowed ${ram} GB.`, evidence, fix: "Give it more memory in this instance's Settings, or remove some heavy mods.", action: "settings" });
        } else if (missingClass) {
            const library = libraryOf(missingClass);
            const culprit = nearest();
            const owner = modForClass(mods, missingClass);
            if (library) {
                const others = touched().map((mod) => mod.name);
                add({
                    kind: "install",
                    title: `Part of Minecraft is missing: ${library.split(",")[0]}`,
                    detail:
                        `The game couldn't find ${missingClass}, which is ${library}. It comes with Minecraft, not with a mod, so the instance's game files are incomplete.` +
                        (others.length ? ` ${listNames(others)} only ran into it first; ${others.length === 1 ? "it isn't" : "they aren't"} the cause.` : ""),
                    evidence,
                    fix: "Repair this instance to download Minecraft's files again.",
                    action: "repair",
                });
            } else if (GAME.test(missingClass)) {
                add({
                    kind: "version",
                    title: culprit ? `${culprit.name} is made for a different version of Minecraft` : "A mod is made for a different version of Minecraft",
                    detail: `It uses ${missingClass}, which Minecraft ${mcVersion ?? "in this instance"} doesn't have.`,
                    evidence,
                    fix: culprit ? `Get the version of ${culprit.name}${forMinecraft}, or disable it.` : null,
                    mods: [culprit],
                });
            } else if (owner && owner !== culprit) {
                const isOff = !owner.enabled;
                add({
                    kind: "dependency",
                    title: isOff ? `${culprit?.name ?? "A mod"} needs ${owner.name}, which is disabled` : `${culprit?.name ?? "A mod"} needs a different version of ${owner.name}`,
                    detail: isOff ? `It uses ${missingClass}, from ${owner.name}.` : `It uses ${missingClass}, which this version of ${owner.name} doesn't have.`,
                    evidence,
                    fix: isOff ? `Enable ${owner.name} in Content.` : `Update ${culprit ? `${culprit.name} and ${owner.name}` : owner.name} so they match.`,
                    mods: [culprit, owner.enabled ? owner : null],
                });
            } else {
                const needed = knownModOf(missingClass);
                add({
                    kind: "dependency",
                    title: `${culprit?.name ?? "A mod"} needs ${needed ?? "another mod"}, which isn't installed`,
                    detail: `It looked for ${missingClass}, which no installed mod has.`,
                    evidence,
                    fix: needed ? `Add ${needed.split(" (")[0]} from Add Content.` : culprit ? `Check ${culprit.name}'s page for the mods it needs.` : null,
                    action: needed ? "add-content" : null,
                    mods: [culprit],
                });
            }
        } else if (missingMember) {
            const culprit = nearest();
            const owner = dotted(root.message.match(/([\w$./]+)\.[\w$<>]+\(/)?.[1] ?? root.message.match(/([\w$./]+)\.[\w$]+'?\s*$/)?.[1] ?? "");
            const ownerMod = owner ? modForClass(enabled, owner) : null;
            if (owner && GAME.test(owner)) {
                add({
                    kind: "version",
                    title: culprit ? `${culprit.name} is made for a different version of Minecraft` : "A mod is made for a different version of Minecraft",
                    detail: `It uses part of Minecraft (${owner}) that's different in Minecraft ${mcVersion ?? "this version"}.`,
                    evidence,
                    fix: culprit ? `Get the version of ${culprit.name}${forMinecraft}, or disable it.` : null,
                    mods: [culprit],
                });
            } else if (ownerMod && ownerMod !== culprit) {
                add({
                    kind: "dependency",
                    title: `${culprit?.name ?? "A mod"} needs a different version of ${ownerMod.name}`,
                    detail: `It uses part of ${ownerMod.name} (${owner}) that this version doesn't have.`,
                    evidence,
                    fix: `Update ${culprit ? `${culprit.name} and ${ownerMod.name}` : ownerMod.name} so they match.`,
                    mods: [culprit, ownerMod],
                });
            } else {
                add({
                    kind: "version",
                    title: `${culprit?.name ?? "A mod"} doesn't match the Minecraft or mods it's installed with`,
                    detail: "It expected code that isn't there.",
                    evidence,
                    fix: culprit ? `Update ${culprit.name}.` : null,
                    mods: [culprit],
                });
            }
        } else if (mixinNode) {
            const fromMessage = mixinNode.message.match(/from mod ([\w-]+)/)?.[1];
            const config = mixinNode.message.match(/([\w.-]+\.mixins?\.json)/)?.[1];
            const mod = modById(fromMessage) ?? (config ? byMixin.get(config.toLowerCase()) : null) ?? nearest();
            add({
                kind: "mixin",
                title: mod ? `${mod.name} couldn't change Minecraft's code` : "A mod couldn't change Minecraft's code",
                detail: "Mods change the game's code as it loads. This change no longer fits, usually because the mod is for a different Minecraft version or another mod changed the same code.",
                evidence: evidenceAt(source, mixinNode.index, mixinNode.line),
                fix: mod ? `Get the version of ${mod.name}${forMinecraft}, or disable it.` : null,
                mods: [mod],
            });
        } else if (/UnsupportedClassVersionError/.test(root.exception) || /compiled by a more recent version of the Java Runtime/.test(root.message)) {
            const version = root.message.match(/class file version ([\d.]+)/)?.[1];
            const have = root.message.match(/up to ([\d.]+)/)?.[1];
            const mod = modForClass(enabled, dotted(root.message.split(" ")[0])) ?? nearest();
            const need = version ? javaForClassVersion(version) : null;
            add({
                kind: "java",
                title: need ? `${mod?.name ?? "A mod"} needs Java ${need}` : `${mod?.name ?? "A mod"} needs a newer Java`,
                detail: need && have ? `It ran on Java ${javaForClassVersion(have)}.` : "",
                evidence,
                fix: mod ? `Get the version of ${mod.name}${forMinecraft}, or choose Java ${need ?? "a newer Java"} for this instance in its Settings.` : null,
                action: "settings",
                mods: [mod],
            });
        } else if (/too big|larger than|exceeds (the )?maximum|Badly compressed packet|TooLongFrame|too many packets/i.test(chain.nodes.map((node) => `${node.exception} ${node.message}`).join("\n"))) {
            const packetNode = chain.nodes.find((node) => /too big|larger than|exceeds|Badly compressed|TooLongFrame|too many packets/i.test(`${node.exception} ${node.message}`));
            const channel = packetNode.message.match(/\b([a-z0-9_.-]+):[a-z0-9_./-]+/)?.[1];
            const mod = (channel && channel !== "minecraft" ? modById(channel) : null) ?? nearest();
            add({
                kind: "network",
                title: mod ? `${mod.name} sent more data at once than Minecraft allows` : "A mod sent more data at once than Minecraft allows",
                detail: "Minecraft limits how much one network message can carry, and this one was over the limit.",
                evidence: evidenceAt(source, packetNode.index, packetNode.line),
                fix: mod ? `Update ${mod.name}. If it keeps happening, disable it.` : null,
                mods: [mod],
            });
        } else {
            // Not a kind we recognise: say where it happened, without guessing a fix.
            const suspects = [];
            const suspectAt = reportLines.findIndex((line) => /Suspected Mods?:/.test(line));
            if (suspectAt >= 0) {
                for (const line of reportLines.slice(suspectAt, suspectAt + 4)) {
                    for (const match of line.matchAll(/\(([\w-]+)\)/g)) suspects.push(modById(match[1]));
                }
            }
            const culprit = nearest();
            const involved = unique([culprit, ...suspects]).slice(0, 3);
            add({
                kind: involved.length ? "mod-code" : "unknown",
                title: involved.length ? `It crashed inside ${listNames(involved.map((mod) => mod.name))}` : "Minecraft stopped with an error",
                detail: `${root.exception.split(".").pop()}${root.message ? `: ${root.message}` : ""}`,
                evidence,
                mods: involved,
            });
        }
    }

    /* ---- 3. Things the log says outside an exception. ---- */

    const memory = firstMatch(/java\.lang\.OutOfMemoryError/);
    if (memory) add({ kind: "memory", title: "Minecraft ran out of memory", detail: `It was allowed ${ram} GB.`, evidence: memory, fix: "Give it more memory in this instance's Settings, or remove some heavy mods.", action: "settings" });

    const mixinLine = errorLines.find((line) => /Mixin apply (?:for mod ([\w-]+) )?failed ([\w.-]+\.json)/.test(line.text));
    if (mixinLine) {
        const [, id, config] = mixinLine.text.match(/Mixin apply (?:for mod ([\w-]+) )?failed ([\w.-]+\.json)/);
        const mod = modById(id) ?? byMixin.get(config.toLowerCase());
        if (mod) {
            add({
                kind: "mixin",
                title: `${mod.name} couldn't change Minecraft's code`,
                detail: "Mods change the game's code as it loads. This change no longer fits, usually because the mod is for a different Minecraft version or another mod changed the same code.",
                evidence: evidenceAt(mixinLine.source, mixinLine.index, mixinLine.text),
                fix: `Get the version of ${mod.name}${forMinecraft}, or disable it.`,
                mods: [mod],
            });
        }
    }

    const graphics = firstMatch(/GLFW error (65542|65543)|driver does not appear to support OpenGL|Pixel format not accelerated|Could not create (the )?(OpenGL )?context|Failed to create window/i);
    if (graphics) {
        add({
            kind: "graphics",
            title: "Your graphics driver couldn't start Minecraft's graphics",
            detail: "Minecraft asked for OpenGL and the graphics driver said no.",
            evidence: graphics,
            fix: process.platform === "darwin" ? "Update macOS, which includes the graphics drivers." : "Update your graphics drivers from your graphics card maker's website.",
        });
    }

    // A crash report says which entity or block entity was being updated.
    const ticking = reportText.match(/-- (Entity|Block entity) being ticked --\s*\nDetails:\s*\n\s*(?:Entity Type|Name): ([\w.-]+):([\w./-]+)/);
    if (ticking && ticking[2] !== "minecraft" && modById(ticking[2])) {
        const mod = modById(ticking[2]);
        const at = reportLines.findIndex((line) => line.includes(`${ticking[2]}:${ticking[3]}`));
        add({
            kind: "mod-code",
            title: `${mod.name}'s ${ticking[3].replace(/_/g, " ")} crashed the game`,
            detail: `It crashed while the game was updating a${ticking[1] === "Entity" ? "n entity" : " block"} from ${mod.name}.`,
            evidence: at >= 0 ? evidenceAt("report", at, reportLines[at]) : null,
            fix: `Update ${mod.name}.`,
            mods: [mod],
        });
    }

    // Java itself crashed, often in the graphics driver.
    if (jvmLines.length) {
        const at = jvmLines.findIndex((line) => /# Problematic frame:/.test(line));
        const frame = at >= 0 ? (jvmLines[at + 1] ?? "").replace(/^#\s*/, "") : "";
        const graphicsCrash = /(nvoglv|atio6axx|ig\d+icd|libGL|nvidia|amdgpu|radeon|lwjgl|opengl|AppleMetal|AGX|Metal)/i.test(jvmLines.join("\n"));
        const renderMods = enabled.filter((mod) => mod.ids.some((id) => /^(iris|oculus|optifabric|sodium|embeddium|rubidium)$/.test(id)));
        add({
            kind: graphicsCrash ? "graphics" : "java-crash",
            title: graphicsCrash ? "The graphics driver crashed" : "Java itself crashed",
            detail: frame ? `It crashed in ${frame}.` : "",
            evidence: at >= 0 ? evidenceAt("java", at + 1, jvmLines[at + 1]) : null,
            fix: graphicsCrash
                ? `${process.platform === "darwin" ? "Update macOS, which includes the graphics drivers." : "Update your graphics drivers."}${renderMods.length ? ` If it keeps happening, try without ${listNames(renderMods.map((mod) => mod.name))}.` : ""}`
                : null,
            mods: graphicsCrash ? renderMods : [],
        });
    }

    if (!causes.length) {
        const last = [...logLines.keys()].reverse().find((index) => levels[index] === "error");
        add({
            kind: "unknown",
            title: `Minecraft stopped${exitCode !== null && exitCode !== 0 ? ` with exit code ${exitCode}` : ""}`,
            detail: last === undefined ? "It didn't say why." : "This is the last error it logged.",
            evidence: last === undefined ? null : evidenceAt("log", last, logLines[last]),
        });
    }

    return {
        crashed: true,
        summary: causes[0].title,
        causes,
        exitCode,
        description: reportText.match(/^Description: (.+)$/m)?.[1] ?? null,
        reportFile: report?.name ?? null,
        jvmCrashFile: jvmCrash?.name ?? null,
    };
}

module.exports = { analyzeCrash, javaForClassVersion, lineLevels, exceptionChains };
