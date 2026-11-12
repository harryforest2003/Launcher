const fs = require("fs");
const zlib = require("zlib");

/*
 * Reading The Sims 4's .package files (DBPF 2.1): the index of what's inside each one
 * (each resource's type, group and instance), and a resource's contents.
 *
 * The header is 96 bytes; the index it points to starts with flags saying which of
 * type, group and instance-high are the same for every entry (and given once), then an
 * entry for each resource: type, group, instance (high, low), where it is, its size on
 * disk (the top bit meaning compression details follow) and its size in memory, then
 * the compression type when there is one. Resources are stored as they are, deflated
 * (zlib), or with the game's own RefPack compression.
 */

const ZLIB = 0x5a42;
const REFPACK = [0xffff, 0xfffe];
const DELETED = 0xffe0;

const hex = (n, width = 8) => n.toString(16).padStart(width, "0");

/* The index of a .package: [{ type, group, instance (hex), offset, stored, size, compression }], or null if it isn't one. */
function readIndex(file) {
    let fd;
    try {
        fd = fs.openSync(file, "r");
        const header = Buffer.alloc(96);
        if (fs.readSync(fd, header, 0, 96, 0) < 96 || header.toString("latin1", 0, 4) !== "DBPF") return null;
        const count = header.readUInt32LE(36);
        const size = header.readUInt32LE(44);
        const position = header.readUInt32LE(64) || header.readUInt32LE(40);
        if (!count || !size || size > 64 * 1024 * 1024) return [];
        const index = Buffer.alloc(size);
        fs.readSync(fd, index, 0, size, position);

        let pos = 0;
        const flags = index.readUInt32LE(pos);
        pos += 4;
        const constType = flags & 1 ? index.readUInt32LE((pos += 4) - 4) : null;
        const constGroup = flags & 2 ? index.readUInt32LE((pos += 4) - 4) : null;
        const constHigh = flags & 4 ? index.readUInt32LE((pos += 4) - 4) : null;
        const entries = [];
        for (let i = 0; i < count && pos < size; i++) {
            const type = constType ?? index.readUInt32LE((pos += 4) - 4);
            const group = constGroup ?? index.readUInt32LE((pos += 4) - 4);
            const high = constHigh ?? index.readUInt32LE((pos += 4) - 4);
            const low = index.readUInt32LE(pos);
            const offset = index.readUInt32LE(pos + 4);
            const storedRaw = index.readUInt32LE(pos + 8);
            const memSize = index.readUInt32LE(pos + 12);
            pos += 16;
            let compression = 0;
            if (storedRaw & 0x80000000) {
                compression = index.readUInt16LE(pos);
                pos += 4;
            }
            if (compression === DELETED) continue;
            entries.push({ type, group, instance: hex(high) + hex(low), offset, stored: storedRaw & 0x7fffffff, size: memSize, compression });
        }
        return entries;
    } catch {
        return null;
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

/* The game's own RefPack (QFS) compression. */
function unrefpack(data) {
    let pos = 0;
    const flags = data[pos];
    pos += 2; // flags, then 0xFB
    const big = flags & 0x80;
    let size = 0;
    for (let i = 0; i < (big ? 4 : 3); i++) size = (size << 8) | data[pos++];
    const out = Buffer.alloc(size);
    let outPos = 0;
    const copyBack = (offset, length) => {
        for (let i = 0; i < length; i++, outPos++) out[outPos] = out[outPos - offset];
    };
    while (pos < data.length && outPos < size) {
        const b0 = data[pos++];
        let plain;
        if (b0 < 0x80) {
            const b1 = data[pos++];
            plain = b0 & 0x03;
            data.copy(out, outPos, pos, pos + plain);
            outPos += plain;
            pos += plain;
            copyBack(((b0 & 0x60) << 3) + b1 + 1, ((b0 & 0x1c) >> 2) + 3);
        } else if (b0 < 0xc0) {
            const b1 = data[pos++];
            const b2 = data[pos++];
            plain = (b1 & 0xc0) >> 6;
            data.copy(out, outPos, pos, pos + plain);
            outPos += plain;
            pos += plain;
            copyBack(((b1 & 0x3f) << 8) + b2 + 1, (b0 & 0x3f) + 4);
        } else if (b0 < 0xe0) {
            const b1 = data[pos++];
            const b2 = data[pos++];
            const b3 = data[pos++];
            plain = b0 & 0x03;
            data.copy(out, outPos, pos, pos + plain);
            outPos += plain;
            pos += plain;
            copyBack(((b0 & 0x10) << 12) + (b1 << 8) + b2 + 1, ((b0 & 0x0c) << 6) + b3 + 5);
        } else if (b0 < 0xfc) {
            plain = ((b0 & 0x1f) << 2) + 4;
            data.copy(out, outPos, pos, pos + plain);
            outPos += plain;
            pos += plain;
        } else {
            plain = b0 & 0x03;
            data.copy(out, outPos, pos, pos + plain);
            outPos += plain;
            pos += plain;
            break;
        }
    }
    return out;
}

/* One resource's contents, uncompressed. Null if it can't be read. */
function readResource(file, entry, limit = 32 * 1024 * 1024) {
    if (!entry || entry.stored > limit) return null;
    let fd;
    try {
        fd = fs.openSync(file, "r");
        const data = Buffer.alloc(entry.stored);
        fs.readSync(fd, data, 0, entry.stored, entry.offset);
        if (entry.compression === ZLIB) return zlib.inflateSync(data);
        if (REFPACK.includes(entry.compression)) return unrefpack(data);
        return data;
    } catch {
        return null;
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

module.exports = { readIndex, readResource, hex };
