const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { dataDir } = require("./storage.cjs");
const plugins = require("./plugins.cjs");

/*
 * Sorting Skyrim's and Fallout 4's load order by LOOT's community masterlist (CC0, from
 * github.com/loot): its groups ("Fixes", "New Content", "Late Loaders"…) and its rules for
 * which plugins load after which. The order the game needs (masters first, each plugin
 * after the ones it needs) always comes first, then LOOT's rules, then its groups;
 * otherwise plugins keep the order they're in. LOOT itself also looks at which plugins
 * change the same records, which needs every record read; this doesn't.
 */

const REPOS = { skyrimse: "skyrimse", fallout4: "fallout4" };
const BRANCH = "v0.29";
const DAY = 24 * 60 * 60 * 1000;

/* ---------------- the masterlist ---------------- */

const parsed = new Map();

/* LOOT's masterlist for a game, downloaded at most once a day: { groups, entries, fetchedAt }. */
async function masterlist(gameId) {
    const repo = REPOS[gameId];
    if (!repo) throw new Error("LOOT has no masterlist for this game.");
    const dir = path.join(dataDir(), "loot");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${gameId}.yaml`);
    const metaFile = path.join(dir, `${gameId}.json`);
    let meta = {};
    try {
        meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    } catch {
        meta = {};
    }
    if (!fs.existsSync(file) || Date.now() - (meta.at ?? 0) > DAY) {
        try {
            const res = await fetch(`https://raw.githubusercontent.com/loot/${repo}/${BRANCH}/masterlist.yaml`, {
                headers: { "User-Agent": "UnityLauncher/1.0", ...(meta.etag && fs.existsSync(file) ? { "If-None-Match": meta.etag } : {}) },
                signal: AbortSignal.timeout(30000),
            });
            if (res.status === 200) {
                fs.writeFileSync(file, await res.text());
                meta = { at: Date.now(), etag: res.headers.get("etag") };
            } else if (res.status === 304) {
                meta = { ...meta, at: Date.now() };
            } else if (!fs.existsSync(file)) {
                throw new Error(`GitHub answered ${res.status}.`);
            }
            fs.writeFileSync(metaFile, JSON.stringify(meta));
        } catch (err) {
            if (!fs.existsSync(file)) throw new Error(`LOOT's masterlist couldn't be downloaded: ${err.message}`);
        }
    }
    const mtime = fs.statSync(file).mtimeMs;
    const cached = parsed.get(gameId);
    if (cached?.mtime === mtime) return cached.list;
    const doc = yaml.load(fs.readFileSync(file, "utf8"));
    const list = { groups: doc.groups ?? [], entries: (doc.plugins ?? []).filter((p) => p?.name), fetchedAt: meta.at ?? mtime };
    parsed.set(gameId, { mtime, list });
    return list;
}

/* ---------------- LOOT's names and conditions ---------------- */

// A name with any of :\*?| in it is a regular expression (LOOT's rule).
const isPattern = (name) => /[:\\*?|]/.test(name);
const patternOf = (name) => {
    try {
        return new RegExp(`^${name}$`, "i");
    } catch {
        return null;
    }
};

const nameOf = (item) => (typeof item === "string" ? item : item?.name);

/*
 * LOOT's conditions, as far as they can be told from the plugins: active(), is_master()
 * and file() with and, or, not and brackets. Anything else (versions, checksums…) is
 * unknown, and a rule whose condition is unknown isn't used. -> true, false or null.
 */
