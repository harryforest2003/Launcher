/*
 * Where a mod's files go for games without rules of their own (electron/games/layouts.cjs
 * "generic"): worked out from the download and what the game's folder holds.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const layouts = require("../electron/games/layouts.cjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unity-generic-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/* A stand-in game folder: names ending in "/" are folders. */
function gameDir(name, paths) {
    const root = path.join(tmp, name);
    for (const rel of paths) {
        const full = path.join(root, rel);
        if (rel.endsWith("/")) fs.mkdirSync(full, { recursive: true });
        else {
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, "");
        }
    }
    return root;
}

function plan(root, files, extra = {}) {
    const ctx = {
        modName: "Cool Mod",
        gameHas: (rel) => Boolean(root) && fs.existsSync(path.join(root, rel)),
        listGame: (rel) => {
            try {
                return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() }));
            } catch {
                return [];
            }
        },
        hasGameDir: Boolean(root),
        modsDir: null,
        modsChosen: false,
        ...extra,
    };
    const result = layouts.plan({ name: "Test", layout: "generic" }, files, ctx);
    return { ...result, to: Object.fromEntries(result.placements.map((p) => [p.from, `${p.base}:${p.to}`])) };
}

const unreal = gameDir("Unreal", ["Game.exe", "Engine/", "Pal/Content/Paks/Pal.pak", "Pal/Binaries/Win64/Pal-Win64-Shipping.exe", "Pal/Binaries/Win64/ue4ss/Mods/"]);
const unity = gameDir("Unity", ["game.exe", "game_Data/", "BepInEx/plugins/"]);
const bare = gameDir("Bare", ["game.exe", "game_Data/"]);

test("Unreal .pak files go in Paks/~mods, UE4SS mods in ue4ss/Mods", () => {
    const paks = plan(unreal, ["X/X_P.pak", "X/X_P.utoc", "X/X_P.ucas", "X/readme.txt"]);
    assert.deepStrictEqual(paks.to, {
        "X/X_P.pak": "game:Pal/Content/Paks/~mods/X_P.pak",
        "X/X_P.utoc": "game:Pal/Content/Paks/~mods/X_P.utoc",
        "X/X_P.ucas": "game:Pal/Content/Paks/~mods/X_P.ucas",
    });
    assert.strictEqual(plan(unreal, ["S/LogicMods/BP_P.pak"]).to["S/LogicMods/BP_P.pak"], "game:Pal/Content/Paks/LogicMods/BP_P.pak");
    const lua = plan(unreal, ["M/Scripts/main.lua", "M/enabled.txt"]);
    assert.strictEqual(lua.to["M/Scripts/main.lua"], "game:Pal/Binaries/Win64/ue4ss/Mods/M/Scripts/main.lua");
    assert.strictEqual(lua.to["M/enabled.txt"], "game:Pal/Binaries/Win64/ue4ss/Mods/M/enabled.txt");
});

test("a new loader goes beside the game's real program", () => {
    const ue4ss = plan(unreal, ["dwmapi.dll", "ue4ss/UE4SS.dll"]);
    assert.strictEqual(ue4ss.to["dwmapi.dll"], "game:Pal/Binaries/Win64/dwmapi.dll");
    assert.strictEqual(ue4ss.to["ue4ss/UE4SS.dll"], "game:Pal/Binaries/Win64/ue4ss/UE4SS.dll");
    const bepinex = plan(bare, ["Pack/BepInEx/core/BepInEx.dll", "Pack/winhttp.dll", "Pack/doorstop_config.ini"]);
    assert.deepStrictEqual(Object.values(bepinex.to), ["game:BepInEx/core/BepInEx.dll", "game:winhttp.dll", "game:doorstop_config.ini"]);
});

test("BepInEx plugins keep their files together; Thunderstore details stay out", () => {
    const loose = plan(unity, ["CoolMod/CoolMod.dll", "CoolMod/assets/a.json"]);
    assert.strictEqual(loose.to["CoolMod/CoolMod.dll"], "game:BepInEx/plugins/Cool Mod/CoolMod.dll");
    assert.strictEqual(loose.to["CoolMod/assets/a.json"], "game:BepInEx/plugins/Cool Mod/assets/a.json");
    const shaped = plan(unity, ["P/BepInEx/plugins/C/C.dll", "P/manifest.json"]);
    assert.strictEqual(shaped.to["P/BepInEx/plugins/C/C.dll"], "game:BepInEx/plugins/C/C.dll");
    assert.strictEqual(shaped.to["P/manifest.json"], undefined);
});

test(".asi, REFramework and Source files go where those games load them", () => {
    const asi = plan(gameDir("Asi", ["game.exe", "scripts/"]), ["T/T.asi", "T/T.ini"]);
    assert.deepStrictEqual(Object.values(asi.to), ["game:scripts/T.asi", "game:scripts/T.ini"]);
    assert.match(plan(bare, ["Fix.asi"]).notes.join(" "), /ASI Loader/);
    assert.strictEqual(plan(gameDir("Re", ["re.exe", "reframework/autorun/"]), ["cool.lua"]).to["cool.lua"], "game:reframework/autorun/cool.lua");
    assert.strictEqual(plan(gameDir("Src", ["hl2.exe", "tf/gameinfo.txt", "tf/custom/"]), ["hud.vpk"]).to["hud.vpk"], "game:tf/custom/hud.vpk");
});

test("anything else needs the mods folder, which wins when chosen", () => {
    const none = plan(bare, ["T/a.dds", "T/b.dds"]);
    assert.strictEqual(none.placements.length, 0);
    assert.strictEqual(none.skipped.length, 2);
    assert.deepStrictEqual(Object.values(plan(bare, ["T/a.dds", "T/b.dds"], { modsDir: "/x/Mods" }).to), ["mods:T/a.dds", "mods:T/b.dds"]);
    assert.strictEqual(plan(unreal, ["X/X_P.pak"], { modsDir: "/x/Mine", modsChosen: true }).to["X/X_P.pak"], "mods:X_P.pak");
    assert.strictEqual(plan(null, ["a.pak"], { modsDir: "/x/Mods" }).to["a.pak"], "mods:a.pak");
});
