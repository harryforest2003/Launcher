const test = require("node:test");
const assert = require("node:assert/strict");
const { createLaunchReservations } = require("../electron/minecraft/launchReservations.cjs");

test("different instances and accounts can prepare at the same time", () => {
    const locks = createLaunchReservations();
    const first = locks.reserve("Fabric", "alice");
    const second = locks.reserve("Modpack", "bob");
    assert.throws(() => locks.reserve("Other", "alice"), /account is preparing/);
    assert.throws(() => locks.reserve("Fabric", "charlie"), /already preparing/);
    first(); second();
    locks.reserve("Fabric", "bob")();
});

test("failed authentication releases the reservation for retry", async () => {
    const locks = createLaunchReservations();
    const release = locks.reserve("Fabric", "alice");
    try { await Promise.reject(new Error("expired sign-in")); } catch {} finally { release(); }
    locks.reserve("Fabric", "alice")();
});

test("releasing an older request twice cannot unlock a new launch", () => {
    const locks = createLaunchReservations();
    const old = locks.reserve("Fabric", "alice");
    old();
    const current = locks.reserve("Fabric", "alice");
    old();
    assert.throws(() => locks.reserve("Other", "alice"));
    current();
});

test("offline instances still reserve their folders independently", () => {
    const locks = createLaunchReservations();
    locks.reserve("One", null);
    locks.reserve("Two", null);
    assert.throws(() => locks.reserve("One", null));
});
