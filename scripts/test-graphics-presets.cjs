/*
 * ENB and ReShade presets installed as mods (electron/games/layouts.cjs "presetPlan"): their
 * files go beside the game's exe, and ENB's own DLLs are left to the game's Tools page.
 */
const test = require("node:test");
const assert = require("node:assert");
const layouts = require("../electron/games/layouts.cjs");
const { getGame } = require("../electron/games/registry.cjs");

function plan(gameId, files) {
    const result = layouts.plan(getGame(gameId), files, { modName: "Preset", gameHas: () => false, listGame: () => [], hasGameDir: false });
    return {
        ...result,
        to: Object.fromEntries(result.placements.map((p) => [p.from, `${p.base}:${p.to}`])),
        skip: result.skipped.map((s) => s.file).sort(),
    };
}

test("a Skyrim ENB preset: settings at the game's root, its plugin in Data, ENB's DLL left out", () => {
    const r = plan("skyrimse", [
        "Rudy ENB/enbseries.ini",
        "Rudy ENB/enblocal.ini",
        "Rudy ENB/enbseries/effect.txt",
        "Rudy ENB/Data/Rudy.esp",
        "Rudy ENB/d3d11.dll",
        "Rudy ENB/readme.txt",
    ]);
    assert.deepStrictEqual(r.to, {
        "Rudy ENB/enbseries.ini": "game:enbseries.ini",
        "Rudy ENB/enblocal.ini": "game:enblocal.ini",
        "Rudy ENB/enbseries/effect.txt": "game:enbseries/effect.txt",
        "Rudy ENB/Data/Rudy.esp": "game:Data/Rudy.esp",
    });
    assert.deepStrictEqual(r.skip, ["Rudy ENB/d3d11.dll"]);
    assert.deepStrictEqual(r.plugins, ["Rudy.esp"]);
});

test("an MO2-style Root folder goes to the game's root; the rest to Data", () => {
    const r = plan("skyrimse", ["M/Root/enbseries.ini", "M/Root/dxgi.dll", "M/Root/enbseries/a.fx", "M/meshes/a.nif"]);
    assert.deepStrictEqual(r.to, {
        "M/Root/enbseries.ini": "game:enbseries.ini",
        "M/Root/enbseries/a.fx": "game:enbseries/a.fx",
        "M/meshes/a.nif": "game:Data/meshes/a.nif",
    });
    assert.deepStrictEqual(r.skip, ["M/Root/dxgi.dll"]);
});

test("a folder called root inside textures stays in Data", () => {
    const r = plan("skyrimse", ["T/textures/root/x.dds"]);
    assert.deepStrictEqual(r.to, { "T/textures/root/x.dds": "game:Data/textures/root/x.dds" });
});

test("a GTA V preset with ReShade shaders and its preset .ini goes beside the exe", () => {
    const r = plan("gtav", ["P/enbseries.ini", "P/enblocal.ini", "P/enbseries/x.fx", "P/reshade-shaders/Shaders/a.fx", "P/MyLook.ini"]);
    assert.deepStrictEqual(r.to, {
        "P/enbseries.ini": "game:enbseries.ini",
        "P/enblocal.ini": "game:enblocal.ini",
        "P/enbseries/x.fx": "game:enbseries/x.fx",
        "P/reshade-shaders/Shaders/a.fx": "game:reshade-shaders/Shaders/a.fx",
        "P/MyLook.ini": "game:MyLook.ini",
    });
    assert.deepStrictEqual(r.skip, []);
});

test("a plain Skyrim mod with an .ini isn't taken for a preset", () => {
    const r = plan("skyrimse", ["Mod/MyMod.esp", "Mod/MyMod.ini"]);
    assert.deepStrictEqual(r.to, { "Mod/MyMod.esp": "game:Data/MyMod.esp", "Mod/MyMod.ini": "game:Data/MyMod.ini" });
});
