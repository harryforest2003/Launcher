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

module.exports = { parse };
