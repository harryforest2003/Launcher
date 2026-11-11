const fs = require("fs");
const { withZip } = require("./zipFile.cjs");
const { modInfo } = require("./modInfo.cjs");

/*
 * Add-ons that change another mod's code (Eclipse's Tweakeroo Additions changes
 * Tweakeroo's) only fit the versions of it they were made for, and rarely say which. Their
 * mixins name the classes, methods and fields they change, so an update that changes those
 * in the mod underneath would stop the game starting. This finds those before they go in.
 *
 * Only what would really fail is reported: a class or member the add-on relies on that's
 * gone, a method whose arguments changed under an @Inject, and anything else it requires.
 * Whatever can't be read with certainty counts as fine, as in compat.cjs.
 */

/* ---------------- class files ---------------- */

/*
 * The parts of a .class file this needs: its name, superclass, fields and methods (name and
 * descriptor) and the annotations on each. Null if it isn't a class file we can read.
 */
function parseClass(buf) {
    try {
        let p = 0;
        const u1 = () => buf[p++];
        const u2 = () => {
            const v = buf.readUInt16BE(p);
            p += 2;
            return v;
        };
        const u4 = () => {
            const v = buf.readUInt32BE(p);
            p += 4;
            return v;
        };
        if (u4() !== 0xcafebabe) return null;
        p += 4; // Version.

        const count = u2();
        const pool = new Array(count);
        for (let i = 1; i < count; i++) {
            const tag = u1();
            switch (tag) {
                case 1: {
                    const length = u2();
                    pool[i] = buf.toString("utf8", p, p + length);
                    p += length;
                    break;
                }
                case 3:
                    pool[i] = buf.readInt32BE(p);
                    p += 4;
                    break;
                case 4:
                    p += 4;
                    break;
                case 5:
                case 6:
                    p += 8;
                    i++; // Longs and doubles take two slots.
                    break;
                case 7:
                case 8:
                case 16:
                case 19:
                case 20:
                    pool[i] = { ref: u2() };
                    break;
                case 9:
                case 10:
                case 11:
                case 12:
                case 17:
                case 18:
                    p += 4;
                    break;
                case 15:
                    p += 3;
                    break;
                default:
                    return null;
            }
        }
        const text = (i) => (typeof pool[i] === "string" ? pool[i] : null);
        const classAt = (i) => text(pool[i]?.ref);

        function readValue() {
            const tag = String.fromCharCode(u1());
            if (tag === "e") {
                const type = text(u2());
                return { enum: type, name: text(u2()) };
            }
            if (tag === "c") return { class: text(u2()) };
            if (tag === "@") return readAnnotation();
            if (tag === "[") {
                const values = [];
                for (let n = u2(); n > 0; n--) values.push(readValue());
                return values;
            }
            return pool[u2()] ?? null; // A string, or an int (require = 1) or boolean.
        }
        function readAnnotation() {
            const type = text(u2());
            const values = {};
            for (let n = u2(); n > 0; n--) {
                const key = text(u2());
                values[key] = readValue();
            }
            return { type, values };
        }
        function readAttributes() {
            const annotations = [];
            for (let n = u2(); n > 0; n--) {
                const name = text(u2());
                const end = u4() + p;
                if (name === "RuntimeVisibleAnnotations" || name === "RuntimeInvisibleAnnotations") {
                    for (let a = u2(); a > 0; a--) annotations.push(readAnnotation());
                }
                p = end;
            }
            return annotations;
        }
        function readMembers() {
            const members = [];
            for (let n = u2(); n > 0; n--) {
                p += 2; // Access flags.
                const name = text(u2());
                const desc = text(u2());
                members.push({ name, desc, annotations: readAttributes() });
            }
            return members;
        }

        p += 2; // Access flags.
        const name = classAt(u2());
        const superIndex = u2();
        const superName = superIndex ? classAt(superIndex) : null;
        const interfaces = u2(); // Read first: "p += u2() * 2" would add to the old p.
        p += interfaces * 2;
        const fields = readMembers();
        const methods = readMembers();
        return { name, superName, fields, methods, annotations: readAttributes() };
    } catch {
        return null;
    }
}

