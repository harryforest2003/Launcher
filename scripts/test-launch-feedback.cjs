const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness({ backup = async () => null, open = async () => {}, target = "steam://rungameid/1222670" } = {}) {
    const handlers = new Map();
    const stages = [];
    const modules = {
        electron: { ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, shell: { openExternal: open } },
        "./registry.cjs": { getGame: (id) => id === "sims4" ? { id } : null },
        "./queue.cjs": { start() {} },
        "./detect.cjs": { locate: () => ({ gameDir: "C:/Steam/steamapps/common/The Sims 4" }) },
        "./protect.cjs": { lastPlayed: () => null },
        "./store.cjs": { readState: () => ({}) },
        "./finder.cjs": { read: () => null },
        "./saves.cjs": { backup },
        "./launch.cjs": { launch: async (_game, _loc, options) => { await options.open(target); return { how: "Steam", safe: false }; } },
    };
    // The real link checks, opening through the mocked shell.
    const security = { module: { exports: {} }, require: (id) => (id === "electron" ? { ...modules.electron, app: { isPackaged: true, on() {} }, protocol: { registerSchemesAsPrivileged() {} } } : require(id)), console, URL, __dirname: path.join(__dirname, "../electron"), process };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../electron/security.cjs"), "utf8"), security);
    modules["../security.cjs"] = security.module.exports;
    const context = { require: (id) => modules[id] ?? {}, module: { exports: {} }, console };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../electron/games/ipc.cjs"), "utf8"), context);
    context.module.exports.registerGamesIpc();
    const event = { sender: { isDestroyed: () => false, send: (_channel, value) => stages.push(value.stage) } };
    return { run: () => handlers.get("games:launch")(event, "sims4", {}), stages };
}

test("OS handoff failure rejects and releases the launch lock for retry", async () => {
    let attempts = 0;
    const app = harness({ open: async () => { if (++attempts === 1) throw new Error("Steam is unavailable"); } });
    await assert.rejects(app.run(), /Steam is unavailable/);
    assert.equal((await app.run()).how, "Steam");
    assert.deepEqual(app.stages, ["checking", "backup", "starting", "checking", "backup", "starting"]);
});

test("pending backup prevents duplicate launches", async () => {
    let finish;
    let launches = 0;
    const app = harness({ backup: () => new Promise((resolve) => { finish = resolve; }), open: async () => { launches++; } });
    const first = app.run();
    await assert.rejects(app.run(), /already in progress/);
    finish(null);
    await first;
    assert.equal(launches, 1);
});

test("backup failure is returned as a warning without claiming a successful backup", async () => {
    const app = harness({ backup: async () => { throw new Error("Disk full"); } });
    const result = await app.run();
    assert.equal(result.backupError, "Disk full");
    assert.equal(result.backedUp, null);
    assert.equal(result.how, "Steam");
});

test("launch handoff rejects non-game Steam links and external URLs", async () => {
    for (const target of ["steam://open/main", "https://example.com", "steam://rungameid/1?x=2"]) {
        let called = false;
        const app = harness({ target, open: async () => { called = true; } });
        await assert.rejects(app.run(), /Invalid Steam game link/);
        assert.equal(called, false);
    }
});
