const fs = require("fs");
const path = require("path");
const { homes } = require("./saves.cjs");
const protect = require("./protect.cjs");

/*
 * What each game (or its mod tools) wrote down when something went wrong, naming the mods
 * involved where it can:
 *  - The Sims 4: its lastException files;
 *  - Skyrim: Crash Logger and Trainwreck logs (SKSE), .NET Script Framework crash files;
 *  - Fallout 4: Buffout 4 logs (F4SE);
 *  - GTA V: Script Hook V's log (which says when it's out of date for the game) and
 *    Script Hook V .NET's;
 *  - Cyberpunk 2077: redscript's, RED4ext's and Cyber Engine Tweaks' logs;
 *  - Stardew Valley: SMAPI's log.
 * -> [{ file, time, mods: [names], line, kind: "crash" | "error" | "outdated" }], newest first.
 */

const statTime = (file) => {
    try {
        return fs.statSync(file).mtimeMs;
    } catch {
        return 0;
    }
};

const read = (file, max = 400 * 1024) => {
    try {
        const fd = fs.openSync(file, "r");
        const size = fs.fstatSync(fd).size;
        const buffer = Buffer.alloc(Math.min(size, max));
        fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
        fs.closeSync(fd);
        return buffer.toString("utf8");
    } catch {
        return "";
    }
};

const filesIn = (dir, pattern) => {
    try {
        return fs.readdirSync(dir).filter((name) => pattern.test(name)).map((name) => path.join(dir, name));
    } catch {
        return [];
    }
};

const unique = (list) => [...new Set(list.filter(Boolean))];

/* The game's own files and Windows' are never the mod to blame. */
const SYSTEM_DLL = /^(skyrimse|skyrimvr|fallout4|kernel32|kernelbase|ntdll|ucrtbase|msvcp\d*|vcruntime\d*|user32|d3d11|dxgi|nvwgf2umx|amdxx64|atidxx64|steam_api64|binkw64|bink2w64|xinput1_3|gdi32|win32u|combase|ole32|sksevr_\w*|skse64_\d\w*|f4se_\d\w*|crashlogger|trainwreck|buffout4)\.(exe|dll)$/i;

/* Crash Logger / Trainwreck / Buffout 4: the plugins in "relevant objects" and the DLLs in the call stack. */
function bethesdaLog(file, official) {
    const text = read(file);
    const plugins = [...text.matchAll(/File:\s*"([^"]+\.(?:esp|esm|esl))"/gi), ...text.matchAll(/->\s*([^\s"][^\n"]*?\.(?:esp|esm|esl))\b/gi)].map((m) => m[1].trim());
    const dlls = [...text.matchAll(/(?:^|\s)([^\s\\/]+\.dll)\+[0-9A-F]+/gim)].map((m) => m[1].trim()).filter((name) => !SYSTEM_DLL.test(name));
    const line = text.match(/Unhandled (?:native )?exception[^\n]*/i)?.[0]?.trim() ?? text.match(/^.*(?:EXCEPTION_\w+)[^\n]*/m)?.[0]?.trim() ?? null;
    return { mods: unique([...dlls.slice(0, 4), ...plugins.filter((p) => !official.includes(p.toLowerCase()))]).slice(0, 8), line, kind: "crash" };
}

function sims(game, loc, since) {
    return protect.simsProblems(loc, since).map((p) => ({ ...p, kind: "error" }));
}

function skyrimOrFallout(game, loc, since) {
    const folder = game.id === "fallout4" ? "Fallout4" : "Skyrim Special Edition";
    const extender = game.id === "fallout4" ? "F4SE" : "SKSE";
    const dirs = homes(loc).flatMap((home) =>
        ["Documents", path.join("OneDrive", "Documents")].flatMap((docs) => [
            path.join(home, docs, "My Games", folder, extender),
            path.join(home, docs, "My Games", folder, extender, "Crashlogs"),
            path.join(home, docs, "My Games", `${folder} GOG`, extender),
        ])
    );
    const files = [...dirs.flatMap((dir) => filesIn(dir, /^crash-.*\.log$/i)), ...(loc.gameDir ? filesIn(path.join(loc.gameDir, "Data", "NetScriptFramework", "Crash"), /^Crash_.*\.txt$/i) : [])];
    return files
        .filter((file) => statTime(file) > since)
        .map((file) => ({ file: path.basename(file), time: new Date(statTime(file)).toISOString(), ...bethesdaLog(file, game.bethesda.official) }));
}

