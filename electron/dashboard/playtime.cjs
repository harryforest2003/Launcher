const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/*
 * Play time, from what is really on disk. Everything here only reads.
 *
 *   - Minecraft's own logs: every launch writes logs/latest.log, and the next launch (or
 *     midnight) packs it away as logs/YYYY-MM-DD-n.log.gz. A log's first and last
 *     timestamps are when the game was open, and the file name says which day.
 *   - Sessions this launcher recorded itself (sessions.cjs), from start to exit.
 *   - Each world's statistics: saves/<world>/stats/<player>.json (players/stats/ from 26.1),
 *     "minecraft:play_time" in ticks (20 a second). Real, but undated, and only for
 *     single-player worlds.
 *
 * Logs and recorded sessions describe the same thing (the game being open), so they are
 * merged by time: a session seen in both is counted once. World statistics can't be
 * dated and may include play from before a world came into this launcher (an imported
 * world), so they are reported on their own and never added to session time or the chart.
 */

const DAY_MS = 86_400_000;
const DAILY_DAYS = 90;
// Shorter than this, the game never got going (it crashed while starting, say).
const MIN_SESSION_MS = 60_000;
// A log that runs past midnight is split there; the second half continues the session.
const CONTINUE_GAP_MS = 5 * 60_000;
// A "session" longer than this means a clock or a log is wrong; it's left out.
const MAX_SESSION_MS = 7 * DAY_MS;
// Larger statistics files than this aren't a real statistics file.
const MAX_STATS_BYTES = 8 * 1024 * 1024;

const DATED_LOG = /^(\d{4})-(\d{2})-(\d{2})-(\d+)\.log(\.gz)?$/;
// [14:57:03] as vanilla, Fabric and Quilt write it.
const TIME_ONLY = /^\[(\d{2}):(\d{2}):(\d{2})(?:[.,]\d{1,3})?\]/;
// [13Nov2026 01:51:47.360] as Forge and NeoForge write it.
const FULL_DATE = /^\[(\d{2})([A-Za-z]{3})(\d{4}) (\d{2}):(\d{2}):(\d{2})(?:[.,]\d{1,3})?\]/;
// The first lines a fresh start of the game writes (not a log continued after midnight).
const STARTUP = /Loading Minecraft|Setting user:|ModLauncher running|Launching target|Backend library:|Launching wrapped minecraft|Starting Minecraft/;
const STARTUP_LINES = 300;
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/* ---------------- dates ---------------- */

const pad = (n) => String(n).padStart(2, "0");

