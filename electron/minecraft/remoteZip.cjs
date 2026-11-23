/*
 * Reads single files out of a zip on a web server without downloading all of it: the
 * zip's table of contents sits at its end, so a couple of HTTP range requests find it,
 * then one more fetches the wanted entry. A modpack's file list is a few kilobytes,
 * while the pack itself can carry hundreds of megabytes of bundled configs and textures.
 *
 * A server that ignores ranges sends the whole file instead, which is used as it is
 * (up to MAX_WHOLE bytes).
 */

const zlib = require("zlib");

const USER_AGENT = "UnityLauncher/1.0";
const MAX_WHOLE = 512 * 1024 * 1024;
const MAX_ENTRY = 64 * 1024 * 1024;
// The end record is 22 bytes plus a comment of up to 65,535.
const TAIL = 22 + 65535;

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function allowed(url, hosts) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" && (!hosts || hosts.includes(parsed.hostname.toLowerCase()));
    } catch {
        return false;
    }
}

class RemoteZip {
    constructor(url, size) {
        this.url = url;
        this.size = size;
        this.whole = null;
    }

    // Bytes [start, end), from the server or from the whole file if it sent that.
    async read(start, end) {
        end = Math.min(end, this.size);
        if (this.whole) return this.whole.subarray(start, end);

        const res = await fetch(this.url, {
            headers: { "User-Agent": USER_AGENT, Range: `bytes=${start}-${end - 1}` },
            redirect: "follow",
            signal: AbortSignal.timeout(60 * 1000),
        });

        if (res.status === 206) return Buffer.from(await res.arrayBuffer());

        if (res.status === 200) {
            const declared = Number(res.headers.get("content-length"));
            if (declared > MAX_WHOLE) {
                res.body?.cancel().catch(() => {});
                throw new Error("The pack's server doesn't allow reading part of a file, and the pack is too big to fetch whole.");
            }
            this.whole = Buffer.from(await res.arrayBuffer());
            this.size = this.whole.length;
            return this.whole.subarray(start, Math.min(end, this.size));
        }

        throw new Error(`HTTP ${res.status} reading the pack`);
    }

    async open() {
        if (!Number.isFinite(this.size) || this.size <= 0) {
            const head = await fetch(this.url, {
                method: "HEAD",
                headers: { "User-Agent": USER_AGENT },
                redirect: "follow",
                signal: AbortSignal.timeout(30 * 1000),
            });
            this.size = Number(head.headers.get("content-length"));
            if (!head.ok || !Number.isFinite(this.size) || this.size <= 0) {
                throw new Error("Couldn't tell how big the pack is.");
            }
        }

        const tailStart = Math.max(0, this.size - TAIL);
        const tail = await this.read(tailStart, this.size);

        let at = -1;
        for (let i = tail.length - 22; i >= 0; i--) {
            if (tail.readUInt32LE(i) === EOCD) { at = i; break; }
        }
        if (at < 0) throw new Error("That file isn't a zip.");

        let count = tail.readUInt16LE(at + 10);
        let dirSize = tail.readUInt32LE(at + 12);
        let dirStart = tail.readUInt32LE(at + 16);

        // Zip64: the real numbers are in a record the locator just before points to.
        if (count === 0xffff || dirSize === 0xffffffff || dirStart === 0xffffffff) {
            const locator = at - 20;
            if (locator < 0 || tail.readUInt32LE(locator) !== ZIP64_LOCATOR) throw new Error("That zip's table of contents is damaged.");
            const recordAt = Number(tail.readBigUInt64LE(locator + 8));
            const record = await this.read(recordAt, recordAt + 56);
            if (record.readUInt32LE(0) !== ZIP64_EOCD) throw new Error("That zip's table of contents is damaged.");
            count = Number(record.readBigUInt64LE(32));
            dirSize = Number(record.readBigUInt64LE(40));
            dirStart = Number(record.readBigUInt64LE(48));
        }

        const dir = dirStart >= tailStart && dirStart + dirSize <= this.size
            ? tail.subarray(dirStart - tailStart, dirStart - tailStart + dirSize)
            : await this.read(dirStart, dirStart + dirSize);

        this.entries = new Map();
        let p = 0;
        for (let n = 0; n < count && p + 46 <= dir.length; n++) {
            if (dir.readUInt32LE(p) !== CENTRAL) break;
            const method = dir.readUInt16LE(p + 10);
            let compressed = dir.readUInt32LE(p + 20);
            let size = dir.readUInt32LE(p + 24);
            const nameLength = dir.readUInt16LE(p + 28);
            const extraLength = dir.readUInt16LE(p + 30);
            const commentLength = dir.readUInt16LE(p + 32);
            let offset = dir.readUInt32LE(p + 42);
            const name = dir.toString("utf8", p + 46, p + 46 + nameLength);

            // Zip64 sizes and offsets, in that order, for whichever didn't fit in 32 bits.
            let e = p + 46 + nameLength;
            const extraEnd = e + extraLength;
            while (e + 4 <= extraEnd) {
                const id = dir.readUInt16LE(e);
                const length = dir.readUInt16LE(e + 2);
                if (id === 0x0001) {
                    let q = e + 4;
                    if (size === 0xffffffff) { size = Number(dir.readBigUInt64LE(q)); q += 8; }
                    if (compressed === 0xffffffff) { compressed = Number(dir.readBigUInt64LE(q)); q += 8; }
                    if (offset === 0xffffffff) { offset = Number(dir.readBigUInt64LE(q)); }
                }
                e += 4 + length;
            }

            this.entries.set(name, { name, method, compressed, size, offset, nameLength, extraLength });
            p = extraEnd + commentLength;
        }

        return this;
    }

    names() {
        return [...this.entries.keys()];
    }

    async buffer(name) {
        const entry = this.entries.get(name);
        if (!entry) return null;
        if (entry.size > MAX_ENTRY) throw new Error(`${name} is too big to read.`);

        // The local header's extra field can differ in length from the central directory's,
        // so read a little spare and find the data from the header itself.
        let chunk = await this.read(entry.offset, entry.offset + 30 + entry.nameLength + entry.extraLength + entry.compressed + 1024);
        if (chunk.length < 30 || chunk.readUInt32LE(0) !== LOCAL) throw new Error(`${name} is damaged in the zip.`);
        const start = 30 + chunk.readUInt16LE(26) + chunk.readUInt16LE(28);
        if (start + entry.compressed > chunk.length) {
            chunk = await this.read(entry.offset, entry.offset + start + entry.compressed);
        }
        const data = chunk.subarray(start, start + entry.compressed);

        if (entry.method === 0) return Buffer.from(data);
        if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
        throw new Error(`${name} uses a compression the launcher can't read.`);
    }

    async text(name) {
        const data = await this.buffer(name);
        return data ? data.toString("utf8") : null;
    }
}

async function openRemoteZip(url, size, hosts) {
    if (!allowed(url, hosts)) throw new Error("The pack's download address isn't one the launcher trusts.");
    return new RemoteZip(url, size).open();
}

module.exports = { openRemoteZip };
