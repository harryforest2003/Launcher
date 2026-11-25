/*
 * Shared instances (electron/minecraft/sharedInstances.cjs): turning share links into file
 * links, reading and refusing shared files, and what an update adds and removes. Offline:
 * the shared files are written to a temp folder here.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const shared = require("../electron/minecraft/sharedInstances.cjs");

test("share links from file hosts give the file itself", () => {
    assert.strictEqual(shared.downloadLink("https://www.dropbox.com/scl/fi/abc/SMP.unityshare?rlkey=x&dl=0"), "https://www.dropbox.com/scl/fi/abc/SMP.unityshare?rlkey=x&dl=1");
    assert.strictEqual(shared.downloadLink("https://drive.google.com/file/d/1AbC-d_E/view?usp=sharing"), "https://drive.google.com/uc?export=download&id=1AbC-d_E");
    assert.strictEqual(shared.downloadLink("https://example.com/SMP.unityshare"), "https://example.com/SMP.unityshare");
    assert.throws(() => shared.downloadLink("http://example.com/SMP.unityshare"), /https/);
    assert.throws(() => shared.downloadLink("file:///etc/passwd"), /https/);
});

test("a shared file is read from a path, and anything else is refused", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unity-shared-test-"));
    const write = (name, data) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
        return file;
    };
    const good = { format: shared.FORMAT, id: "abc", revision: 3, updated: "2026-11-25T10:00:00Z", name: "SMP", version: "1.21.1", loader: "fabric", code: "unity1:x" };
    try {
        assert.deepStrictEqual(await shared.readShareFile(write("good.unityshare", good)), good);
        await assert.rejects(shared.readShareFile(path.join(dir, "gone.unityshare")), /no file/);
        await assert.rejects(shared.readShareFile(write("text.unityshare", "hello")), /isn't a shared instance/);
        await assert.rejects(shared.readShareFile(write("other.unityshare", { ...good, format: "something-else" })), /isn't a shared instance/);
        await assert.rejects(shared.readShareFile(write("norev.unityshare", { ...good, revision: 0 })), /revision/);
        await assert.rejects(shared.readShareFile(write("noid.unityshare", { ...good, id: "" })), /id/);
        await assert.rejects(shared.readShareFile(write("nocode.unityshare", { ...good, code: "" })), /nothing/);
        await assert.rejects(shared.readShareFile(write("big.unityshare", "x".repeat(2 * 1024 * 1024 + 1))), /too big/);
        await assert.rejects(shared.readShareFile("  "), /Paste a link/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("an update gets what's new and removes only what the owner took out", () => {
    const file = (fileName, type = "mod") => ({ type, fileName });
    const have = new Set(["mod/sodium.jar", "mod/old-map.jar", "mod/my-own.jar", "shader/bsl.zip"]);
    const has = (f) => have.has(`${f.type}/${f.fileName}`);
    const previous = [file("sodium.jar"), file("old-map.jar"), file("bsl.zip", "shader"), file("deleted-by-me.jar")];
    const next = [file("sodium.jar"), file("new-map.jar"), file("bsl.zip", "shader")];

    const plan = shared.planUpdate(previous, next, has);
    assert.deepStrictEqual(plan.get.map((f) => f.fileName), ["new-map.jar"]);
    // my-own.jar was never shared, and deleted-by-me.jar is already gone: both left alone.
    assert.deepStrictEqual(plan.remove.map((f) => f.fileName), ["old-map.jar"]);

    // A first update after joining with no list of files removes nothing.
    assert.deepStrictEqual(shared.planUpdate(undefined, next, has).remove, []);
});

test("moving to another Minecraft version or loader is named, a loader update isn't", () => {
    const instance = { version: "1.21.1", loader: "fabric" };
    assert.strictEqual(shared.movedTo(instance, { version: "1.21.1", loader: "fabric" }), null);
    assert.strictEqual(shared.movedTo(instance, { version: "1.21.4", loader: "fabric" }), "Minecraft 1.21.4 with Fabric");
    assert.strictEqual(shared.movedTo(instance, { version: "1.21.1", loader: "neoforge" }), "Minecraft 1.21.1 with NeoForge");
    assert.strictEqual(shared.movedTo({ version: "1.20.1", loader: "" }, { version: "1.20.1", loader: "vanilla" }), null);
    assert.strictEqual(shared.movedTo(instance, { version: "1.21.1", loader: "vanilla" }), "Minecraft 1.21.1");
});

test("the first publish suggests a synced folder, or nothing without one", () => {
    const suggested = shared.suggestedPath("My: SMP", [{ id: "dropbox", label: "Dropbox", path: "/Users/x/Dropbox" }]);
    assert.strictEqual(suggested, path.join("/Users/x/Dropbox", "Unity Launcher", "Shared", "My- SMP.unityshare"));
    assert.strictEqual(shared.suggestedPath("SMP", []), "");
});
