/*
 * Which games have a load order that matters, and reading and setting each kind
 * (electron/games/plugins.cjs for Bethesda's, electron/games/modorder.cjs for the rest).
 * Everything happens in stand-in folders: HOME and the launcher's data point at a temporary one.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unity-order-"));
process.env.UNITY_GAMES_DATA = path.join(tmp, "data");
process.env.HOME = path.join(tmp, "home");
process.env.USERPROFILE = process.env.HOME;
delete process.env.LOCALAPPDATA;
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const plugins = require("../electron/games/plugins.cjs");
const modorder = require("../electron/games/modorder.cjs");
const custom = require("../electron/games/custom.cjs");

function put(file, text = "") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
}
const lines = (file) => fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);

// A CrossOver bottle, where Windows games keep plugins.txt in AppData/Local.
const bottle = path.join(tmp, "bottle", "drive_c");
const local = path.join(bottle, "users", "crossover", "AppData", "Local");
const inBottle = (name) => path.join(bottle, "Program Files (x86)", "Steam", "steamapps", "common", name);

test("Bethesda's other games are found by Nexus site, Steam app or name", () => {
    assert.strictEqual(modorder.bethesdaFor({ name: "Whatever", nexus: "newvegas" }, custom.keyFor).format, "dates");
    assert.strictEqual(modorder.bethesdaFor({ name: "Whatever", steamAppIds: ["611670"] }, custom.keyFor).loot, "skyrimse");
    assert.strictEqual(modorder.bethesdaFor({ name: "The Elder Scrolls IV: Oblivion" }, custom.keyFor).extender.name, "OBSE");
    assert.strictEqual(modorder.bethesdaFor({ name: "Stardew Valley", nexus: "stardewvalley", steamAppIds: ["413150"] }, custom.keyFor), null);
    const loot = require("../electron/games/loot.cjs");
    assert.strictEqual(loot.repoFor({ id: "skyrimvr-x", bethesda: { loot: "skyrimse" } }), "skyrimse");
    assert.strictEqual(loot.repoFor({ id: "fallout4", bethesda: {} }), "fallout4");
});

test("Skyrim before Special Edition: plugins.txt lists what's on, loadorder.txt the order", () => {
    const gameDir = inBottle("Skyrim");
    for (const name of ["Skyrim.esm", "Update.esm", "A.esp", "B.esp", "C.esp"]) put(path.join(gameDir, "Data", name));
    put(path.join(local, "Skyrim", "plugins.txt"), "# made by hand\r\nB.esp\r\nA.esp\r\n");
    put(path.join(local, "Skyrim", "loadorder.txt"), "Skyrim.esm\r\nUpdate.esm\r\nA.esp\r\nC.esp\r\nB.esp\r\n");
    const game = { id: "skyrim", name: "Skyrim", bethesda: modorder.bethesdaFor({ name: "Skyrim", nexus: "skyrim" }, custom.keyFor) };
    const loc = { gameDir };
    const order = plugins.loadOrder(game, loc);
    assert.deepStrictEqual(order.fixed, ["Skyrim.esm", "Update.esm"]);
    // The on ones in plugins.txt's order, in the slots loadorder.txt gives them.
    assert.deepStrictEqual(order.plugins.map((p) => `${p.active ? "+" : "-"}${p.name}`), ["+B.esp", "-C.esp", "+A.esp"]);
    plugins.setOrder(game, loc, [{ name: "C.esp", active: true }, { name: "A.esp", active: true }, { name: "B.esp", active: false }]);
    assert.deepStrictEqual(lines(path.join(local, "Skyrim", "plugins.txt")), ["# made by hand", "C.esp", "A.esp"]);
    assert.deepStrictEqual(lines(path.join(local, "Skyrim", "loadorder.txt")), ["Skyrim.esm", "Update.esm", "C.esp", "A.esp", "B.esp"]);
});

test("Oblivion and the older Fallouts: the order is the plugin files' dates", () => {
    const gameDir = inBottle("Fallout New Vegas");
    const data = path.join(gameDir, "Data");
    const stamp = (name, minute) => {
        const at = new Date(Date.UTC(2012, 0, 1, 0, minute));
        fs.utimesSync(put(path.join(data, name)), at, at);
    };
    stamp("FalloutNV.esm", 0);
    stamp("Z.esp", 1);
    stamp("Y.esp", 2);
    stamp("X.esp", 3);
    put(path.join(local, "FalloutNV", "plugins.txt"), "FalloutNV.esm\r\nZ.esp\r\nX.esp\r\n");
    const game = { id: "nv", name: "New Vegas", bethesda: modorder.bethesdaFor({ name: "x", nexus: "newvegas" }, custom.keyFor) };
    const loc = { gameDir };
    assert.deepStrictEqual(plugins.loadOrder(game, loc).plugins.map((p) => `${p.active ? "+" : "-"}${p.name}`), ["+Z.esp", "-Y.esp", "+X.esp"]);
    plugins.setOrder(game, loc, [{ name: "X.esp", active: true }, { name: "Y.esp", active: true }, { name: "Z.esp", active: false }]);
    // The game's own plugins are listed too in these games.
    assert.deepStrictEqual(lines(path.join(local, "FalloutNV", "plugins.txt")), ["FalloutNV.esm", "X.esp", "Y.esp"]);
    const time = (name) => fs.statSync(path.join(data, name)).mtimeMs;
    assert.ok(time("FalloutNV.esm") < time("X.esp") && time("X.esp") < time("Y.esp") && time("Y.esp") < time("Z.esp"));
    assert.deepStrictEqual(plugins.loadOrder(game, loc).plugins.map((p) => `${p.active ? "+" : "-"}${p.name}`), ["+X.esp", "+Y.esp", "-Z.esp"]);
});

test("which games get a mod order, and which don't", () => {
    const cyber = inBottle("Cyberpunk 2077");
    put(path.join(cyber, "archive", "pc", "content", "basegame_1_engine.archive"));
    assert.strictEqual(modorder.kindOf({ id: "x", name: "Cyberpunk 2077" }, { gameDir: cyber }), "modlist");
    assert.strictEqual(modorder.kindOf({ id: "skyrimse", bethesda: {} }, { gameDir: null }), "plugins");
    assert.strictEqual(modorder.kindOf({ id: "x", nexus: "rimworld" }, { gameDir: null }), "rimworld");
    assert.strictEqual(modorder.kindOf({ id: "x", steamAppIds: ["1086940"] }, { gameDir: null }), "bg3");
    assert.strictEqual(modorder.kindOf({ id: "x", nexus: "stardewvalley", steamAppIds: ["413150"] }, { gameDir: null }), null);
    if (process.platform === "darwin") {
        // The Mac version loads archives through archive-loader, which has no order.
        assert.strictEqual(modorder.kindOf({ id: "cyberpunk2077", layout: "cyberpunk" }, { gameDir: path.join(tmp, "Cyberpunk 2077") }), null);
    }
});

test("Cyberpunk: modlist.txt sets which archive wins, the rest load by name", () => {
    const gameDir = inBottle("Cyberpunk 2077");
    const mod = path.join(gameDir, "archive", "pc", "mod");
    for (const name of ["b.archive", "a.archive", "c.archive", "readme.txt"]) put(path.join(mod, name));
    put(path.join(mod, "modlist.txt"), "c.archive\r\ngone.archive\r\n");
    const game = { id: "cp-test", name: "Cyberpunk 2077", layout: "cyberpunk" };
    const loc = { gameDir };
    assert.deepStrictEqual(modorder.read(game, loc).entries.map((e) => e.id), ["c.archive", "a.archive", "b.archive"]);
    const after = modorder.write(game, loc, [{ id: "b.archive" }, { id: "c.archive" }]);
    assert.deepStrictEqual(after.entries.map((e) => e.id), ["b.archive", "c.archive", "a.archive"]);
    assert.deepStrictEqual(lines(path.join(mod, "modlist.txt")), ["b.archive", "c.archive", "a.archive"]);
});

const about = (id, name, extra = "") => `<?xml version="1.0" encoding="utf-8"?>\n<ModMetaData>\n  <name>${name}</name>\n  <packageId>${id}</packageId>\n${extra}</ModMetaData>\n`;

test("RimWorld: problems from About.xml, turning mods on and off, and Fix order", () => {
    const steam = path.join(tmp, "steam", "steamapps");
    const gameDir = path.join(steam, "common", "RimWorld");
    put(path.join(gameDir, "Data", "Core", "About", "About.xml"), about("Ludeon.RimWorld", "Core"));
    put(path.join(gameDir, "Mods", "Harmony", "About", "About.xml"), about("brrainz.harmony", "Harmony", "  <loadBefore><li>Ludeon.RimWorld</li></loadBefore>\n"));
    put(
        path.join(steam, "workshop", "content", "294100", "818773962", "About", "About.xml"),
        about("UnlimitedHugs.HugsLib", "HugsLib", "  <modDependencies><li><packageId>brrainz.harmony</packageId><displayName>Harmony</displayName></li></modDependencies>\n  <loadAfter><li>brrainz.harmony</li></loadAfter>\n")
    );
    put(
        path.join(gameDir, "Mods", "Doors", "About", "About.xml"),
        about("jecrell.doorsexpanded", "Doors Expanded", "  <modDependencies><li><packageId>UnlimitedHugs.HugsLib</packageId><displayName>HugsLib</displayName></li></modDependencies>\n")
    );
    const game = { id: "rimworld-test", name: "RimWorld", nexus: "rimworld" };
    const loc = { gameDir };

    // Before RimWorld has started once there's no list to change.
    assert.strictEqual(modorder.read(game, loc).file, null);
    assert.throws(() => modorder.write(game, loc, []), /Start it once/);

    const config = put(
        modorder.rimworldConfig(),
        `<?xml version="1.0" encoding="utf-8"?>\n<ModsConfigData>\n  <version>1.5.4104 rev435</version>\n  <activeMods>\n    <li>ludeon.rimworld</li>\n    <li>jecrell.doorsexpanded</li>\n    <li>brrainz.harmony</li>\n  </activeMods>\n  <knownExpansions />\n</ModsConfigData>\n`
    );
    const order = modorder.read(game, loc);
    assert.deepStrictEqual(order.entries.map((e) => `${e.active ? "+" : "-"}${e.name}`), ["+Core", "+Doors Expanded", "+Harmony", "-HugsLib"]);
    assert.ok(order.entries[0].fixed);
    assert.deepStrictEqual(order.entries[1].problems, ["Needs HugsLib, which is turned off"]);
    assert.deepStrictEqual(order.entries[2].problems, ["Should load before Core"]);
    assert.deepStrictEqual(order.fix.turnOn, ["HugsLib"]);
    assert.strictEqual(modorder.problems(game, loc), 2);

    const fixed = modorder.fix(game, loc);
    assert.deepStrictEqual(fixed.entries.filter((e) => e.active).map((e) => e.name), ["Harmony", "Core", "HugsLib", "Doors Expanded"]);
    assert.strictEqual(modorder.problems(game, loc), 0);
    const text = fs.readFileSync(config, "utf8");
    assert.match(text, /<activeMods>\n    <li>brrainz\.harmony<\/li>\n    <li>ludeon\.rimworld<\/li>\n    <li>unlimitedhugs\.hugslib<\/li>\n    <li>jecrell\.doorsexpanded<\/li>\n  <\/activeMods>\n  <knownExpansions \/>/);

    // Core can't be turned off.
    const off = modorder.write(game, loc, [{ id: "ludeon.rimworld", active: false }, { id: "brrainz.harmony", active: false }]);
    assert.deepStrictEqual(off.entries.filter((e) => e.active).map((e) => e.name), ["Core"]);
});

test("Baldur's Gate 3: mods move in modsettings.lsx, the game's own stay first", () => {
    const gameDir = path.join(tmp, "steam", "steamapps", "common", "Baldurs Gate 3");
    put(path.join(gameDir, "Data", "Gustav.pak"));
    const desc = (folder, name, uuid) => `            <node id="ModuleShortDesc">
              <attribute id="Folder" type="LSString" value="${folder}"/>
              <attribute id="Name" type="LSString" value="${name}"/>
              <attribute id="UUID" type="guid" value="${uuid}"/>
            </node>`;
    const module = (uuid) => `            <node id="Module">
              <attribute id="UUID" type="FixedString" value="${uuid}"/>
            </node>`;
    const file = put(
        modorder.bg3File({ gameDir }),
        `<?xml version="1.0" encoding="UTF-8"?>
<save>
  <region id="ModuleSettings">
    <node id="root">
      <children>
        <node id="ModOrder">
          <children>
${module("u-a")}
${module("u-b")}
          </children>
        </node>
        <node id="Mods">
          <children>
${desc("GustavDev", "GustavDev", "u-gustav")}
${desc("ModA", "Mod A", "u-a")}
${desc("ModB", "Mod B", "u-b")}
          </children>
        </node>
      </children>
    </node>
  </region>
</save>
`
    );
    const game = { id: "bg3-test", name: "Baldur's Gate 3" };
    const loc = { gameDir };
    assert.strictEqual(modorder.kindOf(game, loc), "bg3");
    const order = modorder.read(game, loc);
    assert.deepStrictEqual(order.entries.map((e) => `${e.fixed ? "!" : ""}${e.name}`), ["!GustavDev", "Mod A", "Mod B"]);
    // Asking for a mod above the game's own still leaves those first.
    modorder.write(game, loc, [{ id: "u-b" }, { id: "u-gustav" }, { id: "u-a" }]);
    const text = fs.readFileSync(file, "utf8");
    const at = (value) => text.indexOf(`value="${value}"`);
    assert.ok(at("GustavDev") < at("ModB") && at("ModB") < at("ModA"));
    const modOrder = text.slice(text.indexOf('id="ModOrder"'), text.indexOf('id="Mods"'));
    assert.ok(modOrder.indexOf("u-b") < modOrder.indexOf("u-a"));
    assert.deepStrictEqual(modorder.read(game, loc).entries.map((e) => e.name), ["GustavDev", "Mod B", "Mod A"]);
});
