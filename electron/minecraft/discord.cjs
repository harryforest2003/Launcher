const net = require("net");
const path = require("path");
const { instanceEvents, getInstance } = require("../instanceManager.cjs");
const { readSettings, settingsEvents } = require("./settings.cjs");
const running = require("../games/running.cjs");

/*
 * The game being played, on the player's Discord profile: a Minecraft instance, or any other
 * game started from the launcher (GTA V, The Sims 4...). It talks to the Discord app on this
 * computer over its local socket (Discord's RPC), as the Discord application whose ID the
 * player put in Settings; that application's name is what shows after "Playing". Nothing
 * goes over the internet from here.
 *
 * Minecraft's own start and exit say when an instance is open. Other games are started by
 * Steam, their own launchers or `open`, so their programs are looked for every 15 s.
 */

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const RETRY_MS = 15000;
const CONNECT_MS = 5000;
const REQUEST_MS = 10000;

/* Where the Discord app listens: discord-ipc-0 to 9, in the temp folder (or Flatpak/Snap's). */
function socketPaths() {
    if (process.platform === "win32") return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
    const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp";
    const folders = [base, path.join(base, "app", "com.discordapp.Discord"), path.join(base, "app", "com.discordapp.DiscordCanary"), path.join(base, "snap.discord"), "/tmp"];
    const paths = [];
    for (const folder of [...new Set(folders)]) {
        for (let i = 0; i < 10; i++) paths.push(path.join(folder, `discord-ipc-${i}`));
    }
    return paths;
}

function encode(op, data) {
    const json = Buffer.from(JSON.stringify(data));
    const header = Buffer.alloc(8);
    header.writeInt32LE(op, 0);
    header.writeInt32LE(json.length, 4);
    return Buffer.concat([header, json]);
}

class DiscordError extends Error {}

const NOT_OPEN = "Discord isn't open on this computer. Open the Discord app (the website can't show a status) and try again.";
const BAD_ID = "Discord didn't accept that application ID. Copy it again from your application's General Information page.";

/* One connection to the Discord app, signed in as one application. */
class DiscordClient {
    constructor(clientId) {
        this.clientId = clientId;
        this.socket = null;
        this.buffer = Buffer.alloc(0);
        this.pending = new Map();
        this.nonce = 0;
        this.user = null;
        this.closed = false;
        this.onClose = null;
    }

    /* Tries each socket until one answers the handshake. */
    async connect() {
        let last = new DiscordError(NOT_OPEN);
        for (const where of socketPaths()) {
            try {
                await this.open(where);
                return this;
            } catch (err) {
                // A wrong ID is the same at every socket: stop there.
                if (err.message === BAD_ID) throw err;
                if (!(err instanceof DiscordError && err.message === NOT_OPEN)) last = err;
            }
        }
        throw last;
    }

    open(where) {
        return new Promise((resolve, reject) => {
            let settled = false;
            this.buffer = Buffer.alloc(0);
            const socket = net.createConnection(where);
            const fail = (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                socket.destroy();
                reject(err);
            };
            const timer = setTimeout(() => fail(new DiscordError("Discord didn't answer. Restart the Discord app and try again.")), CONNECT_MS);
            socket.once("error", (err) => fail(err.code === "ENOENT" || err.code === "ECONNREFUSED" ? new DiscordError(NOT_OPEN) : err));
            socket.on("connect", () => socket.write(encode(OP.HANDSHAKE, { v: 1, client_id: this.clientId })));
            socket.on("data", (chunk) => {
                this.buffer = Buffer.concat([this.buffer, chunk]);
                while (this.buffer.length >= 8) {
                    const op = this.buffer.readInt32LE(0);
                    const length = this.buffer.readInt32LE(4);
                    if (this.buffer.length < 8 + length) break;
                    let data = null;
                    try {
                        data = JSON.parse(this.buffer.subarray(8, 8 + length).toString("utf8"));
                    } catch {
                        // A frame that isn't JSON: skip it.
                    }
                    this.buffer = this.buffer.subarray(8 + length);
                    if (!settled) {
                        if (op === OP.CLOSE) {
                            fail(new DiscordError(data?.code === 4000 || /client id/i.test(data?.message ?? "") ? BAD_ID : `Discord closed the connection: ${data?.message ?? "no reason given"}.`));
                            return;
                        }
                        if (op === OP.FRAME && data?.cmd === "DISPATCH" && data?.evt === "READY") {
                            settled = true;
                            clearTimeout(timer);
                            this.socket = socket;
                            this.user = data.data?.user ?? null;
                            socket.removeAllListeners("error");
                            socket.on("error", () => socket.destroy());
                            socket.on("close", () => this.closedDown());
                            resolve();
                        }
                        continue;
                    }
                    this.handle(op, data);
                }
            });
            socket.once("close", () => fail(new DiscordError(NOT_OPEN)));
        });
    }

