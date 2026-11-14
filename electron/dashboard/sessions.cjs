const store = require("./store.cjs");

/*
 * Play sessions the launcher records itself: when it starts an instance's game and when
 * that game exits. Kept in <userData>/dashboard/sessions.json, newest last.
 *
 * A session still open when the launcher quit (the game outlived it) never gets an end
 * here; the game's own log covers it instead (see playtime.cjs).
 */

const FILE = "sessions.json";
const MAX_SESSIONS = 5000;

let sessions = null;

function load() {
    if (!sessions) {
        const saved = store.readJson(FILE, []);
        sessions = Array.isArray(saved) ? saved.filter(valid) : [];
    }
    return sessions;
}

const valid = (s) => s && typeof s.instance === "string" && Number.isFinite(s.start);

function save() {
    if (sessions.length > MAX_SESSIONS) sessions.splice(0, sessions.length - MAX_SESSIONS);
    try {
        store.writeJson(FILE, sessions);
    } catch (err) {
        console.warn("Couldn't save the play session:", err.message);
    }
}

/*
 * The game of instance `name` has started. Several instances can be open at once, each its
 * own session: id tells them apart (instanceManager's run id), and player is who it was
 * played as ({ id, name } of the account, null offline).
 */
function started(name, at = Date.now(), { id = null, player = null } = {}) {
    if (typeof name !== "string" || !name) return;
    const list = load();
    // One open session per instance: an older open one was never closed, so it stays open-ended.
    list.push({
        instance: name,
        ...(typeof id === "string" && id ? { id } : {}),
        ...(player && typeof player.name === "string" ? { player: player.name } : {}),
        start: at,
        end: null,
        code: null,
    });
    save();
}

/*
 * The game of instance `name` has exited, with this exit code (null when it was stopped).
 * With an id, only that session ends; without, the instance's newest.
 */
function ended(name, code, at = Date.now(), id = null) {
    const list = load();
    for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i];
        if (s.instance !== name) continue;
        if (id && s.id && s.id !== id) continue;
        if (s.end !== null) return;
        s.end = Math.max(at, s.start);
        s.code = Number.isInteger(code) ? code : null;
        save();
        return;
    }
}

/* Every recorded session: { instance, id?, player?, start, end|null, code|null }, oldest first. */
function list() {
    return load().map((s) => ({ ...s }));
}

/* For tests: forget what was loaded, so the next call reads the file again. */
function reset() {
    sessions = null;
}

module.exports = { started, ended, list, reset };
