const fs = require("fs");
const net = require("net");
const path = require("path");
const dns = require("dns").promises;
const nbt = require("./nbt.cjs");
const { fetchJson } = require("./net.cjs");
const { gameDirectory } = require("./instanceFiles.cjs");

/*
 * An instance's server list (its servers.dat, the one the game's Multiplayer screen
 * shows), whether each server is up, and finding servers on Modrinth.
 */

const MAX_NAME = 64;
const MAX_ADDRESS = 255;
// Flags Minecraft keeps as bytes. Anything else numeric is kept as an int.
const BYTE_KEYS = new Set(["acceptTextures", "hidden", "preventsChatReports"]);

const listFile = (instance) => path.join(gameDirectory(instance), "servers.dat");

/* host, host:port or [v6]:port, with no spaces or slashes. */
function cleanAddress(address) {
    const text = String(address ?? "").trim();
    if (!text || text.length > MAX_ADDRESS || /[\s/\\@]/.test(text)) {
        throw new Error("That isn't a server address. Use one like play.example.com or 192.168.1.20:25565.");
    }
    return text;
}

function splitAddress(address) {
    const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(address);
    if (v6) return { host: v6[1], port: v6[2] ? Number(v6[2]) : null };
    const [host, port, ...rest] = address.split(":");
    if (rest.length || !host) return { host: address, port: null };
    return { host, port: port ? Number(port) : null };
}

/* Every entry in servers.dat as read, hidden ones too, so writing it back keeps them. */
function readEntries(instance) {
    const file = listFile(instance);
    if (!fs.existsSync(file)) return [];
    try {
        const root = nbt.parse(fs.readFileSync(file));
        return Array.isArray(root.servers) ? root.servers.filter((entry) => entry && typeof entry === "object") : [];
    } catch {
        throw new Error("This instance's server list (servers.dat) can't be read. Minecraft may have left it half-written.");
    }
}

function writeEntries(instance, entries) {
    const file = listFile(instance);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tagged = entries.map((entry) => {
        const fields = {};
        for (const [key, value] of Object.entries(entry)) {
            if (typeof value === "string") fields[key] = nbt.tag.string(value);
            else if (typeof value === "number" && Number.isInteger(value)) fields[key] = BYTE_KEYS.has(key) ? nbt.tag.byte(value) : nbt.tag.int(value);
        }
        return nbt.tag.compound(fields);
    });
    const data = nbt.write(nbt.tag.compound({ servers: nbt.tag.list(nbt.tag.TYPES.compound, tagged) }));
    // Minecraft keeps the previous list as servers.dat_old; this does the same.
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}_old`);
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, data);
    fs.renameSync(temporary, file);
}

/* The servers the game's Multiplayer screen lists, in its order. */
function listServers(instance) {
    return readEntries(instance)
        .map((entry, index) => ({
            index,
            name: typeof entry.name === "string" && entry.name ? entry.name : "Minecraft Server",
            address: typeof entry.ip === "string" ? entry.ip : "",
            icon: typeof entry.icon === "string" && entry.icon ? `data:image/png;base64,${entry.icon}` : null,
            hidden: entry.hidden === 1,
        }))
        .filter((server) => server.address && !server.hidden);
}

function addServer(instance, { name, address }) {
    const ip = cleanAddress(address);
    const label = String(name ?? "").trim().slice(0, MAX_NAME) || "Minecraft Server";
    const entries = readEntries(instance);
    if (entries.some((entry) => entry.ip === ip && entry.hidden !== 1)) {
        throw new Error(`${ip} is already in this instance's server list.`);
    }
    // A hidden entry (one the game added for a Quick Play) becomes a listed one.
    const kept = entries.filter((entry) => entry.ip !== ip);
    writeEntries(instance, [...kept, { name: label, ip }]);
    return listServers(instance);
}

/* Takes a server off the list: the one at that place, if it still has that address. */
function removeServer(instance, { index, address }) {
    const entries = readEntries(instance);
    const at = entries[index]?.ip === address ? index : entries.findIndex((entry) => entry.ip === address);
    if (at < 0) return listServers(instance);
    entries.splice(at, 1);
    writeEntries(instance, entries);
    return listServers(instance);
}

/* ---------------- is it up ---------------- */

function varInt(value) {
    const bytes = [];
    let rest = value >>> 0;
    do {
        let byte = rest & 0x7f;
        rest >>>= 7;
        if (rest) byte |= 0x80;
        bytes.push(byte);
    } while (rest);
    return Buffer.from(bytes);
}

function packet(id, ...fields) {
    const body = Buffer.concat([varInt(id), ...fields]);
    return Buffer.concat([varInt(body.length), body]);
}

function mcString(text) {
    const bytes = Buffer.from(text, "utf8");
    return Buffer.concat([varInt(bytes.length), bytes]);
}

/* Reads a VarInt at `at`, or null when the buffer ends first. */
function readVarInt(buffer, at) {
    let value = 0;
    for (let i = 0; i < 5; i += 1) {
        if (at + i >= buffer.length) return null;
        const byte = buffer[at + i];
        value |= (byte & 0x7f) << (7 * i);
        if (!(byte & 0x80)) return { value, next: at + i + 1 };
    }
    throw new Error("The server sent something that isn't Minecraft.");
}

/* A chat component or old-style text, as plain words. */
function plainText(component) {
    if (component == null) return "";
    if (typeof component === "string") return component;
    if (Array.isArray(component)) return component.map(plainText).join("");
    return `${component.text ?? ""}${(component.extra ?? []).map(plainText).join("")}`;
}

