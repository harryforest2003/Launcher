/*
 * The malware check (electron/minecraft/safetyCheck.cjs): what it finds in class files,
 * in jars and the jars they bundle, and fractureiser's leftovers on a computer. Offline:
 * the "classes" are byte strings and the jars and home folders are made here.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const yazl = require("yazl");
const safety = require("../electron/minecraft/safetyCheck.cjs");

function makeZip(entries) {
    return new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        for (const [name, data] of Object.entries(entries)) zip.addBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data), name);
        zip.end();
        const chunks = [];
        zip.outputStream.on("data", (chunk) => chunks.push(chunk)).on("end", () => resolve(Buffer.concat(chunks))).on("error", reject);
    });
}

const levels = (found) => found.map((finding) => finding.level);

test("an ordinary class finds nothing", () => {
    const plain = Buffer.from("\xca\xfe\xba\xbe net/minecraft/world/level/Level java/lang/String java/util/List getBlockState");
    assert.deepStrictEqual(safety.scanClass(plain), []);
});

test("fractureiser's addresses are dangerous on their own", () => {
    const found = safety.scanClass(Buffer.from("http://85.217.144.130:8080/dl"));
    assert.deepStrictEqual(levels(found), ["danger"]);
});

test("loading code from the internet is a warning, with hidden text named", () => {
    const loads = safety.scanClass(Buffer.from("java/net/URLClassLoader java/net/URL"));
    assert.deepStrictEqual(levels(loads), ["warning"]);
    assert.match(loads[0].text, /internet/);

    const hidden = safety.scanClass(Buffer.from("java/net/URLClassLoader java/net/URL java/lang/String ([B)V java/lang/reflect/Method"));
    assert.deepStrictEqual(levels(hidden), ["warning"]);
    assert.match(hidden[0].text, /fractureiser/);
});

test("a token grabber is dangerous; a webhook alone is a warning", () => {
    assert.deepStrictEqual(levels(safety.scanClass(Buffer.from("https://discord.com/api/webhooks/1/x Local Storage/leveldb"))), ["danger"]);
    assert.deepStrictEqual(levels(safety.scanClass(Buffer.from("https://discord.com/api/webhooks/1/x"))), ["warning"]);
});

test("running programs needs going online too", () => {
    assert.deepStrictEqual(safety.scanClass(Buffer.from("java/lang/Runtime \u0000\u0007execute java/net/URL")), []);
    assert.deepStrictEqual(safety.scanClass(Buffer.from("java/lang/ProcessBuilder \u0000\u0004exec")), []);
    assert.deepStrictEqual(levels(safety.scanClass(Buffer.from("java/lang/ProcessBuilder \u0000\u0004exec java/net/URL"))), ["warning"]);
});

test("a jar is read with the jars it bundles, each finding once", async () => {
    const inner = await makeZip({ "a/Stage0.class": "107.189.3.101", "a/Other.class": "107.189.3.101" });
    const outer = await makeZip({ "fabric.mod.json": "{}", "x/Main.class": "net/minecraft/Foo", "META-INF/jars/lib.jar": inner });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unity-safety-test-"));
    const jar = path.join(dir, "mod.jar");
    fs.writeFileSync(jar, outer);
    try {
        const found = await safety.scanJar(jar);
        assert.strictEqual(found.length, 1);
        assert.strictEqual(found[0].level, "danger");
        assert.match(found[0].where, /^META-INF\/jars\/lib\.jar!\/a\/(Stage0|Other)\.class$/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("a file that isn't a zip is a warning, not a crash", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unity-safety-test-"));
    const jar = path.join(dir, "broken.jar");
    fs.writeFileSync(jar, "not a zip");
    try {
        assert.deepStrictEqual(levels(await safety.scanJar(jar)), ["warning"]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("fractureiser's leftovers are found in a stand-in home folder", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "unity-safety-home-"));
    try {
        assert.deepStrictEqual(safety.checkSystem({ home, platform: "linux" }).filter((f) => f.path.startsWith(home)), []);
        fs.mkdirSync(path.join(home, ".config", ".data"), { recursive: true });
        fs.writeFileSync(path.join(home, ".config", ".data", "lib.jar"), "x");
        const found = safety.checkSystem({ home, platform: "linux" }).filter((f) => f.path.startsWith(home));
        assert.deepStrictEqual(levels(found), ["danger"]);

        // Windows: a Startup run.bat only counts when it starts fractureiser's jar.
        const env = { LOCALAPPDATA: path.join(home, "Local"), APPDATA: path.join(home, "Roaming") };
        const startup = path.join(env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
        fs.mkdirSync(startup, { recursive: true });
        fs.writeFileSync(path.join(startup, "run.bat"), "@echo off\nstart steam.exe");
        assert.deepStrictEqual(safety.checkSystem({ home, env, platform: "win32" }), []);
        fs.writeFileSync(path.join(startup, "run.bat"), 'javaw -jar "%LOCALAPPDATA%\\Microsoft Edge\\libWebGL64.jar"');
        assert.deepStrictEqual(levels(safety.checkSystem({ home, env, platform: "win32" })), ["danger"]);
        assert.deepStrictEqual(safety.checkSystem({ home, platform: "darwin" }), []);
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
});
