const fs = require("fs");

const store = require("./store.cjs");
const recorded = require("./sessions.cjs");
const {
    localDay,
    lastDays,
    logSessions,
    worldPlaySeconds,
    mergeSessions,
    secondsByDay,
    listInstances,
    countMods,
} = require("./playtime.cjs");

/*
 * The numbers on the Home dashboard, built from each instance's files and the sessions
 * the launcher recorded (see playtime.cjs for how they combine). Nothing is estimated:
 * playSeconds is session time only (logs and recorded sessions, null when neither
 * exists); worldPlaySeconds is what the worlds' own statistics say, kept separate
 * because it can include play from before a world came into this launcher.
 */

const CACHE_FILE = "scan-cache.json";
const CACHE_VERSION = 1;

function readCache() {
    const cache = store.readJson(CACHE_FILE, null);
    if (!cache || cache.version !== CACHE_VERSION || typeof cache.logs !== "object" || typeof cache.worlds !== "object") {
        return { version: CACHE_VERSION, logs: {}, worlds: {} };
    }
    return cache;
}

/* Forgets files that are gone, so the cache doesn't grow forever. */
function pruneCache(cache) {
    for (const part of [cache.logs, cache.worlds]) {
        for (const file of Object.keys(part)) {
            if (!fs.existsSync(file)) delete part[file];
        }
    }
}

const isoOrUndefined = (value) => {
    const time = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
};

/*
 * Scans every instance. -> { stats, details }, where details holds each instance's merged
 * sessions and recorded exits for the activity feed.
 *   instancesDir  the instances folder (read only)
 *   isRunning     (name) => whether the launcher has that instance's game open now
 */
async function collect({ instancesDir, isRunning = () => false, now = Date.now() }) {
    const cache = readCache();
    const instances = await listInstances(instancesDir);
    const tracked = recorded.list();

    const dayKeys = lastDays(now);
    const daily = new Map(dayKeys.map((date) => [date, { date, seconds: 0, byInstance: {} }]));
    const sources = { tracked: false, logs: false, worldStats: false };
    let earliest = Infinity;

    const stats = [];
    const details = [];

    for (const instance of instances) {
        const { found: hasLogs, sessions: logged } = await logSessions(instance.gameDir, cache.logs);
        const world = await worldPlaySeconds(instance.gameDir, cache.worlds);

        // Recorded sessions; only the newest can still be open, and only while its game runs.
        const own = tracked.filter((s) => s.instance === instance.name);
        const newest = own[own.length - 1];
        const fromLauncher = own
            .map((s) => ({
                start: s.start,
                end: s.end ?? (s === newest && isRunning(instance.name) ? now : NaN),
                startup: true,
                tracked: true,
            }))
            .filter((s) => Number.isFinite(s.end));

        const merged = mergeSessions([...logged.map((s) => ({ ...s, logged: true })), ...fromLauncher]);
        const sessionSeconds = merged.reduce((sum, s) => sum + (s.end - s.start) / 1000, 0);
        // Known when it has logs or recorded sessions, even if none lasted long enough to count.
        const playSeconds = hasLogs || fromLauncher.length > 0 ? Math.round(sessionSeconds) : null;
        if (merged.some((s) => s.tracked)) sources.tracked = true;
        if (merged.some((s) => s.logged)) sources.logs = true;
        if (world.seconds !== null) sources.worldStats = true;

        for (const [date, seconds] of Object.entries(secondsByDay(merged))) {
            const day = daily.get(date);
            if (!day) continue;
            day.byInstance[instance.name] = (day.byInstance[instance.name] ?? 0) + seconds;
        }
        if (merged.length) earliest = Math.min(earliest, merged[0].start);

        const lastSession = merged.length ? merged[merged.length - 1].end : null;
        const savedLastPlayed = isoOrUndefined(instance.json.lastPlayed);
        const lastPlayed =
            lastSession !== null && (!savedLastPlayed || lastSession > Date.parse(savedLastPlayed))
                ? new Date(lastSession).toISOString()
                : savedLastPlayed;

        stats.push({
            name: instance.name,
            version: String(instance.json.version ?? ""),
            loader: String(instance.json.loader || "vanilla").toLowerCase(),
            ...(instance.json.loaderVersion ? { loaderVersion: String(instance.json.loaderVersion) } : {}),
            modCount: await countMods(instance.gameDir),
            ...(isoOrUndefined(instance.json.created) ? { created: isoOrUndefined(instance.json.created) } : {}),
            ...(lastPlayed ? { lastPlayed } : {}),
            playSeconds,
            sessions: merged.length,
            ...(merged.length ? { since: localDay(merged[0].start) } : {}),
            worldPlaySeconds: world.seconds,
            worlds: world.worlds,
        });
        details.push({ instance, merged, recorded: own });
    }

    pruneCache(cache);
    try {
        store.writeJson(CACHE_FILE, cache);
    } catch (err) {
        console.warn("Couldn't save the play time cache:", err.message);
    }

    // Whole seconds, with each day's total the sum of its parts.
    const days = [...daily.values()].map((day) => {
        const byInstance = {};
        for (const [name, seconds] of Object.entries(day.byInstance)) {
            const whole = Math.round(seconds);
            if (whole > 0) byInstance[name] = whole;
        }
        return { date: day.date, seconds: Object.values(byInstance).reduce((a, b) => a + b, 0), byInstance };
    });

    const sum = (key) => {
        const known = stats.filter((s) => s[key] !== null);
        return known.length ? known.reduce((total, s) => total + s[key], 0) : null;
    };
    const result = {
        generatedAt: new Date(now).toISOString(),
        instances: stats,
        totals: {
            instances: stats.length,
            mods: stats.reduce((sum, s) => sum + s.modCount, 0),
            playSeconds: sum("playSeconds"),
            sessions: stats.reduce((total, s) => total + s.sessions, 0),
            worldPlaySeconds: sum("worldPlaySeconds"),
        },
        daily: days,
        sources,
        ...(Number.isFinite(earliest) ? { since: localDay(earliest) } : {}),
    };

    return { stats: result, details };
}

module.exports = { collect };