function evaluate(condition, ctx) {
    const tokens = [];
    const re = /\s*(\(|\)|,|"(?:[^"\\]|\\.)*"|[A-Za-z_]+)/y;
    let match;
    let at = 0;
    while (at < condition.length && (match = re.exec(condition))) {
        tokens.push(match[1]);
        at = re.lastIndex;
    }
    if (condition.slice(at).trim()) return null;
    let i = 0;
    const peek = () => tokens[i];
    const take = () => tokens[i++];
    const and3 = (a, b) => (a === false || b === false ? false : a === null || b === null ? null : true);
    const or3 = (a, b) => (a === true || b === true ? true : a === null || b === null ? null : false);
    const call = (fn, args) => {
        const arg = args[0] ?? "";
        const test = (names) => (isPattern(arg) ? [...names].some((n) => patternOf(arg)?.test(n)) : names.has(arg.toLowerCase()));
        if (fn === "active") return test(ctx.active);
        if (fn === "is_master") return isPattern(arg) ? null : ctx.masters.has(arg.toLowerCase());
        if (fn === "file") {
            if (isPattern(arg)) return /^[^/\\]*$/.test(arg) ? test(ctx.present) : null;
            return /\.(esp|esm|esl)$/i.test(arg) && !/[/\\]/.test(arg) ? ctx.present.has(arg.toLowerCase()) : fs.existsSync(path.join(ctx.data, arg));
        }
        return null;
    };
    const factor = () => {
        const token = take();
        if (token === "not") {
            const value = factor();
            return value === null ? null : !value;
        }
        if (token === "(") {
            const value = expr();
            if (take() !== ")") throw new Error("bracket");
            return value;
        }
        if (/^[A-Za-z_]+$/.test(token ?? "") && peek() === "(") {
            take();
            const args = [];
            while (peek() && peek() !== ")") {
                const arg = take();
                if (arg !== ",") args.push(arg.startsWith('"') ? JSON.parse(arg) : arg);
            }
            take();
            return call(token, args);
        }
        throw new Error("token");
    };
    const term = () => {
        let value = factor();
        while (peek() === "and") {
            take();
            value = and3(value, factor());
        }
        return value;
    };
    const expr = () => {
        let value = term();
        while (peek() === "or") {
            take();
            value = or3(value, term());
        }
        return value;
    };
    try {
        const value = expr();
        return i === tokens.length ? value : null;
    } catch {
        return null;
    }
}

/* ---------------- sorting ---------------- */

/* Which of the given items stay put: the longest run already in order (the rest moved). */
function keptInPlace(sequence) {
    const tails = [];
    const tailAt = [];
    const previous = new Array(sequence.length).fill(-1);
    sequence.forEach((value, index) => {
        let lo = 0;
        let hi = tails.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (tails[mid] < value) lo = mid + 1;
            else hi = mid;
        }
        tails[lo] = value;
        tailAt[lo] = index;
        previous[index] = lo > 0 ? tailAt[lo - 1] : -1;
    });
    const kept = new Set();
    for (let index = tailAt[tails.length - 1] ?? -1; index >= 0; index = previous[index]) kept.add(index);
    return kept;
}

/*
 * The order LOOT's rules give, and what moves:
 * { order: [{ name, active }], moved: [{ name, group, after }], fetchedAt, loops }
 */
