/*
 * How much memory and CPU a running game uses, for the readout next to its memory setting.
 * The game's process is counted with everything it started (a wrapper command starts Java
 * as its child), from one listing of the computer's processes: ps on macOS and Linux,
 * PowerShell on Windows. CPU is the share of the whole computer since the last reading,
 * so the first reading of a game has none.
 */
const os = require("os");
const { execFile } = require("child_process");

/* "1-02:03:04" (Linux), "62:03.45" (macOS) or plain seconds, as seconds. */
function parseCpuTime(text) {
    const value = String(text ?? "").trim();
    if (!value) return NaN;
    const [days, rest] = value.includes("-") ? value.split("-") : ["0", value];
    const parts = rest.split(":").map(Number);
    if (parts.some((part) => Number.isNaN(part))) return NaN;
    const seconds = parts.reduce((total, part) => total * 60 + part, 0);
    return Number(days) * 86400 + seconds;
}

/* Lines of "pid ppid rss-in-KB cpu-time" from ps. */
function parsePs(text) {
    const rows = [];
    for (const line of String(text).split("\n")) {
        const [pid, ppid, rss, time] = line.trim().split(/\s+/);
        const row = { pid: Number(pid), ppid: Number(ppid), memory: Number(rss) * 1024, cpu: parseCpuTime(time) };
        if (Number.isInteger(row.pid) && Number.isInteger(row.ppid) && Number.isFinite(row.memory) && Number.isFinite(row.cpu)) rows.push(row);
    }
    return rows;
}

/* Lines of "pid ppid working-set-bytes cpu-time-in-100ns" from PowerShell. */
function parseWindows(text) {
    const rows = [];
    for (const line of String(text).split(/\r?\n/)) {
        const [pid, ppid, memory, ticks] = line.trim().split(/\s+/).map(Number);
        const row = { pid, ppid, memory, cpu: ticks / 1e7 };
        if (Number.isInteger(pid) && Number.isInteger(ppid) && Number.isFinite(memory) && Number.isFinite(row.cpu)) rows.push(row);
    }
    return rows;
}

/* The memory and CPU time of a process and all it started, or null when it has gone. */
function treeTotals(rows, rootPid) {
    if (!rows.some((row) => row.pid === rootPid)) return null;
    const children = new Map();
    for (const row of rows) {
        if (row.pid === row.ppid) continue;
        if (!children.has(row.ppid)) children.set(row.ppid, []);
        children.get(row.ppid).push(row);
    }
    const byPid = new Map(rows.map((row) => [row.pid, row]));
    const seen = new Set();
    const queue = [byPid.get(rootPid)];
    let memory = 0;
    let cpu = 0;
    while (queue.length) {
        const row = queue.shift();
        if (seen.has(row.pid)) continue;
        seen.add(row.pid);
        memory += row.memory;
        cpu += row.cpu;
        queue.push(...(children.get(row.pid) ?? []));
    }
    return { memory, cpu };
}

const WINDOWS_LIST =
    "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId) $($_.WorkingSetSize) $($_.KernelModeTime + $_.UserModeTime)\" }";

function listProcesses() {
    return new Promise((resolve, reject) => {
        const windows = process.platform === "win32";
        const [command, args] = windows
            ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_LIST]]
            : ["ps", ["-A", "-o", "pid=,ppid=,rss=,time="]];
        execFile(command, args, { timeout: 10000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
            if (err) reject(err);
            else resolve(windows ? parseWindows(stdout) : parsePs(stdout));
        });
    });
}

/* The last reading of each game, to work out CPU between readings. */
const last = new Map();

/*
 * The share of the computer used between two readings, from 0 to 100: CPU seconds over
 * wall seconds, split across every core. Null without an earlier reading.
 */
function cpuShare(previous, next, cores) {
    if (!previous) return null;
    const wall = (next.at - previous.at) / 1000;
    if (wall <= 0) return null;
    const used = Math.max(0, next.cpu - previous.cpu);
    return Math.min(100, (used / wall / Math.max(1, cores)) * 100);
}

/* { memory (bytes), cpu (0-100 or null) } for a game's process, or null when it isn't running. */
async function usage(pid, { list = listProcesses, now = Date.now, cores = os.cpus().length } = {}) {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    const totals = treeTotals(await list(), pid);
    if (!totals) {
        last.delete(pid);
        return null;
    }
    const reading = { ...totals, at: now() };
    const cpu = cpuShare(last.get(pid), reading, cores);
    last.set(pid, reading);
    // Forget games that have stopped, so the map stays small.
    if (last.size > 32) for (const key of [...last.keys()].slice(0, last.size - 32)) last.delete(key);
    return { memory: totals.memory, cpu };
}

module.exports = { parseCpuTime, parsePs, parseWindows, treeTotals, cpuShare, usage };