/* ---------------- what a jar holds ---------------- */

const versionKey = (file) => {
    const { size, mtimeMs } = fs.statSync(file);
    return `${file}:${size}:${mtimeMs}`;
};

function cached(map, key, make) {
    if (!map.has(key)) map.set(key, make().catch(() => null));
    return map.get(key);
}

const lists = new Map();

/* The classes in a jar, as internal names ("fi/dy/masa/tweakeroo/tweaks/PlacementTweaks"). */
async function classList(file) {
    return (
        (await cached(lists, versionKey(file), () =>
            withZip(file, (directory) => new Set(directory.files.filter((e) => e.path.endsWith(".class")).map((e) => e.path.slice(0, -6))))
        )) ?? new Set()
    );
}

const details = new Map();

/* Each named class in a jar, read: Map(name -> parsed class, or null if it isn't there). */
async function classDetails(file, names) {
    const base = versionKey(file);
    const wanted = names.filter((name) => !details.has(`${base}#${name}`));
    if (wanted.length) {
        const read = withZip(file, async (directory) => {
            const byPath = new Map(directory.files.map((e) => [e.path, e]));
            const out = new Map();
            for (const name of wanted) {
                const entry = byPath.get(`${name}.class`);
                out.set(name, entry ? parseClass(await entry.buffer()) : null);
            }
            return out;
        }).catch(() => new Map());
        for (const name of wanted) details.set(`${base}#${name}`, read.then((out) => out.get(name) ?? null));
    }
    const out = new Map();
    for (const name of names) out.set(name, await details.get(`${base}#${name}`));
    return out;
}

/* ---------------- what an add-on's mixins rely on ---------------- */

const MIXIN = "Lorg/spongepowered/asm/mixin/Mixin;";
const SHADOW = "Lorg/spongepowered/asm/mixin/Shadow;";
const INJECT = "Lorg/spongepowered/asm/mixin/injection/Inject;";
const ACCESSOR = "Lorg/spongepowered/asm/mixin/gen/Accessor;";
const INVOKER = "Lorg/spongepowered/asm/mixin/gen/Invoker;";
const isInjector = (type) => type.startsWith("Lorg/spongepowered/asm/mixin/injection/") || type.startsWith("Lcom/llamalad7/mixinextras/injector/");

// Minecraft's, Java's and the loaders' own classes: an update of a mod never changes them.
const NOT_A_MOD = /^(net\/minecraft|com\/mojang|java|javax|jdk|sun|org\/lwjgl|org\/spongepowered|net\/fabricmc|org\/quiltmc|net\/neoforged|net\/minecraftforge|cpw\/mods|io\/netty|com\/google|org\/apache|it\/unimi|org\/slf4j|kotlin)\//;

const list = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);

/*
 * A mixin's way of naming a member: "name", "name(I)V", "Lowner;name(I)V", "name:I" (a
 * field). -> { owner, name, desc, field } or null for wildcards and other patterns.
 */