async function plan(game, loc) {
    const list = await masterlist(game.id);
    const { plugins: current } = plugins.loadOrder(game, loc);
    const data = path.join(loc.gameDir, "Data");
    const lower = (name) => name.toLowerCase();
    const byLower = new Map(current.map((p) => [lower(p.name), p]));

    const exact = new Map();
    const patterns = [];
    for (const entry of list.entries) {
        if (entry.name.includes("{0}")) continue;
        if (isPattern(entry.name)) {
            const pattern = patternOf(entry.name);
            if (pattern) patterns.push({ pattern, entry });
        } else {
            exact.set(lower(entry.name), [...(exact.get(lower(entry.name)) ?? []), entry]);
        }
    }
    const entriesFor = (name) => [...(exact.get(lower(name)) ?? []), ...patterns.filter((p) => p.pattern.test(name)).map((p) => p.entry)];

    const ctx = {
        data,
        active: new Set(current.filter((p) => p.active).map((p) => lower(p.name))),
        present: new Set(current.map((p) => lower(p.name))),
        masters: new Set(current.filter((p) => p.master).map((p) => lower(p.name))),
    };
    for (const name of game.bethesda.official) {
        ctx.active.add(name);
        ctx.present.add(name);
        ctx.masters.add(name);
    }

    // Groups: how far down LOOT's list of groups each is.
    const groupAfter = new Map(list.groups.map((g) => [g.name, (g.after ?? []).map(nameOf).filter(Boolean)]));
    const rank = new Map();
    const rankOf = (name, seen = new Set()) => {
        if (rank.has(name)) return rank.get(name);
        if (seen.has(name)) return 0;
        seen.add(name);
        const value = Math.max(-1, ...(groupAfter.get(name) ?? []).map((g) => rankOf(g, seen))) + 1;
        rank.set(name, value);
        return value;
    };
    const groupOf = (plugin) => entriesFor(plugin.name).find((e) => e.group)?.group ?? "default";
    // A group the list doesn't have counts as LOOT's default one.
    const groupRank = (plugin) => rankOf(groupAfter.has(groupOf(plugin)) ? groupOf(plugin) : "default");

    // Where each starts: in LOOT's groups, otherwise as they are.
    const start = current.map((plugin, index) => ({ plugin, index, rank: groupRank(plugin) })).sort((a, b) => a.rank - b.rank || a.index - b.index);
    const priority = new Map(start.map((item, i) => [lower(item.plugin.name), i]));

    // What must load before each: the game's needs, then LOOT's rules.
    const before = new Map(current.map((p) => [lower(p.name), new Set()]));
    const why = new Map(current.map((p) => [lower(p.name), []]));
    const need = (first, then, reason) => {
        const a = lower(first);
        const b = lower(then);
        if (a === b || !byLower.has(a) || !byLower.has(b)) return;
        // Masters load before the rest whatever's asked, so a rule against that can't apply.
        if (byLower.get(b).master && !byLower.get(a).master) return;
        before.get(b).add(a);
        if (reason) why.get(b).push(byLower.get(a).name);
    };
    for (const plugin of current) {
        if (!plugin.master) for (const other of current) if (other.master) need(other.name, plugin.name);
        for (const master of plugin.masters) need(master, plugin.name);
        for (const entry of entriesFor(plugin.name)) {
            for (const rule of [...(entry.after ?? []), ...(entry.req ?? [])]) {
                const name = nameOf(rule);
                if (!name) continue;
                if (typeof rule === "object" && rule.condition && evaluate(rule.condition, ctx) !== true) continue;
                if (isPattern(name)) {
                    const pattern = patternOf(name);
                    for (const other of current) if (pattern?.test(other.name)) need(other.name, plugin.name, true);
                } else need(name, plugin.name, true);
            }
        }
    }

    // In order: whatever can go next, earliest first; a loop in the rules is broken at its earliest plugin.
    const placed = new Set();
    const order = [];
    const loops = [];
    while (order.length < current.length) {
        const ready = current.filter((p) => !placed.has(lower(p.name)) && [...before.get(lower(p.name))].every((a) => placed.has(a)));
        const pool = ready.length ? ready : current.filter((p) => !placed.has(lower(p.name)));
        const next = pool.reduce((best, p) => (priority.get(lower(p.name)) < priority.get(lower(best.name)) ? p : best));
        if (!ready.length) loops.push(next.name);
        placed.add(lower(next.name));
        order.push(next);
    }

    const oldIndex = new Map(current.map((p, i) => [lower(p.name), i]));
    const kept = keptInPlace(order.map((p) => oldIndex.get(lower(p.name))));
    const moved = order
        .filter((_p, i) => !kept.has(i))
        .map((p) => ({ name: p.name, group: groupOf(p), after: [...new Set(why.get(lower(p.name)))].slice(0, 4) }));
    return { order: order.map((p) => ({ name: p.name, active: p.active })), moved, fetchedAt: list.fetchedAt, loops };
}

module.exports = { plan, masterlist, evaluate };
