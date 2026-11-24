const zlib = require("zlib");

/*
 * Reads Minecraft's NBT format, as in a world's level.dat: gzip-compressed, big-endian,
 * a tree of named tags. Gives plain objects (longs as Numbers, which is exact for dates).
 */

function parse(buffer) {
    const data = buffer[0] === 0x1f && buffer[1] === 0x8b ? zlib.gunzipSync(buffer) : buffer;
    let at = 0;

    const string = () => {
        const length = data.readUInt16BE(at);
        at += 2;
        const text = data.toString("utf8", at, at + length);
        at += length;
        return text;
    };

    const value = (type) => {
        switch (type) {
            case 1: return data.readInt8((at += 1) - 1);
            case 2: return data.readInt16BE((at += 2) - 2);
            case 3: return data.readInt32BE((at += 4) - 4);
            case 4: return Number(data.readBigInt64BE((at += 8) - 8));
            case 5: return data.readFloatBE((at += 4) - 4);
            case 6: return data.readDoubleBE((at += 8) - 8);
            case 7: {
                const length = data.readInt32BE(at);
                at += 4 + length;
                return { byteArray: length };
            }
            case 8: return string();
            case 9: {
                const itemType = data.readInt8(at);
                const length = data.readInt32BE(at + 1);
                at += 5;
                const list = [];
                for (let i = 0; i < length; i += 1) list.push(value(itemType));
                return list;
            }
            case 10: {
                const compound = {};
                for (;;) {
                    const tag = data.readInt8(at);
                    at += 1;
                    if (tag === 0) return compound;
                    const name = string();
                    compound[name] = value(tag);
                }
            }
            case 11: {
                const length = data.readInt32BE(at);
                at += 4 + length * 4;
                return { intArray: length };
            }
            case 12: {
                const length = data.readInt32BE(at);
                at += 4 + length * 8;
                return { longArray: length };
            }
            default:
                throw new Error(`Unknown NBT tag ${type}.`);
        }
    };

    const rootType = data.readInt8(at);
    at += 1;
    if (rootType !== 10) throw new Error("Not an NBT file.");
    string();
    return value(10);
}

/*
 * Writes NBT, uncompressed, from tagged values: tag.string("x"), tag.byte(1), tag.int(2),
 * tag.list(tag.TYPES.compound, [...]), tag.compound({ name: tag.string("x") }).
 * Enough for files like servers.dat.
 */
const TYPES = { byte: 1, int: 3, string: 8, list: 9, compound: 10 };

const tag = {
    TYPES,
    byte: (value) => ({ type: TYPES.byte, value }),
    int: (value) => ({ type: TYPES.int, value }),
    string: (value) => ({ type: TYPES.string, value: String(value) }),
    list: (itemType, items) => ({ type: TYPES.list, itemType, value: items }),
    compound: (value) => ({ type: TYPES.compound, value }),
};

function write(root) {
    const parts = [];
    const push = (size, fill) => {
        const chunk = Buffer.alloc(size);
        fill(chunk);
        parts.push(chunk);
    };
    const string = (text) => {
        const bytes = Buffer.from(text, "utf8");
        push(2, (b) => b.writeUInt16BE(bytes.length));
        parts.push(bytes);
    };
    const value = (item) => {
        switch (item.type) {
            case TYPES.byte: return push(1, (b) => b.writeInt8(item.value));
            case TYPES.int: return push(4, (b) => b.writeInt32BE(item.value));
            case TYPES.string: return string(item.value);
            case TYPES.list:
                push(5, (b) => {
                    b.writeInt8(item.value.length ? item.itemType : 0);
                    b.writeInt32BE(item.value.length, 1);
                });
                for (const entry of item.value) value(entry);
                return undefined;
            case TYPES.compound:
                for (const [name, entry] of Object.entries(item.value)) {
                    push(1, (b) => b.writeInt8(entry.type));
                    string(name);
                    value(entry);
                }
                return push(1, (b) => b.writeInt8(0));
            default:
                throw new Error(`Can't write NBT tag ${item.type}.`);
        }
    };

    push(1, (b) => b.writeInt8(TYPES.compound));
    string("");
    value(root);
    return Buffer.concat(parts);
}

module.exports = { parse, write, tag };