    handle(op, data) {
        if (op === OP.PING) {
            this.socket?.write(encode(OP.PONG, data));
        } else if (op === OP.CLOSE) {
            this.socket?.destroy();
        } else if (op === OP.FRAME && data?.nonce && this.pending.has(data.nonce)) {
            const { resolve, reject, timer } = this.pending.get(data.nonce);
            this.pending.delete(data.nonce);
            clearTimeout(timer);
            if (data.evt === "ERROR") reject(new DiscordError(`Discord didn't show the status: ${data.data?.message ?? "unknown error"}.`));
            else resolve(data.data);
        }
    }

    request(cmd, args) {
        if (!this.socket || this.closed) return Promise.reject(new DiscordError(NOT_OPEN));
        const nonce = `${Date.now()}-${++this.nonce}`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(nonce);
                reject(new DiscordError("Discord didn't answer. Restart the Discord app and try again."));
            }, REQUEST_MS);
            this.pending.set(nonce, { resolve, reject, timer });
            this.socket.write(encode(OP.FRAME, { cmd, args, nonce }));
        });
    }

    /* Shows the status, or clears it with null. */
    setActivity(activity) {
        return this.request("SET_ACTIVITY", { pid: process.pid, ...(activity ? { activity } : {}) });
    }

    closedDown() {
        if (this.closed) return;
        this.closed = true;
        for (const { reject, timer } of this.pending.values()) {
            clearTimeout(timer);
            reject(new DiscordError(NOT_OPEN));
        }
        this.pending.clear();
        this.onClose?.();
    }

    close() {
        this.socket?.destroy();
        this.closedDown();
    }
}

/* ---------------- what's shown ---------------- */

