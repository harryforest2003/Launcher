/*
 * Adding worlds to an instance (electron/minecraft/worlds.cjs): finding the worlds in a zip
 * or folder, naming their folders, and unpacking them safely. Offline: the zips are made
 * here, in a temporary folder that stands in for an instance.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const yazl = require("yazl");
const worlds = require("../electron/minecraft/worlds.cjs");

/* A tiny gzipped level.dat: Data { LevelName, Version { Name } }. */
function levelDat(levelName, version) {
    const str = (s) => {
        const b = Buffer.from(s, "utf8");
        const len = Buffer.alloc(2);
        len.writeUInt16BE(b.length);
        return Buffer.concat([len, b]);
    };
    const tagString = (name, value) => Buffer.concat([Buffer.from([8]), str(name), str(value)]);
    const compound = (name, ...children) => Buffer.concat([Buffer.from([10]), str(name), ...children, Buffer.from([0])]);
    return zlib.gzipSync(compound("", compound("Data", tagString("LevelName", levelName), compound("Version", tagString("Name", version)))));
}

function makeZip(file, entries) {
    return new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        for (const [name, data] of Object.entries(entries)) zip.addBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data), name);
        zip.end();
        zip.outputStream.pipe(fs.createWriteStream(file)).on("close", resolve).on("error", reject);
    });
}

function instance() {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "unity-worlds-test-"));
    return { folder, version: "1.20.1", gameDirectory: path.join(folder, ".minecraft") };
}
const saves = (inst) => path.join(inst.gameDirectory, "saves");

test("worlds are the folders with a level.dat, outermost only, skipping macOS clutter", () => {
    assert.deepStrictEqual(worlds.worldRoots(["level.dat", "region/r.0.0.mca"]), [""]);
    assert.deepStrictEqual(
        worlds.worldRoots(["Map v2/Map/level.dat", "Map v2/Map/backup/level.dat", "Map v2/readme.txt", "__MACOSX/Map v2/Map/level.dat"]),
        ["Map v2/Map"]
    );
    assert.deepStrictEqual(worlds.worldRoots(["A/level.dat", "B/level.dat", "B/data/x.dat"]), ["A", "B"]);
    assert.deepStrictEqual(worlds.worldRoots(["Win\\level.dat"]), ["Win"]);
    assert.deepStrictEqual(worlds.worldRoots(["pack.mcmeta"]), []);
});

test("folder names are safe on every system", () => {
    assert.strictEqual(worlds.safeName('My: "Map" / v1?'), "My Map v1");
    assert.strictEqual(worlds.safeName("§6Gold§r World..."), "Gold World");
    assert.strictEqual(worlds.safeName("\uFFFDaOneblock \uFFFD2Original \uFFFDrv2_1_2"), "Oneblock Original v2_1_2");
    assert.strictEqual(worlds.safeName("CON"), "CON world");
    assert.strictEqual(worlds.safeName(""), "World");
    assert.strictEqual(worlds.safeName(".hidden"), "World.hidden");
});

test("versions compare by release number, including year-based ones", () => {
    assert.strictEqual(worlds.compareVersions("1.21.1", "1.20.1"), 1);
    assert.strictEqual(worlds.compareVersions("1.20", "1.20.0"), 0);
    assert.strictEqual(worlds.compareVersions("26.1", "1.21.11"), 1);
    assert.strictEqual(worlds.compareVersions("24w14a", "1.20.1"), 0);
});

test("a Dropbox share link becomes its file", () => {
    assert.strictEqual(worlds.directLink("https://www.dropbox.com/s/abc/map.zip?dl=0"), "https://www.dropbox.com/s/abc/map.zip?dl=1");
    assert.strictEqual(worlds.directLink(" https://example.com/map.zip "), "https://example.com/map.zip");
});

