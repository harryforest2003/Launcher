/*
 * The memory and CPU readout of a running game (electron/minecraft/gameUsage.cjs): reading
 * ps and PowerShell listings, counting the processes a game started, and CPU between
 * readings. Offline: the process listings are made up here.
 */
const test = require("node:test");
const assert = require("node:assert");
const gameUsage = require("../electron/minecraft/gameUsage.cjs");

test("CPU times from macOS, Linux and plain seconds", () => {
    assert.strictEqual(gameUsage.parseCpuTime("0:12.50"), 12.5);
    assert.strictEqual(gameUsage.parseCpuTime("62:03.45"), 62 * 60 + 3.45);
    assert.strictEqual(gameUsage.parseCpuTime("01:02:03"), 3723);
    assert.strictEqual(gameUsage.parseCpuTime("1-00:00:10"), 86410);
    assert.ok(Number.isNaN(gameUsage.parseCpuTime("")));
    assert.ok(Number.isNaN(gameUsage.parseCpuTime("soon")));
});

test("a game counts the processes it started, and not its neighbours", () => {
    const rows = gameUsage.parsePs(
        [
            "    1     0   1000   0:01.00",
            "  500     1    200   0:00.50", // the wrapper command
            "  501   500 300000   1:30.00", // Java, started by the wrapper
            "  502   501   1000   0:00.10", // something Java started
            "  600     1 900000  10:00.00", // another program
            "not a line",
        ].join("\n")
    );
    assert.strictEqual(rows.length, 5);
    const totals = gameUsage.treeTotals(rows, 500);
    assert.strictEqual(totals.memory, (200 + 300000 + 1000) * 1024);
    assert.strictEqual(Math.round(totals.cpu * 100) / 100, 90.6);
    assert.strictEqual(gameUsage.treeTotals(rows, 999), null);
});

test("PowerShell listings give bytes and 100-nanosecond CPU times", () => {
    const rows = gameUsage.parseWindows("4 0 1000 0\r\n7000 4 2147483648 300000000\r\n\r\n");
    assert.deepStrictEqual(gameUsage.treeTotals(rows, 7000), { memory: 2147483648, cpu: 30 });
});

test("CPU is the share of the whole computer between two readings", async () => {
    assert.strictEqual(gameUsage.cpuShare(null, { cpu: 5, at: 1000 }, 4), null);
    assert.strictEqual(gameUsage.cpuShare({ cpu: 10, at: 0 }, { cpu: 12, at: 1000 }, 4), 50);
    assert.strictEqual(gameUsage.cpuShare({ cpu: 10, at: 0 }, { cpu: 30, at: 1000 }, 4), 100);

    let cpu = "0:10.00";
    let clock = 0;
    const list = async () => gameUsage.parsePs(`  800     1 2097152   ${cpu}`);
    const first = await gameUsage.usage(800, { list, now: () => clock, cores: 8 });
    assert.deepStrictEqual(first, { memory: 2 * 1024 * 1024 * 1024, cpu: null });
    cpu = "0:14.00";
    clock = 2000;
    const second = await gameUsage.usage(800, { list, now: () => clock, cores: 8 });
    assert.strictEqual(second.cpu, 25);
    assert.strictEqual(await gameUsage.usage(801, { list, now: () => clock, cores: 8 }), null);
    assert.strictEqual(await gameUsage.usage(0, { list }), null);
});