const LOADERS = { fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", quilt: "Quilt" };

/*
 * The games open now, newest shown: "mc:<instance>" -> { kind, name, session, at }, and
 * "game:<id>" -> { kind, name, safe, mods, watch, at, seen, missed }.
 */
const sessions = new Map();
let client = null;
let shown = null;
let retry = null;
let syncing = null;
let again = false;
let lastError = null;

const WATCH_MS = 15000;
// A game's program has this long to appear (Steam and Rockstar's launcher can be slow)...
const APPEAR_MS = 5 * 60 * 1000;
// ...and once seen, it's closed when it's missing this many times running.
const GONE_AFTER = 2;

function wanted() {
    const settings = readSettings();
    return settings.discordStatus && settings.discordClientId && sessions.size ? settings.discordClientId : null;
}

// Discord turns down a line shorter than 2 characters.
const line = (text, otherwise) => (text.length >= 2 ? text : otherwise).slice(0, 128);

function activityFor(open) {
    const timestamps = { start: open.at };
    if (open.kind === "game") {
        const state = open.safe ? "Without mods" : open.mods ? `With ${open.mods} mod${open.mods === 1 ? "" : "s"}` : null;
        return { details: line(open.name, `Playing ${open.name}`), ...(state ? { state } : {}), timestamps, instance: false };
    }
    let instance = null;
    try {
        instance = getInstance(open.name);
    } catch {
        // Deleted or renamed while open: the name alone is enough.
    }
    const loader = LOADERS[String(instance?.loader ?? "").toLowerCase()];
    const state = instance?.version ? `Minecraft ${instance.version}${loader ? ` with ${loader}` : ""}` : "Minecraft";
    return { details: line(open.name, `Minecraft: ${open.name}`), state: state.slice(0, 128), timestamps, instance: false };
}

function clearRetry() {
    clearTimeout(retry);
    retry = null;
}

async function apply() {
    const clientId = wanted();
    if (!clientId) {
        clearRetry();
        if (client) {
            await client.setActivity(null).catch(() => {});
            client.close();
            client = null;
        }
        shown = null;
        lastError = null;
        return;
    }
    if (client && (client.clientId !== clientId || client.closed)) {
        client.close();
        client = null;
    }
    if (!client) {
        const next = new DiscordClient(clientId);
        next.onClose = () => {
            if (client === next) client = null;
            shown = null;
            sync();
        };
        await next.connect();
        client = next;
        shown = null;
    }
    const newest = [...sessions.values()].sort((a, b) => b.at - a.at)[0];
    const activity = activityFor(newest);
    const key = JSON.stringify(activity);
    if (key !== shown) {
        await client.setActivity(activity);
        shown = key;
    }
    lastError = null;
    clearRetry();
}

/* Brings Discord up to date, one change at a time; tries again every 15 s while it can't. */
function sync() {
    if (syncing) {
        again = true;
        return syncing;
    }
    syncing = apply()
        .catch((err) => {
            lastError = err.message;
            if (client?.closed) client = null;
            if (wanted() && !retry) {
                retry = setTimeout(() => {
                    retry = null;
                    sync();
                }, RETRY_MS);
            }
        })
        .finally(() => {
            syncing = null;
            if (again) {
                again = false;
                sync();
            }
        });
    return syncing;
}

/* ---------------- other games ---------------- */

let watcher = null;
let polling = false;

const gamesOpen = () => [...sessions.values()].some((open) => open.kind === "game");

function stopWatching() {
    clearInterval(watcher);
    watcher = null;
}

/* Looks for each game's programs; drops the ones that closed, or never appeared. */
async function poll() {
    if (polling) return;
    polling = true;
    try {
        const now = await running.processes();
        if (!now) return;
        let changed = false;
        for (const [key, open] of sessions) {
            if (open.kind !== "game") continue;
            if (running.isOpen(open.watch, now)) {
                open.seen = true;
                open.missed = 0;
                continue;
            }
            open.missed += 1;
            if (open.seen ? open.missed >= GONE_AFTER : Date.now() - open.at > APPEAR_MS) {
                sessions.delete(key);
                changed = true;
            }
        }
        if (!gamesOpen()) stopWatching();
        if (changed) sync();
    } catch {
        // Next time.
    } finally {
        polling = false;
    }
}

/*
 * A game other than Minecraft was started from the launcher: { id, name, safe, mods, watch }
 * (watch from games/running.cjs). Shown only while the Discord status is on and there's
 * something to tell it's still open by.
 */
function gameStarted({ id, name, safe = false, mods = 0, watch }) {
    if (!readSettings().discordStatus || !watch || !running.canWatch(watch)) return false;
    const key = `game:${id}`;
    const open = sessions.get(key);
    // Play pressed again while it's open: it's the same game, played since then.
    if (open?.seen && !open.missed) {
        Object.assign(open, { safe, mods });
    } else {
        sessions.set(key, { kind: "game", name: String(name), safe, mods, watch, at: Date.now(), seen: false, missed: 0 });
    }
    if (!watcher) watcher = setInterval(() => void poll(), WATCH_MS);
    sync();
    return true;
}

let started = false;

/* Follows games opening and closing, and Settings switching it on or off. */
function startDiscordStatus() {
    if (started) return;
    started = true;
    instanceEvents.on("started", ({ name, session, at }) => {
        sessions.set(`mc:${name}`, { kind: "mc", name, session, at: at ?? Date.now() });
        sync();
    });
    instanceEvents.on("exit", ({ name, session }) => {
        const open = sessions.get(`mc:${name}`);
        if (!open || (session && open.session !== session)) return;
        sessions.delete(`mc:${name}`);
        sync();
    });
    settingsEvents.on("changed", () => {
        // Switched off: other games stop being watched (switched on again, they're not known).
        if (!readSettings().discordStatus) {
            for (const [key, open] of sessions) if (open.kind === "game") sessions.delete(key);
            stopWatching();
        }
        sync();
    });
}

/* Settings' "Test" button: connects as that application and says who's signed in to Discord. */
async function testDiscord(clientId) {
    const id = String(clientId ?? "").trim();
    if (!/^\d{17,20}$/.test(id)) throw new Error("A Discord application ID is a number 17 to 20 digits long.");
    // The status already showing with this ID proves it works.
    if (client && !client.closed && client.clientId === id) return { user: client.user?.global_name || client.user?.username || null, showing: Boolean(shown) };
    const test = new DiscordClient(id);
    await test.connect();
    const user = test.user?.global_name || test.user?.username || null;
    test.close();
    return { user, showing: false };
}

/* For Settings: whether a status is showing, and why not. */
function discordState() {
    return { showing: Boolean(client && shown), playing: sessions.size > 0, error: sessions.size ? lastError : null };
}

module.exports = { startDiscordStatus, gameStarted, testDiscord, discordState, socketPaths, encode };
