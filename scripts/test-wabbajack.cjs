/*
 * Wabbajack modlists (electron/games/wabbajack.cjs): OctoDiff patches, the list's folder
 * stand-ins made this computer's, Mod Organizer's INI, and where archives come from.
 */
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const wj = require("../electron/games/wabbajack.cjs");

function delta(result, commands) {
    const head = Buffer.concat([Buffer.from("OCTODELTA", "latin1"), Buffer.from([1, 4]), Buffer.from("SHA1"), Buffer.alloc(4), crypto.createHash("sha1").update(result).digest(), Buffer.from(">>>")]);
    head.writeInt32LE(20, 15);
    const parts = commands.map((c) => {
        if (c.copy) {
            const b = Buffer.alloc(17);
            b[0] = 0x60;
            b.writeBigInt64LE(BigInt(c.copy[0]), 1);
            b.writeBigInt64LE(BigInt(c.copy[1]), 9);
            return b;
        }
        const b = Buffer.alloc(9);
        b[0] = 0x80;
        b.writeBigInt64LE(BigInt(c.data.length), 1);
        return Buffer.concat([b, Buffer.from(c.data)]);
    });
    return Buffer.concat([head, ...parts]);
}

test("an OctoDiff patch: copies and new bytes, and the result checked against the patch's hash", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unity-octo-"));
    try {
        const basis = path.join(dir, "basis");
        const out = path.join(dir, "out");
        fs.writeFileSync(basis, "hello world");
        wj.applyDelta(basis, delta("hello there, world", [{ copy: [0, 6] }, { data: "there," }, { copy: [5, 6] }]), out);
        assert.strictEqual(fs.readFileSync(out, "utf8"), "hello there, world");
        // Made for another file: refused, and nothing half-made is left.
        fs.writeFileSync(basis, "HELLO WORLD");
        assert.throws(() => wj.applyDelta(basis, delta("hello there, world", [{ copy: [0, 6] }, { data: "there," }, { copy: [5, 6] }]), out), /another version/);
        assert.strictEqual(fs.existsSync(out), false);
        assert.throws(() => wj.applyDelta(basis, Buffer.from("NOTADELTA"), out), /can read/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("Wabbajack's folder stand-ins, in each of their forms", () => {
    const paths = { GAME_PATH: "C:\\Games\\Skyrim", MO2_PATH: "C:\\Modlists\\List", DOWNLOAD_PATH: "Z:\\Users\\a\\dl" };
    const text = "gamePath=@ByteArray({--||GAME_PATH_MAGIC_DOUBLE_BACK||--})\nbase={--||MO2_PATH_MAGIC_FORWARD||--}/mods\ndl={--||DOWNLOAD_PATH_MAGIC_BACK||--}";
    assert.strictEqual(wj.remap(text, paths), "gamePath=@ByteArray(C:\\\\Games\\\\Skyrim)\nbase=C:/Modlists/List/mods\ndl=Z:\\Users\\a\\dl");
});

test("Mod Organizer's INI: a key set in its section, added when missing", () => {
    assert.strictEqual(wj.setIni("[General]\na=1\n[Settings]\nb=2", "Settings", "download_directory", "C:/dl"), "[General]\r\na=1\r\n[Settings]\r\ndownload_directory=C:/dl\r\nb=2");
    assert.strictEqual(wj.setIni("[Settings]\nDownload_Directory=old\n", "settings", "download_directory", "new"), "[Settings]\r\ndownload_directory=new\r\n");
    assert.strictEqual(wj.setIni("[General]\na=1\n", "Settings", "x", "1"), "[General]\na=1\r\n\r\n[Settings]\r\nx=1\r\n");
});

test("where an archive comes from", () => {
    const nexus = wj.sourceOf({ State: { $type: "NexusDownloader, Wabbajack.Lib", GameName: "SkyrimSpecialEdition", ModID: 266, FileID: 1000 } });
    assert.deepStrictEqual([nexus.kind, nexus.domain, nexus.modId, nexus.fileId], ["nexus", "skyrimspecialedition", "266", "1000"]);
    assert.match(nexus.page, /nexusmods\.com\/skyrimspecialedition\/mods\/266\?tab=files&file_id=1000/);
    assert.strictEqual(wj.sourceOf({ State: { $type: "NexusDownloader, Wabbajack.Lib", GameName: "FalloutNewVegas", ModID: 1, FileID: 2 } }).domain, "newvegas");
    assert.strictEqual(wj.sourceOf({ State: { $type: "HttpDownloader, Wabbajack.Lib", Url: "https://github.com/a/b.7z", Headers: [] } }).kind, "http");
    assert.strictEqual(wj.sourceOf({ State: { $type: "GameFileSourceDownloader, Wabbajack.Lib", GameFile: "Data\\Skyrim.esm" } }).file, "Data/Skyrim.esm");
    const mega = wj.sourceOf({ State: { $type: "MegaDownloader, Wabbajack.Lib", Url: "https://mega.nz/file/x" } });
    assert.deepStrictEqual([mega.kind, mega.page], ["manual", "https://mega.nz/file/x"]);
});

test("Windows' names for folders: a CrossOver bottle's C:, anywhere else Wine's Z:", { skip: process.platform === "win32" }, () => {
    assert.strictEqual(wj.windowsPath("/Users/a/Library/Application Support/CrossOver/Bottles/S/drive_c/Modlists/L"), "C:\\Modlists\\L");
    assert.strictEqual(wj.windowsPath("/Users/a/Modlists"), "Z:\\Users\\a\\Modlists");
});
