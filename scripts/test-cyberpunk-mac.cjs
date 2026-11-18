const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const layouts = require("../electron/games/layouts.cjs");
const mac = require("../electron/games/mac.cjs");
const { looksLikeGame } = require("../electron/games/detect.cjs");
const { getGame } = require("../electron/games/registry.cjs");

const game = getGame("cyberpunk2077");
const made = [];
const temp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unity-cp-test-"));
    made.push(dir);
    return dir;
};
test.after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

/* A Mac app whose program is a Mach-O header for the given CPU types (thin for one, fat for more). */
function fakeApp(dir, cpus) {
    const macos = path.join(dir, "Cyberpunk2077.app", "Contents", "MacOS");
    fs.mkdirSync(macos, { recursive: true });
    let header;
    if (cpus.length === 1) {
        header = Buffer.alloc(32);
        header.writeUInt32LE(0xfeedfacf, 0);
        header.writeUInt32LE(cpus[0], 4);
    } else {
        header = Buffer.alloc(8 + cpus.length * 20);
        header.writeUInt32BE(0xcafebabe, 0);
        header.writeUInt32BE(cpus.length, 4);
        cpus.forEach((cpu, i) => header.writeUInt32BE(cpu, 8 + i * 20));
    }
    fs.writeFileSync(path.join(macos, "Cyberpunk2077"), header);
    return dir;
}

const files = [
    "Cool/archive/pc/mod/cool.archive",
    "Cool/archive/pc/mod/cool.xl",
    "Cool/r6/scripts/Cool/a.reds",
    "Cool/r6/tweaks/Cool/t.yaml",
    "Cool/bin/x64/plugins/cyber_engine_tweaks/mods/Cool/init.lua",
    "Cool/red4ext/plugins/Cool/Cool.dll",
    "Cool/readme.txt",
];

test("on a Mac, archive mods go to archive-loader and Windows-only parts are left out", () => {
    const out = layouts.plan(game, files, { modName: "Cool", dir: "/x", gameHas: () => false, platform: "darwin" });
    assert.deepEqual(out.placements.map((p) => p.to).sort(), ["archive-loader/mods/enabled/cool.archive", "r6/scripts/Cool/a.reds"]);
    assert.equal(out.skipped.length, 4);
    assert.ok(out.skipped.every((s) => /Windows/.test(s.reason)));
    assert.ok(out.notes.some((n) => /redscript for macOS/.test(n)));
    assert.ok(out.notes.some((n) => /archive-loader/.test(n)));
});

test("on Windows, the same mod keeps its usual places", () => {
    const out = layouts.plan(game, files, { modName: "Cool", dir: "/x", gameHas: () => false, platform: "win32" });
    assert.ok(out.placements.some((p) => p.to === "archive/pc/mod/cool.archive"));
    assert.ok(out.placements.some((p) => p.to === "bin/x64/plugins/cyber_engine_tweaks/mods/Cool/init.lua"));
    assert.equal(out.skipped.length, 0);
});

test("the Mac version's folder is recognised", () => {
    const dir = fakeApp(temp(), [0x0100000c]);
    assert.equal(looksLikeGame(game, dir), true);
    assert.equal(looksLikeGame(game, temp()), false);
});

test("a program's architectures are read from its Mach-O header", () => {
    const arm = fakeApp(temp(), [0x0100000c]);
    const universal = fakeApp(temp(), [0x01000007, 0x0100000c]);
    const exe = (dir) => mac.appExecutable(path.join(dir, "Cyberpunk2077.app"));
    assert.deepEqual(mac.archsOf(exe(arm)), ["arm64"]);
    assert.deepEqual(mac.archsOf(exe(universal)), ["x86_64", "arm64"]);
});

test("an Apple-silicon-only app is flagged on an Intel Mac, and only there", { skip: process.platform !== "darwin" }, () => {
    const arm = fakeApp(temp(), [0x0100000c]);
    const intel = fakeApp(temp(), [0x01000007]);
    const problem = mac.runProblem(game, { gameDir: arm });
    if (mac.appleSilicon()) assert.equal(problem, null);
    else assert.match(problem, /only runs on Apple silicon/);
    assert.equal(mac.runProblem(game, { gameDir: intel }), null);
});
