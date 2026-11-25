const running = require("./running.cjs");

/*
 * Play time for games other than Minecraft. The launcher doesn't own these games (Steam or
 * the game's own launcher starts them), so after Play it looks for the game's programs every
 * little while (running.cjs) and times the session from when they appear to when they go.
 *
 * Sessions are kept in <userData>/dashboard/game-sessions.json as { game, start, end }, end
 * moved forward on every look while the game is open, so time played survives the launcher
 * quitting or crashing mid-session (the session just ends at the last look).
 */

const FILE = "game-sessions.json";
const MAX_SESSIONS = 5000;
const LOOK_MS = 15_000;
// A game that never shows up in this long didn't start (or can't be told apart).
const APPEAR_MS = 3 * 60_000;
// Missed this many looks in a row, the game has closed.
const GONE_AFTER = 2;
// Shorter than this, the game never got going.
const MIN_SESSION_MS = 60_000;
const DAY_MS = 86_400_000;

let storeModule = null;
const store = () => (storeModule ??= require("../dashboard/store.cjs"));

let sessions = null;
// gameId -> { name, watch, asked, seen, missed, record }
const open = new Map();
let timer = null;
let looking = false;
let notify = () => {};

const valid = (s) => s && typeof s.game === "string" && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start;

function load() {
    if (!sessions) {
        const saved = store().readJson(FILE, []);
        sessions = Array.isArray(saved) ? saved.filter(valid) : [];
    }
    return sessions;
}

function save() {
    if (sessions.length > MAX_SESSIONS) sessions.splice(0, sessions.length - MAX_SESSIONS);
    try {
        store().writeJson(FILE, sessions);
    } catch (err) {
        console.warn("Couldn't save the game's play session:", err.message);
    }
}

/* What's open now: [{ id, name, since }] (since is when it was first seen, ISO). */
function playing() {
    return [...open.entries()]
        .filter(([, entry]) => entry.seen)
        .map(([id, entry]) => ({ id, name: entry.name, since: new Date(entry.record.start).toISOString() }));
}

function changed() {
    try {
        notify(playing());
    } catch {
        // A closed window: nothing to tell.
    }
}

function stopIfIdle() {
    if (!open.size && timer) {
        clearInterval(timer);
        timer = null;
    }
}

/* A desktop notification (when on in Settings) that a game closed, with how long it was open. */
function closedNote(name, ms) {
    try {
        const minutes = Math.round(ms / 60_000);
        const time = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
        require("../launcherApp.cjs").notify(`${name} closed`, `Played for ${time}. It's counted in Home's play time.`);
    } catch {
        // Not in Electron (tests).
    }
}

/* One look at what's running: starts, extends and ends sessions. */
async function look(processes = running.processes) {
    if (looking) return;
    looking = true;
    try {
        const now = await processes();
        if (!now) return;
        const at = Date.now();
        let different = false;
        let dirty = false;
        for (const [id, entry] of open) {
            if (running.isOpen(entry.watch, now)) {
                entry.missed = 0;
                if (!entry.seen) {
                    entry.seen = true;
                    entry.record = { game: id, start: at, end: at };
                    load().push(entry.record);
                    different = true;
                } else {
                    entry.record.end = at;
                }
                dirty = true;
                continue;
            }
            entry.missed += 1;
            if (entry.seen ? entry.missed >= GONE_AFTER : at - entry.asked > APPEAR_MS) {
                open.delete(id);
                if (entry.seen) {
                    const played = entry.record.end - entry.record.start;
                    // Too short to have been played: it never got going.
                    if (played < MIN_SESSION_MS) sessions.splice(sessions.indexOf(entry.record), 1);
                    else closedNote(entry.name, played);
                    dirty = true;
                    different = true;
                }
            }
        }
        if (dirty) save();
        if (different) changed();
        stopIfIdle();
    } catch {
        // Next time.
    } finally {
        looking = false;
    }
}

/*
 * A game was started from the launcher: watch for its programs. watch comes from
 * running.watchFor(game, loc); without anything to tell it by, no time is kept.
 */
function started({ id, name, watch }) {
    if (!id || !watch || !running.canWatch(watch)) return false;
    const entry = open.get(id);
    if (entry) {
        // Play pressed again: the same game, still being looked for or played.
        entry.watch = watch;
        if (!entry.seen) entry.asked = Date.now();
        return true;
    }
    open.set(id, { name: String(name ?? id), watch, asked: Date.now(), seen: false, missed: 0, record: null });
    if (!timer) {
        timer = setInterval(() => void look(), LOOK_MS);
        timer.unref?.();
    }
    setTimeout(() => void look(), 5000).unref?.();
    return true;
}

const localDay = (time) => {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* Seconds of each session per calendar day, split at midnight. */
function secondsByDay(list) {
    const days = {};
    for (const { start, end } of list) {
        let from = start;
        while (from < end) {
            const d = new Date(from);
            const next = Math.min(end, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime());
            const day = localDay(from);
            days[day] = (days[day] ?? 0) + (next - from) / 1000;
            from = next;
        }
    }
    return days;
}

/*
 * Play time per game. -> { games: { [id]: { playSeconds, sessions, lastPlayed } },
 * daily: [{ date, seconds, byGame }] } over the last `count` days, oldest first.
 */
function stats(now = Date.now(), count = 90) {
    const list = load().filter((s) => s.end - s.start >= MIN_SESSION_MS || [...open.values()].some((e) => e.record === s));
    const games = {};
    for (const s of list) {
        const entry = (games[s.game] ??= { playSeconds: 0, sessions: 0, lastPlayed: null });
        entry.playSeconds += (s.end - s.start) / 1000;
        entry.sessions += 1;
        if (!entry.lastPlayed || s.end > Date.parse(entry.lastPlayed)) entry.lastPlayed = new Date(s.end).toISOString();
    }
    for (const entry of Object.values(games)) entry.playSeconds = Math.round(entry.playSeconds);

    const today = new Date(now);
    const daily = [];
    const byDay = new Map();
    for (let i = count - 1; i >= 0; i--) {
        const date = localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i).getTime());
        const day = { date, seconds: 0, byGame: {} };
        daily.push(day);
        byDay.set(date, day);
    }
    const from = now - (count + 1) * DAY_MS;
    for (const id of Object.keys(games)) {
        const days = secondsByDay(list.filter((s) => s.game === id && s.end > from));
        for (const [date, seconds] of Object.entries(days)) {
            const day = byDay.get(date);
            const whole = Math.round(seconds);
            if (!day || whole <= 0) continue;
            day.byGame[id] = whole;
            day.seconds += whole;
        }
    }
    return { games, daily };
}

/* Where open games are reported to (every window, from ipc.cjs). */
function onChange(listener) {
    notify = typeof listener === "function" ? listener : () => {};
}

/* Tests only: forget everything in memory. */
function _reset() {
    sessions = null;
    open.clear();
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = { started, playing, stats, onChange, _internal: { look, secondsByDay, _reset } };
