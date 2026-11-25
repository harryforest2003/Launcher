const zlib = require("zlib");

/*
 * Share codes: a mod list as text to paste anywhere, "unity1:" and the list squeezed
 * with deflate and written in URL-safe base64. Nothing is uploaded; whoever pastes the
 * code gets the mods from the sites they came from.
 *
 *   Minecraft: { k: "mc", n: name, v: version, l: loader, lv: loader version,
 *                r: { mod: [Modrinth version IDs], resourcepack: [...], shader: [...] },
 *                c: { mod: [CurseForge file IDs], ... }, x: [names of files on neither] }
 *   A game:    { k: "game", g: game ID, m: [[provider, mod ID, file ID or "", name]], x: [names] }
 */

const PREFIX = "unity1:";
const MAX_CODE = 400 * 1024;
const MAX_JSON = 2 * 1024 * 1024;
const MAX_ITEMS = 3000;
const TYPES = ["mod", "resourcepack", "shader"];
const LOADERS = ["vanilla", "fabric", "quilt", "forge", "neoforge", "legacy-fabric", "babric", "liteloader"];

function encode(data) {
    return PREFIX + zlib.deflateRawSync(Buffer.from(JSON.stringify(data)), { level: 9 }).toString("base64url");
}

const bad = () => new Error("That isn't a share code this launcher can read. Check it was copied whole.");
const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
const list = (value) => (Array.isArray(value) ? value.slice(0, MAX_ITEMS) : []);

function byType(value, valid) {
    const out = {};
    for (const type of TYPES) {
        const ids = list(value?.[type]).filter(valid);
        if (ids.length) out[type] = ids;
    }
    return out;
}

/* A code back to its list, checked field by field. Throws on anything else. */
function decode(code) {
    const raw = String(code ?? "").replace(/\s+/g, "");
    if (!raw.startsWith(PREFIX) || raw.length > MAX_CODE) throw bad();
    let data;
    try {
        data = JSON.parse(zlib.inflateRawSync(Buffer.from(raw.slice(PREFIX.length), "base64url"), { maxOutputLength: MAX_JSON }).toString("utf8"));
    } catch {
        throw bad();
    }
    const names = list(data?.x).map((name) => text(name, 120)).filter(Boolean);

    if (data?.k === "mc") {
        const loader = LOADERS.includes(data.l) ? data.l : null;
        const version = /^[\w.\- ]{1,40}$/.test(data.v ?? "") ? data.v : null;
        if (!loader || !version) throw bad();
        return {
            kind: "minecraft",
            name: text(data.n, 80).trim() || "Shared instance",
            version,
            loader,
            loaderVersion: /^[\w.+-]{1,64}$/.test(data.lv ?? "") ? data.lv : null,
            modrinth: byType(data.r, (id) => typeof id === "string" && /^[A-Za-z0-9]{8}$/.test(id)),
            curseforge: byType(data.c, (id) => Number.isSafeInteger(id) && id > 0),
            missing: names,
        };
    }

    if (data?.k === "game") {
        if (!/^[\w-]{1,64}$/.test(data.g ?? "")) throw bad();
        const mods = list(data.m)
            .filter((entry) => Array.isArray(entry) && /^[\w-]{1,30}$/.test(entry[0] ?? "") && /^(?!.*\.\.)[\w.\-:@/ ]{1,120}$/.test(String(entry[1] ?? "")))
            .map(([provider, modId, fileId, name]) => ({
                provider,
                modId: String(modId),
                fileId: /^[\w.\-:@]{1,120}$/.test(String(fileId ?? "")) ? String(fileId) : null,
                name: text(name, 120) || String(modId),
            }));
        return { kind: "game", gameId: data.g, mods, missing: names };
    }

    throw bad();
}

module.exports = { encode, decode, TYPES, PREFIX };