test("a zip's worlds each get their own folder, named for the map, with clashes numbered", async () => {
    const inst = instance();
    const zip = path.join(inst.folder, "pack.zip");
    await makeZip(zip, {
        "Skyblock/level.dat": levelDat("Skyblock", "1.20.1"),
        "Skyblock/region/r.0.0.mca": "region",
        "Parkour/level.dat": levelDat("Parkour", "1.21.4"),
        "__MACOSX/Skyblock/._level.dat": "junk",
    });
    fs.mkdirSync(path.join(saves(inst), "Skyblock"), { recursive: true });

    const added = await worlds.importZip(inst, zip);
    assert.deepStrictEqual(
        added.map((w) => [w.folder, w.name, w.version, w.newer]).sort((a, b) => b[0].localeCompare(a[0])),
        [
            ["Skyblock (2)", "Skyblock", "1.20.1", false],
            ["Parkour", "Parkour", "1.21.4", true],
        ]
    );
    assert.strictEqual(fs.readFileSync(path.join(saves(inst), "Skyblock (2)", "region", "r.0.0.mca"), "utf8"), "region");
    assert.ok(!fs.readdirSync(saves(inst)).some((n) => n.startsWith(".importing")), "no half-built folder is left");
});

test("a world at the top of a zip is named for the zip, or the label given", async () => {
    const inst = instance();
    const zip = path.join(inst.folder, "Cool Map.zip");
    await makeZip(zip, { "level.dat": levelDat("Cool", "1.20.1"), "data/raids.dat": "x" });
    assert.deepStrictEqual((await worlds.importZip(inst, zip)).map((w) => w.folder), ["Cool Map"]);
    assert.deepStrictEqual((await worlds.importZip(inst, zip, { label: "From CurseForge" })).map((w) => w.folder), ["From CurseForge"]);
});

test("a zip with no world, or the wrong format, is refused with a reason", async () => {
    const inst = instance();
    const zip = path.join(inst.folder, "pack.zip");
    await makeZip(zip, { "pack.mcmeta": "{}" });
    await assert.rejects(worlds.importZip(inst, zip), /no Minecraft world in that zip/);
    await assert.rejects(worlds.importZip(inst, path.join(inst.folder, "x.mcworld")), /Bedrock Edition/);
    await assert.rejects(worlds.importZip(inst, path.join(inst.folder, "x.rar")), /Only \.zip files/);
});

test("a crafted entry can't climb out of the world's folder", async () => {
    const inst = instance();
    const zip = path.join(inst.folder, "evil.zip");
    // yazl refuses ".." itself, so the name is changed in the finished zip.
    await makeZip(zip, { "W/level.dat": levelDat("W", "1.20.1"), "W/XX/XX/escape.txt": "nope" });
    const bytes = fs.readFileSync(zip);
    fs.writeFileSync(zip, Buffer.from(bytes.toString("latin1").split("W/XX/XX/").join("W/../../"), "latin1"));

    await worlds.importZip(inst, zip);
    assert.ok(!fs.existsSync(path.join(inst.gameDirectory, "escape.txt")));
    assert.ok(!fs.existsSync(path.join(saves(inst), "escape.txt")));
    assert.ok(fs.existsSync(path.join(saves(inst), "W", "level.dat")));
});

test("a folder of worlds is copied in, leaving the originals and their locks", async () => {
    const inst = instance();
    const elsewhere = path.join(inst.folder, "other-launcher", "saves");
    for (const name of ["Alpha", "Beta"]) {
        fs.mkdirSync(path.join(elsewhere, name), { recursive: true });
        fs.writeFileSync(path.join(elsewhere, name, "level.dat"), levelDat(name, "1.20.1"));
        fs.writeFileSync(path.join(elsewhere, name, "session.lock"), "lock");
    }
    fs.mkdirSync(path.join(elsewhere, "not-a-world"));

    const added = await worlds.importFolder(inst, elsewhere);
    assert.deepStrictEqual(added.map((w) => w.folder).sort(), ["Alpha", "Beta"]);
    assert.ok(!fs.existsSync(path.join(saves(inst), "Alpha", "session.lock")));
    assert.ok(fs.existsSync(path.join(elsewhere, "Alpha", "session.lock")));

    await assert.rejects(worlds.importFolder(inst, path.join(saves(inst), "Alpha")), /already in this instance/);
    await assert.rejects(worlds.importFolder(inst, path.join(elsewhere, "not-a-world")), /no Minecraft world in that folder/);
});
