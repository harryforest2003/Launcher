const fs = require("fs");
const path = require("path");
const { dataDir } = require("./storage.cjs");

/*
 * The game sections' download queue, kept here in the main process (and on disk) rather
 * than in a page, so it carries on whichever page is open, and after a restart.
 *
 * Each item is worked through in turn:
 *  - straight in where the site allows (Premium Nexus, CurseForge);
 *  - otherwise its Nexus Mods page is opened, and it waits there until the file arrives
 *    through the site's download button (an nxm:// link), then the next opens;
 *  - other sites' pages are opened, and it moves on.
 * Whatever an install needs that isn't there is added to the end.
 *
 * Item: { id, gameId, kind: "update" | "requirement" | "nexus-file", name, key?, modId?,
 *   fileId?, page?, status: "waiting" | "working" | "website" | "done" | "failed" | "skipped",
 *   detail?, error? }
 */

let items = [];
let running = false;
let handlers = null;
let notify = () => {};

const file = () => path.join(dataDir(), "queue.json");

function save() {
    try {
        fs.writeFileSync(file(), JSON.stringify({ items: items.slice(-2000) }));
    } catch {
        // Kept in memory regardless.
    }
    notify(snapshot());
}

/* What the pages show: the items (latest first finished ones trimmed) and counts. */
function snapshot() {
    const open = items.filter((i) => ["waiting", "working", "website"].includes(i.status));
    const finished = items.filter((i) => ["done", "failed", "skipped"].includes(i.status));
    return {
        items: [...open, ...finished.slice(-200).reverse()],
        current: items.find((i) => i.status === "working" || i.status === "website") ?? null,
        counts: {
            waiting: items.filter((i) => i.status === "waiting").length,
            done: items.filter((i) => i.status === "done").length,
            failed: items.filter((i) => i.status === "failed").length,
            skipped: items.filter((i) => i.status === "skipped").length,
            total: items.length,
        },
    };
}

const same = (a, b) => a.gameId === b.gameId && a.kind === b.kind && (a.key ?? "") === (b.key ?? "") && String(a.modId ?? "") === String(b.modId ?? "") && String(a.fileId ?? "") === String(b.fileId ?? "");

/* An item is over: when, for the Downloads page's history. */
function finish(item, status) {
    item.status = status;
    item.finishedAt = new Date().toISOString();
}

/* Adds items (not ones already waiting) and starts working through them. -> how many were added. */
function add(newItems) {
    let added = 0;
    for (const item of newItems) {
        if (items.some((i) => same(i, item) && ["waiting", "working", "website"].includes(i.status))) continue;
        // Something already being fetched from the same Nexus page needn't be fetched twice.
        if (item.modId && items.some((i) => i.gameId === item.gameId && String(i.modId ?? "") === String(item.modId) && ["waiting", "working", "website"].includes(i.status))) continue;
        items.push({ ...item, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, status: "waiting", addedAt: new Date().toISOString() });
        added += 1;
    }
    save();
    kick();
    return added;
}

/* Works through what's waiting, one at a time, until something has to wait for the website. */
async function kick() {
    if (running || !handlers) return;
    running = true;
    try {
        for (;;) {
            if (items.some((i) => i.status === "website")) break;
            const item = items.find((i) => i.status === "waiting");
            if (!item) break;
            item.status = "working";
            item.detail = null;
            save();
            try {
                const result = await handlers.run(item, (detail) => {
                    item.detail = detail;
                    notify(snapshot());
                });
                if (result?.needsWebsite) {
                    item.status = "website";
                    item.page = result.needsWebsite;
                    if (result.modId) item.modId = String(result.modId);
                    item.detail = null;
                    save();
                    handlers.open(item.page);
                    break;
                }
                if (result?.failed) {
                    finish(item, "failed");
                    item.error = result.failed;
                } else {
                    finish(item, "done");
                    item.detail = result?.opened ? "Opened on its own site" : null;
                    if (result?.missing?.length) add(result.missing.map((entry) => ({ gameId: item.gameId, kind: "requirement", key: entry.key, name: entry.name, modId: entry.modId ?? undefined })));
                }
                handlers.changed?.(item.gameId);
            } catch (err) {
                finish(item, "failed");
                item.error = err.message;
            }
            save();
        }
    } finally {
        running = false;
    }
}

/* A file came in through Nexus' download button: if it's what's being waited for, on to the next. */
function arrived(gameId, modId, result) {
    const waiting = items.find((i) => i.status === "website" && i.gameId === gameId && String(i.modId ?? "") === String(modId));
    if (waiting) {
        finish(waiting, "done");
        waiting.detail = null;
    }
    if (result?.missing?.length) add(result.missing.map((entry) => ({ gameId, kind: "requirement", key: entry.key, name: entry.name, modId: entry.modId ?? undefined })));
    save();
    kick();
}

/*
 * skip: past the current one; stop: drop what's waiting; open: the current page again;
 * clear: forget finished ones; retry: failed ones again (or only `id`, failed or skipped);
 * remove: forget the finished one `id`.
 */
function control(action, id) {
    const current = items.find((i) => i.status === "working" || i.status === "website");
    const finished = (i) => ["done", "failed", "skipped"].includes(i.status);
    if (action === "skip" && current?.status === "website") finish(current, "skipped");
    if (action === "stop") for (const item of items) if (item.status === "waiting" || item.status === "website") finish(item, "skipped");
    if (action === "open" && current?.page) handlers?.open(current.page);
    if (action === "clear") items = items.filter((i) => !finished(i));
    if (action === "retry") {
        for (const item of items) {
            const again = id ? item.id === id && (item.status === "failed" || item.status === "skipped") : item.status === "failed";
            if (again) Object.assign(item, { status: "waiting", error: null, detail: null, finishedAt: null, addedAt: new Date().toISOString() });
        }
    }
    if (action === "remove" && id) items = items.filter((i) => i.id !== id || !finished(i));
    save();
    kick();
    return snapshot();
}

/*
 * Starts the queue: what was left last time comes back (anything mid-download starts
 * again). run(item, progress) does one item; open(url) opens a page; changed(gameId) says
 * a game's mods changed; onChange(snapshot) tells the pages.
 */
function start(options) {
    handlers = options;
    notify = options.onChange ?? (() => {});
    try {
        items = JSON.parse(fs.readFileSync(file(), "utf8")).items ?? [];
        for (const item of items) if (item.status === "working") item.status = "waiting";
    } catch {
        items = [];
    }
    kick();
}

module.exports = { start, add, arrived, control, snapshot };
