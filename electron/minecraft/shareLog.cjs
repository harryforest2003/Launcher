const os = require("os");

/*
 * Sharing a game log: uploaded to mclo.gs (the log site Minecraft servers and modders use,
 * which hides IP addresses itself) after this computer's own details are taken out.
 */

const USER_AGENT = "UnityLauncher/1.0 (game mod manager)";
const MAX_LINES = 25000;
const MAX_BYTES = 10 * 1024 * 1024;

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* The log with login tokens, emails and this computer's user name hidden. */
function redactLog(text, { home = os.homedir(), user = os.userInfo().username } = {}) {
    let out = String(text);
    // Launch arguments that sign the game in.
    out = out.replace(/(--(?:accessToken|session|xuid|clientId))(\s+|=)\S+/gi, "$1$2[hidden]");
    // "Session ID is token:<token>:<uuid>" from older versions, and any signed token.
    out = out.replace(/token:[A-Za-z0-9._-]{16,}/g, "token:[hidden]");
    out = out.replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[hidden token]");
    // The home folder, written either way round, then the user's name in any other path.
    for (const form of new Set([home, home.replace(/\\/g, "/"), home.replace(/\//g, "\\")])) {
        if (form && form.length > 3) out = out.replace(new RegExp(`${escape(form)}(?![\\w.-])`, "gi"), "~");
    }
    if (user && user.length > 1) {
        out = out.replace(new RegExp(`([\\\\/](?:Users|home)[\\\\/])${escape(user)}(?=[\\\\/]|$)`, "gim"), "$1[user]");
    }
    out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "[email hidden]");
    return out;
}

/* Uploads the log's last 25,000 lines and gives back its link. */
async function shareLog(lines) {
    let text = redactLog(lines.slice(-MAX_LINES).join("\n"));
    if (!text.trim()) throw new Error("There's no log to share yet. Start the game first.");
    while (Buffer.byteLength(text) > MAX_BYTES) text = text.slice(Math.floor(text.length / 4));

    let res;
    try {
        res = await fetch("https://api.mclo.gs/1/log", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
            body: new URLSearchParams({ content: text }),
            signal: AbortSignal.timeout(30000),
        });
    } catch {
        throw new Error("mclo.gs couldn't be reached. Check your connection and try again.");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || typeof data.url !== "string") {
        throw new Error(`mclo.gs didn't take the log${data?.error ? `: ${data.error}` : ` (error ${res.status})`}.`);
    }
    return { url: data.url };
}

module.exports = { redactLog, shareLog };