function gta(game, loc, since) {
    const out = [];
    if (!loc.gameDir) return out;
    const shv = path.join(loc.gameDir, "ScriptHookV.log");
    if (statTime(shv) > since) {
        const text = read(shv);
        if (/unknown game version/i.test(text)) {
            out.push({ file: "ScriptHookV.log", time: new Date(statTime(shv)).toISOString(), mods: ["Script Hook V"], line: "Script Hook V doesn't know this version of GTA V yet: it needs updating (dev-c.com), and script mods won't load until it is.", kind: "outdated" });
        } else {
            const failed = [...text.matchAll(/(?:failed|error)[^\n]*?([\w .-]+\.asi)/gi)].map((m) => m[1].trim());
            if (failed.length) out.push({ file: "ScriptHookV.log", time: new Date(statTime(shv)).toISOString(), mods: unique(failed).slice(0, 6), line: text.match(/[^\n]*(?:failed|error)[^\n]*/i)?.[0]?.trim() ?? null, kind: "error" });
        }
    }
    const dotnet = filesIn(loc.gameDir, /^ScriptHookVDotNet.*\.log$/i);
    for (const file of dotnet.filter((f) => statTime(f) > since)) {
        const text = read(file);
        const scripts = [...text.matchAll(/\[ERROR\][^\n]*?(?:script|in)\s+["']?([\w .-]+?)(?:\.dll|\.cs|\.vb)?["']?(?:[\s:.]|$)/gi)].map((m) => m[1].trim()).filter((n) => n.length > 2);
        if (/\[ERROR\]/i.test(text)) out.push({ file: path.basename(file), time: new Date(statTime(file)).toISOString(), mods: unique(scripts).slice(0, 6), line: text.match(/\[ERROR\][^\n]*/i)?.[0]?.trim() ?? null, kind: "error" });
    }
    return out;
}

function cyberpunk(game, loc, since) {
    const out = [];
    if (!loc.gameDir) return out;
    const logs = [
        ...filesIn(path.join(loc.gameDir, "r6", "logs"), /^redscript.*\.log$/i),
        ...filesIn(path.join(loc.gameDir, "red4ext", "logs"), /\.log$/i),
        path.join(loc.gameDir, "bin", "x64", "plugins", "cyber_engine_tweaks", "cyber_engine_tweaks.log"),
    ];
    for (const file of logs.filter((f) => statTime(f) > since)) {
        const text = read(file);
        const errors = text.split(/\r?\n/).filter((l) => /\[(error|critical)\]|\bERROR\b/i.test(l));
        if (!errors.length) continue;
        const mods = errors.flatMap((l) => [...l.matchAll(/(?:r6[\\/]scripts|plugins|mods)[\\/]([^\\/'"\s]+)/gi)].map((m) => m[1].replace(/\.(reds|dll|lua)$/i, "")));
        out.push({ file: path.basename(file), time: new Date(statTime(file)).toISOString(), mods: unique(mods).filter((m) => !/^cyber_engine_tweaks$/i.test(m)).slice(0, 6), line: errors[0].trim().slice(0, 240), kind: "error" });
    }
    return out;
}

function stardew(game, loc, since) {
    const dirs = homes(loc).flatMap((home) => [path.join(home, "AppData", "Roaming", "StardewValley", "ErrorLogs"), path.join(home, ".config", "StardewValley", "ErrorLogs")]);
    const files = dirs.flatMap((dir) => filesIn(dir, /^SMAPI-(latest|crash)\.txt$/i));
    return files
        .filter((file) => statTime(file) > since)
        .map((file) => {
            const text = read(file);
            const errors = [...text.matchAll(/^\[[\d:]+\s+(?:ERROR|ALERT)\s+([^\]]+)\]\s*(.*)$/gim)].filter((m) => !/^(SMAPI|game)$/i.test(m[1].trim()));
            const skipped = [...text.matchAll(/^\[[^\]]*\]\s+-\s+(.+?)\s+(?:\d[\w.-]*\s+)?because\s/gim)].map((m) => m[1].trim());
            if (!errors.length && !skipped.length && !/crash/i.test(path.basename(file))) return null;
            return {
                file: path.basename(file),
                time: new Date(statTime(file)).toISOString(),
                mods: unique([...errors.map((m) => m[1].trim()), ...skipped]).slice(0, 8),
                line: (errors[0]?.[2] ?? (skipped.length ? `${skipped.length} mod${skipped.length === 1 ? "" : "s"} couldn't be loaded.` : null))?.slice(0, 240) ?? null,
                kind: /crash/i.test(path.basename(file)) ? "crash" : "error",
            };
        })
        .filter(Boolean);
}

const READERS = { sims4: sims, skyrimse: skyrimOrFallout, fallout4: skyrimOrFallout, gtav: gta, cyberpunk2077: cyberpunk, stardew };

/* Reports since a time (ms), newest first, at most 8. */
function reports(game, loc, since = 0) {
    try {
        return (READERS[game.id]?.(game, loc, since) ?? []).sort((a, b) => b.time.localeCompare(a.time)).slice(0, 8);
    } catch {
        return [];
    }
}

module.exports = { reports };
