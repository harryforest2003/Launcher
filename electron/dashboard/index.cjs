const { app, ipcMain } = require("electron");

const { collect } = require("./stats.cjs");
const { buildActivity, noteLauncherVersion } = require("./activity.cjs");
const { getNews, FEEDS } = require("./news.cjs");
const { getDeals } = require("./deals.cjs");
const sessions = require("./sessions.cjs");

/*
 * The Home dashboard's three questions (window.dashboardAPI in preload.cjs):
 *   dashboard:stats     play time, instances and mods       (stats.cjs, playtime.cjs)
 *   dashboard:activity  what happened recently               (activity.cjs)
 *   dashboard:news      Minecraft and mod loader news, or general gaming news (news.cjs)
 *   dashboard:deals     Steam's current specials              (deals.cjs)
 * Every handler is registered after security.guardIpc(), so its sender is checked first.
 */

// One scan answers both stats and activity when Home asks for them together.
const REUSE_MS = 10_000;
let lastScan = null;
let scanning = null;

function scan(manager) {
    if (lastScan && Date.now() - lastScan.at < REUSE_MS) return Promise.resolve(lastScan.result);
    if (!scanning) {
        scanning = collect({ instancesDir: manager.INSTANCE_DIR, isRunning: (name) => manager.isRunning(name) })
            .then((result) => {
                lastScan = { at: Date.now(), result };
                return result;
            })
            .finally(() => {
                scanning = null;
            });
    }
    return scanning;
}

const forget = () => {
    lastScan = null;
};

/* The number of activity items asked for: a whole number from 1 to 100, 20 otherwise. */
const activityLimit = (value) => (Number.isInteger(value) && value >= 1 && value <= 100 ? value : 20);

/* News options: only { refresh: true } means anything. */
const wantsRefresh = (options) =>
    options !== null && typeof options === "object" && !Array.isArray(options) && options.refresh === true;

/*
 * Records each game session from the launcher's own start and exit of the game
 * (instanceManager emits "started" and "exit").
 */
function trackSessions(events) {
    events.on("started", ({ name, session, account, at } = {}) => {
        sessions.started(name, Number.isFinite(at) ? at : Date.now(), { id: session, player: account });
        forget();
    });
    events.on("exit", ({ name, code, session } = {}) => {
        sessions.ended(name, code, Date.now(), session);
        forget();
    });
}

function registerDashboardIpc() {
    // Loaded here, after main.cjs has set where the profile lives.
    const manager = require("../instanceManager.cjs");

    noteLauncherVersion(app.getVersion());
    trackSessions(manager.instanceEvents);

    ipcMain.handle("dashboard:stats", async () => (await scan(manager)).stats);

    ipcMain.handle("dashboard:activity", async (_event, limit) => {
        const { details } = await scan(manager);
        return buildActivity(details, activityLimit(limit));
    });

    // Only the two known feeds; anything else the page sends gets the Minecraft one.
    const feedOf = (options) => (options && typeof options === "object" && FEEDS.has(options.feed) ? options.feed : "minecraft");
    ipcMain.handle("dashboard:news", (_event, options) => getNews({ refresh: wantsRefresh(options), feed: feedOf(options) }));
    ipcMain.handle("dashboard:deals", (_event, options) => getDeals({ refresh: wantsRefresh(options) }));
}

module.exports = { registerDashboardIpc, _internal: { activityLimit, wantsRefresh } };