/* YYYY-MM-DD of a time, on this computer's calendar. */
function localDay(time) {
    const d = new Date(time);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* A local time from a calendar day plus seconds into it (daylight saving handled by Date). */
function localTime(year, month, day, seconds) {
    return new Date(year, month, day, Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60).getTime();
}

/* ---------------- reading one log ---------------- */

const newScan = () => ({ first: null, last: null, prev: null, days: 0, absFirst: null, absLast: null, startup: false, lines: 0 });

/* Takes one line's timestamp into the scan. Only timestamps are kept: never what was said. */
function scanLine(scan, line) {
    scan.lines++;
    if (line.charCodeAt(0) !== 91) return; // "["
    if (!scan.startup && scan.lines <= STARTUP_LINES && STARTUP.test(line)) scan.startup = true;

    const full = FULL_DATE.exec(line);
    if (full) {
        const month = MONTHS[full[2].toLowerCase()];
        if (month === undefined) return;
        const time = new Date(+full[3], month, +full[1], +full[4], +full[5], +full[6]).getTime();
        if (!Number.isFinite(time)) return;
        if (scan.absFirst === null) scan.absFirst = time;
        if (scan.absLast === null || time > scan.absLast) scan.absLast = time;
        return;
    }

    const short = TIME_ONLY.exec(line);
    if (!short) return;
    const seconds = +short[1] * 3600 + +short[2] * 60 + +short[3];
    if (seconds >= 86_400) return;
    if (scan.first === null) scan.first = seconds;
    // Going back more than six hours is midnight passing, not threads writing out of order.
    else if (seconds < scan.prev - 6 * 3600) scan.days++;
    scan.prev = seconds;
    const at = scan.days * 86_400 + seconds;
    if (scan.last === null || at > scan.last) scan.last = at;
}

/*
 * Feeds a stream's lines to scan. Latin-1 decoding never fails and keeps the ASCII
 * timestamps intact, whatever else the log holds. -> bytes not yet ending in a newline.
 */
function scanStream(stream, scan) {
    return new Promise((resolve, reject) => {
        let carry = "";
        stream.on("data", (chunk) => {
            const text = carry + chunk.toString("latin1");
            let start = 0;
            let end;
            while ((end = text.indexOf("\n", start)) !== -1) {
                scanLine(scan, text.slice(start, end));
                start = end + 1;
            }
            carry = text.slice(start);
            // A single "line" this long is not a log line; drop it rather than grow forever.
            if (carry.length > 1_000_000) carry = "";
        });
        stream.on("error", reject);
        stream.on("end", () => resolve(carry));
    });
}

async function scanWholeFile(file, gzip) {
    const scan = newScan();
    const input = fs.createReadStream(file);
    let carry;
    try {
        if (gzip) {
            const gunzip = zlib.createGunzip();
            input.on("error", (err) => gunzip.destroy(err));
            carry = await scanStream(input.pipe(gunzip), scan);
        } else {
            carry = await scanStream(input, scan);
        }
    } finally {
        input.destroy();
    }
    if (carry) scanLine(scan, carry);
    return scan;
}

/*
 * latest.log grows while the game runs: when its start is unchanged, only what was added
 * since last time is read.
 */
async function scanLatest(file, stat, cached) {
    const head = await readHead(file, 256);
    const canContinue = cached && cached.head === head && stat.size >= cached.offset && cached.scan;
    const scan = canContinue ? { ...cached.scan } : newScan();
    const from = canContinue ? cached.offset : 0;

    let carry = "";
    if (stat.size > from) {
        const input = fs.createReadStream(file, { start: from, end: stat.size - 1 });
        try {
            carry = await scanStream(input, scan);
        } finally {
            input.destroy();
        }
    }
    // The unfinished last line is read again next time, whole.
    const offset = stat.size - Buffer.byteLength(carry, "latin1");
    const finished = { ...scan };
    if (carry) scanLine(finished, carry);
    return { scan: finished, entry: { head, offset, scan } };
}

async function readHead(file, bytes) {
    const handle = await fs.promises.open(file, "r");
    try {
        const buffer = Buffer.alloc(bytes);
        const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
        return buffer.subarray(0, bytesRead).toString("base64");
    } finally {
        await handle.close();
    }
}

/*
 * When a scanned log's game was open: { start, end, startup } in ms, or null.
 * endDay is the calendar day the log was last written: the date in an old log's name,
 * the file's own time for latest.log.
 */
function logSession(scan, { endDay, modifiedMs }) {
    if (scan.absFirst !== null && scan.absLast !== null) {
        return { start: scan.absFirst, end: scan.absLast, startup: scan.startup };
    }
    if (scan.first === null || scan.last === null) return null;

    const lastSeconds = scan.last - scan.days * 86_400;
    let [year, month, day] = endDay;
    let end = localTime(year, month, day, lastSeconds);
    // A last line written just before midnight and saved just after belongs to the day before.
    if (modifiedMs !== undefined && end > modifiedMs + 120_000) {
        const before = new Date(year, month, day - 1);
        [year, month, day] = [before.getFullYear(), before.getMonth(), before.getDate()];
        end = localTime(year, month, day, lastSeconds);
    }
    const start = localTime(year, month, day - scan.days, scan.first);
    if (!(end >= start) || end - start > MAX_SESSION_MS) return null;
    return { start, end, startup: scan.startup };
}

/*
 * Every log of one game folder as sessions, reusing what the cache already knows.
 * cache: { [file]: { size, mtimeMs, ... } }, updated in place.
 */
async function logSessions(gameDir, cache) {
    const dir = path.join(gameDir, "logs");
    let names;
    try {
        names = await fs.promises.readdir(dir);
    } catch {
        return { found: false, sessions: [] };
    }

    const sessions = [];
    let found = false;

    for (const name of names) {
        const dated = DATED_LOG.exec(name);
        if (!dated && name !== "latest.log") continue;
        const file = path.join(dir, name);

        let stat;
        try {
            stat = await fs.promises.stat(file);
            if (!stat.isFile()) continue;
        } catch {
            continue;
        }
        found = true;

        const known = cache[file];
        const unchanged = known && known.size === stat.size && known.mtimeMs === stat.mtimeMs;
        let scan;
        try {
            if (unchanged) {
                scan = known.result;
            } else if (dated) {
                scan = await scanWholeFile(file, Boolean(dated[5]));
                cache[file] = { size: stat.size, mtimeMs: stat.mtimeMs, result: scan };
            } else {
                const latest = await scanLatest(file, stat, known);
                scan = latest.scan;
                cache[file] = { size: stat.size, mtimeMs: stat.mtimeMs, result: scan, ...latest.entry };
            }
        } catch {
            // A damaged archive: remembered as unreadable until it changes.
            cache[file] = { size: stat.size, mtimeMs: stat.mtimeMs, result: null };
            continue;
        }
        if (!scan) continue;

        const endDay = dated
            ? [+dated[1], +dated[2] - 1, +dated[3]]
            : (() => {
                const d = new Date(stat.mtimeMs);
                return [d.getFullYear(), d.getMonth(), d.getDate()];
            })();
        const session = logSession(scan, { endDay, modifiedMs: dated ? undefined : stat.mtimeMs });
        if (session) sessions.push({ ...session, file });
    }

    return { found, sessions };
}

/* ---------------- world statistics ---------------- */

/* Ticks played from a statistics file, in any of the formats Minecraft has used. */
function playTicks(json) {
    const stats = json?.stats;
    const custom = stats?.["minecraft:custom"];
    const ticks =
        custom?.["minecraft:play_time"] ?? // 1.17 and later
        custom?.["minecraft:play_one_minute"] ?? // 1.13 to 1.16 (ticks, despite the name)
        json?.["stat.playOneMinute"]; // before 1.13
    return Number.isFinite(ticks) && ticks > 0 ? ticks : 0;
}

/*
 * This game folder's single-player worlds: { worlds, seconds }, seconds being the play
 * time their statistics hold, or null when no world has statistics. Per world, the player
 * who played most counts (anyone else in a LAN world isn't this player). A world's time
 * includes play from before it came into this launcher, so it is kept apart from sessions.
 */
async function worldPlaySeconds(gameDir, cache) {
    const saves = path.join(gameDir, "saves");
    let entries;
    try {
        entries = await fs.promises.readdir(saves, { withFileTypes: true });
    } catch {
        return { worlds: 0, seconds: null };
    }

    let ticks = 0;
    let any = false;
    let worlds = 0;
    for (const world of entries) {
        if (!world.isDirectory()) continue;
        if (fs.existsSync(path.join(saves, world.name, "level.dat"))) worlds++;
        let best = 0;
        for (const sub of ["stats", path.join("players", "stats")]) {
            const dir = path.join(saves, world.name, sub);
            let files;
            try {
                files = await fs.promises.readdir(dir);
            } catch {
                continue;
            }
            for (const name of files) {
                if (!name.endsWith(".json")) continue;
                const file = path.join(dir, name);
                try {
                    const stat = await fs.promises.stat(file);
                    if (!stat.isFile() || stat.size > MAX_STATS_BYTES) continue;
                    const known = cache[file];
                    let value;
                    if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) {
                        value = known.ticks;
                    } else {
                        value = playTicks(JSON.parse(await fs.promises.readFile(file, "utf8")));
                        cache[file] = { size: stat.size, mtimeMs: stat.mtimeMs, ticks: value };
                    }
                    any = true;
                    best = Math.max(best, value);
                } catch {
                    // Not a statistics file we can read.
                }
            }
        }
        ticks += best;
    }
    return { worlds, seconds: any ? Math.round(ticks / 20) : null };
}