function parseMember(text) {
    let s = String(text ?? "").trim();
    if (!s || /[*{}@^$]|\s/.test(s.replace(/\$/g, "")) || s.includes("*")) return null;
    let owner = null;
    const withOwner = s.match(/^L([^;]+);(.*)$/);
    if (withOwner) [, owner, s] = withOwner;
    if (!s) return null;
    const field = s.match(/^([^:(]+):(.+)$/);
    if (field) return { owner, name: field[1], desc: field[2], field: true };
    const method = s.match(/^([^(]+)(\(.*)$/);
    if (method) return { owner, name: method[1], desc: method[2], field: false };
    return { owner, name: s, desc: null, field: false };
}

const lowerFirst = (text) => (text && text !== text.toUpperCase() ? text[0].toLowerCase() + text.slice(1) : text);

/* One mixin class's demands on other mods' code. */
function refsOf(parsed, mixinName, defaultRequire) {
    const mixin = parsed.annotations.find((a) => a.type === MIXIN);
    if (!mixin) return [];
    const targets = [
        ...list(mixin.values.value).map((v) => v?.class?.replace(/^L|;$/g, "")),
        ...list(mixin.values.targets).map((t) => String(t).replace(/\./g, "/")),
    ].filter((t) => t && !NOT_A_MOD.test(t));
    if (!targets.length) return [];

    const refs = targets.map((cls) => ({ cls, kind: "class", mixin: mixinName, require: 1 }));
    const add = (member, kind, require) => {
        if (!member) return;
        for (const cls of member.owner ? [member.owner] : targets) {
            if (!NOT_A_MOD.test(cls)) refs.push({ cls, kind, name: member.name, desc: member.desc, field: member.field, require, mixin: mixinName });
        }
    };

    for (const [members, isField] of [[parsed.fields, true], [parsed.methods, false]]) {
        for (const member of members) {
            for (const annotation of member.annotations) {
                if (annotation.type === SHADOW) {
                    const prefix = annotation.values.prefix ?? "shadow$";
                    const name = member.name.startsWith(prefix) ? member.name.slice(prefix.length) : member.name;
                    add({ owner: null, name, desc: member.desc, field: isField }, "shadow", 1);
                } else if (annotation.type === ACCESSOR || annotation.type === INVOKER) {
                    const accessor = annotation.type === ACCESSOR;
                    const derived = lowerFirst(member.name.replace(accessor ? /^(get|is|set)/ : /^(call|invoke|new|create)/, ""));
                    add({ owner: null, name: annotation.values.value || derived, desc: accessor ? null : member.desc, field: accessor }, accessor ? "accessor" : "invoker", 1);
                } else if (isInjector(annotation.type)) {
                    const require = typeof annotation.values.require === "number" ? annotation.values.require : defaultRequire;
                    const kind = annotation.type === INJECT ? "inject" : "injector";
                    for (const method of list(annotation.values.method)) {
                        const parsedMember = parseMember(method);
                        if (parsedMember && !parsedMember.field) add(parsedMember, kind, require);
                    }
                    for (const at of list(annotation.values.at)) {
                        const target = parseMember(at?.values?.target);
                        if (target?.owner && target.name) add(target, "at", require);
                    }
                }
            }
        }
    }
    return refs;
}

const mixinCache = new Map();

/* Everything a mod's mixins rely on in other mods' code: [{ cls, kind, name, desc, field, require, mixin }]. */
async function mixinRefs(file) {
    return (
        (await cached(mixinCache, versionKey(file), async () => {
            const info = await modInfo(file);
            if (!info?.mixinConfigs?.length) return [];
            return withZip(file, async (directory) => {
                const byPath = new Map(directory.files.map((e) => [e.path, e]));
                const refs = [];
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
                    const defaultRequire = Number(json.injectors?.defaultRequire ?? 0) || 0;
                    for (const name of [...list(json.mixins), ...list(json.client), ...list(json.server)]) {
                        const className = `${pkg ? `${pkg}/` : ""}${String(name).replace(/\./g, "/")}`;
                        const classEntry = byPath.get(`${className}.class`);
                        if (!classEntry) continue;
                        const parsed = parseClass(await classEntry.buffer());
                        if (parsed) refs.push(...refsOf(parsed, className, defaultRequire));
                    }
                }
                return refs;
            });
        })) ?? []
    );
}

/* ---------------- the check ---------------- */

/* "found", "changed" (there, with other arguments), "missing", or "no-class". */
function lookup(classes, ref) {
    const cls = classes.get(ref.cls);
    if (!cls) return "no-class";
    if (ref.kind === "class") return "found";
    const members = (ref.field ? cls.fields : cls.methods).filter((m) => m.name === ref.name);
    if (!members.length) return "missing";
    if (ref.desc && !members.some((m) => m.desc === ref.desc)) return "changed";
    return "found";
}

/* Whether the new version breaks something the add-on relied on in the old one. */
function breaksBetween(oldClasses, newClasses, ref) {
    if (lookup(oldClasses, ref) !== "found") return false; // It didn't rely on it there either.
    const now = lookup(newClasses, ref);
    if (now === "found") {
        // An @Inject by name only takes the method's arguments, so those must stay the same.
        if (ref.kind !== "inject" || ref.desc) return false;
        const before = new Set(oldClasses.get(ref.cls).methods.filter((m) => m.name === ref.name).map((m) => m.desc));
        const after = new Set(newClasses.get(ref.cls).methods.filter((m) => m.name === ref.name).map((m) => m.desc));
        return [...before].some((desc) => !after.has(desc));
    }
    if (ref.kind === "class" || ref.kind === "shadow" || ref.kind === "accessor" || ref.kind === "invoker") return true;
    return ref.require > 0;
}

/* Whether an add-on (a new version of it) relies on something the mod doesn't have. */
function missingIn(classes, ref) {
    if (ref.kind === "at") return false; // Calls name the class they're made on, which may only inherit the member.
    const found = lookup(classes, ref);
    if (found === "found") return false;
    if (ref.kind === "class" || ref.kind === "shadow" || ref.kind === "accessor" || ref.kind === "invoker") return true;
    return found === "changed" ? ref.kind === "inject" || ref.require > 0 : ref.require > 0;
}

const simpleName = (cls) => cls.split("/").pop().replace(/\$/g, ".");
const where = (ref) => (ref.kind === "class" ? simpleName(ref.cls) : `${simpleName(ref.cls)}.${ref.name}`);
const places = (refs) => {
    const names = [...new Set(refs.map(where))];
    return names.slice(0, 2).join(", ") + (names.length > 2 ? ` and ${names.length - 2} more` : "");
};

/*
 * Problems from add-ons in a set of mods. mods: [{ fileName, file, name, version, enabled,
 * changed, replaces }] where changed marks new files and replaces is the path of the file a
 * new one replaces. Each problem is on a new file, so leaving that out solves it.
 * -> [{ fileName, name, text }]
 */
async function addonProblems(mods) {
    const enabled = mods.filter((mod) => mod.enabled && mod.file);
    if (!enabled.some((mod) => mod.changed)) return [];

    const problems = [];
    const newLists = new Map();
    for (const mod of enabled) newLists.set(mod, await classList(mod.file));

    for (const addon of enabled) {
        const refs = await mixinRefs(addon.file);
        if (!refs.length) continue;
        for (const mod of enabled) {
            if (mod === addon || !(addon.changed || mod.changed)) continue;
            const oldList = mod.changed && mod.replaces ? await classList(mod.replaces) : null;
            const newList = newLists.get(mod);
            const mine = refs.filter((ref) => newList.has(ref.cls) || oldList?.has(ref.cls));
            if (!mine.length) continue;
            const classes = [...new Set(mine.map((ref) => ref.cls))];
            const newClasses = await classDetails(mod.file, classes);

            if (addon.changed) {
                // The add-on's new version, against the version of the mod it would run with.
                const broken = mine.filter((ref) => missingIn(newClasses, ref));
                if (broken.length) {
                    problems.push({
                        fileName: addon.fileName,
                        name: addon.name,
                        text: `doesn't fit ${mod.name}${mod.version ? ` ${mod.version}` : ""}: it changes code there that version doesn't have (${places(broken)})`,
                    });
                }
            } else if (mod.replaces) {
                // The add-on as it is, against what the mod's update changes.
                const oldClasses = await classDetails(mod.replaces, classes);
                const broken = mine.filter((ref) => breaksBetween(oldClasses, newClasses, ref));
                if (broken.length) {
                    problems.push({
                        fileName: mod.fileName,
                        name: mod.name,
                        text: `would break ${addon.name}, which changes ${mod.name}'s code in places this version changes (${places(broken)})`,
                    });
                }
            }
        }
    }
    return problems;
}

module.exports = { addonProblems, mixinRefs, parseClass };