const stripCodes = (text) => text.replace(/§./g, "").replace(/[ \t]+/g, " ").trim();

async function resolveTarget(address) {
    const { host, port } = splitAddress(address);
    if (port) return { host, port };
    if (net.isIP(host)) return { host, port: 25565 };
    // A server can point its name at another host and port, as the game itself looks up.
    try {
        const [record] = await dns.resolveSrv(`_minecraft._tcp.${host}`);
        if (record) return { host: record.name, port: record.port };
    } catch {
        // No SRV record: the usual port.
    }
    return { host, port: 25565 };
}

/*
 * Asks a server for its status the way the Multiplayer screen does (Server List Ping):
 * players, its message, version and icon. Resolves { online: false } when it can't be reached.
 */
async function pingServer(address, { timeout = 5000 } = {}) {
    let target;
    try {
        target = await resolveTarget(cleanAddress(address));
    } catch (err) {
        return { online: false, error: err.message };
    }

    return new Promise((resolve) => {
        const socket = net.createConnection({ host: target.host, port: target.port });
        let data = Buffer.alloc(0);
        let sentAt = 0;
        let done = false;
        const finish = (result) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            socket.destroy();
            resolve(result);
        };
        const timer = setTimeout(() => finish({ online: false, error: "It didn't answer within 5 seconds." }), timeout);

        socket.on("connect", () => {
            const port = Buffer.alloc(2);
            port.writeUInt16BE(target.port);
            // Handshake (protocol -1: "whatever you run"), asking for status; then the status request.
            socket.write(packet(0x00, varInt(-1), mcString(target.host), port, varInt(1)));
            socket.write(packet(0x00));
            sentAt = Date.now();
        });

        socket.on("data", (chunk) => {
            data = Buffer.concat([data, chunk]);
            try {
                const length = readVarInt(data, 0);
                if (!length || data.length < length.next + length.value) return;
                const id = readVarInt(data, length.next);
                const size = readVarInt(data, id.next);
                const status = JSON.parse(data.toString("utf8", size.next, size.next + size.value));
                finish({
                    online: true,
                    latency: Date.now() - sentAt,
                    players: Number(status.players?.online) || 0,
                    maxPlayers: Number(status.players?.max) || 0,
                    motd: stripCodes(plainText(status.description)).slice(0, 300),
                    version: stripCodes(String(status.version?.name ?? "")).slice(0, 80),
                    icon: typeof status.favicon === "string" && status.favicon.startsWith("data:image/png;base64,") ? status.favicon : null,
                });
            } catch {
                finish({ online: false, error: "It answered with something that isn't a Minecraft server status." });
            }
        });

        socket.on("error", (err) =>
            finish({ online: false, error: err.code === "ENOTFOUND" ? "There's no server at that name." : err.code === "ECONNREFUSED" ? "It refused the connection." : err.message })
        );
        socket.on("close", () => finish({ online: false, error: "It closed the connection." }));
    });
}

/* ---------------- finding servers ---------------- */

const SORTS = new Set(["relevance", "follows", "newest", "updated", "downloads"]);
const PAGE_SIZE = 20;

function fromModrinth(hit) {
    const java = hit.minecraft_java_server ?? {};
    const content = java.content ?? {};
    const ping = java.ping?.data ?? null;
    const latency = ping?.latency ? Math.round((ping.latency.secs ?? 0) * 1000 + (ping.latency.nanos ?? 0) / 1e6) : null;
    return {
        id: hit.project_id ?? hit.id,
        slug: hit.slug,
        name: hit.name ?? hit.title ?? "Server",
        summary: hit.summary ?? hit.description ?? "",
        icon: hit.icon_url || null,
        address: typeof java.address === "string" ? java.address : null,
        tags: (hit.categories ?? []).filter((tag) => typeof tag === "string").slice(0, 4),
        followers: hit.follows ?? hit.followers ?? 0,
        // Vanilla servers say which versions they take; modded ones name the pack to join with.
        versions: Array.isArray(content.supported_game_versions) ? content.supported_game_versions : [],
        recommendedVersion: content.recommended_game_version ?? null,
        modpack: content.kind === "modpack" ? { projectId: content.project_id ?? null, name: content.project_name ?? "a modpack", icon: content.project_icon ?? null } : null,
        online: ping ? { players: ping.players_online ?? 0, maxPlayers: ping.players_max ?? 0, version: ping.version_name ?? null, latency } : null,
        region: hit.minecraft_server?.region ?? hit.minecraft_server?.country ?? null,
        url: `https://modrinth.com/server/${hit.slug}`,
    };
}

/* Modrinth's listed Java servers. */
async function searchServers({ query = "", sort = "relevance", page = 0 } = {}) {
    const params = new URLSearchParams({
        query: String(query).slice(0, 200),
        limit: String(PAGE_SIZE),
        offset: String(Math.max(0, Math.floor(Number(page) || 0)) * PAGE_SIZE),
        index: SORTS.has(sort) ? sort : "relevance",
        new_filters: "project_types=minecraft_java_server",
    });
    const data = await fetchJson(`https://api.modrinth.com/v3/search?${params}`);
    const hits = (data.hits ?? []).map(fromModrinth).filter((server) => server.address);
    const total = data.total_hits ?? hits.length;
    return { servers: hits, page: Math.floor(Number(page) || 0), pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)), total };
}

module.exports = { listServers, addServer, removeServer, pingServer, searchServers, cleanAddress, splitAddress };