/* ---------------- putting sessions together ---------------- */

/*
 * One list of sessions from logs and recorded sessions: overlapping ones become one, a
 * log continued after midnight joins the one before it, and starts that never got going
 * are dropped.
 */
function mergeSessions(intervals) {
    const sorted = intervals
        .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start)
        .sort((a, b) => a.start - b.start);

    const merged = [];
    for (const next of sorted) {
        const current = merged[merged.length - 1];
        const overlaps = current && next.start <= current.end;
        const continues =
            current &&
            !next.startup &&
            next.start - current.end <= CONTINUE_GAP_MS &&
            localDay(next.start) !== localDay(current.end);
        if (overlaps || continues) {
            current.end = Math.max(current.end, next.end);
            current.tracked = current.tracked || Boolean(next.tracked);
            current.logged = current.logged || Boolean(next.logged);
        } else {
            merged.push({ start: next.start, end: next.end, tracked: Boolean(next.tracked), logged: Boolean(next.logged) });
        }
    }
    return merged.filter((s) => s.end - s.start >= MIN_SESSION_MS);
}

/* Seconds of each session on each local calendar day: { "YYYY-MM-DD": seconds }. */
function secondsByDay(sessions) {
    const days = {};
    for (const { start, end } of sessions) {
        let from = start;
        while (from < end) {
            const d = new Date(from);
            const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
            const until = Math.min(end, nextMidnight);
            const key = localDay(from);
            days[key] = (days[key] ?? 0) + (until - from) / 1000;
            from = until;
        }
    }
    return days;
}

/* The last 90 local days, oldest first, with every day present. */
function lastDays(now = Date.now(), count = DAILY_DAYS) {
    const today = new Date(now);
    const days = [];
    for (let i = count - 1; i >= 0; i--) {
        days.push(localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i).getTime()));
    }
    return days;
}

/* ---------------- instances ---------------- */

/*
 * The instances in a folder, read the way instanceManager reads them (a folder with an
 * instance.json; its folder name is its name everywhere in the app), without creating
 * or changing anything.
 */
async function listInstances(instancesDir) {
    let entries;
    try {
        entries = await fs.promises.readdir(instancesDir, { withFileTypes: true });
    } catch {
        return [];
    }

    const instances = [];
    for (const entry of entries) {
        if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
        const folder = path.join(instancesDir, entry.name);
        const file = path.join(folder, "instance.json");
        try {
            const [text, stat] = await Promise.all([fs.promises.readFile(file, "utf8"), fs.promises.stat(file)]);
            const json = JSON.parse(text);
            if (!json || typeof json !== "object") continue;
            const own = typeof json.gameDirectory === "string" && path.isAbsolute(json.gameDirectory) ? json.gameDirectory : null;
            instances.push({ name: entry.name, folder, gameDir: own ?? path.join(folder, ".minecraft"), json, jsonModifiedMs: stat.mtimeMs });
        } catch {
            // No instance here, or one whose instance.json can't be read.
        }
    }
    return instances;
}

/* Mods in an instance's mods folder, turned on or off. */
async function countMods(gameDir) {
    try {
        const files = await fs.promises.readdir(path.join(gameDir, "mods"));
        return files.filter((name) => /\.jar(\.disabled)?$/i.test(name)).length;
    } catch {
        return 0;
    }
}

module.exports = {
    DAILY_DAYS,
    localDay,
    lastDays,
    logSessions,
    worldPlaySeconds,
    mergeSessions,
    secondsByDay,
    listInstances,
    countMods,
    // For tests.
    _internal: { scanLine, newScan, logSession, playTicks },
};
