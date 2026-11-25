const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/*
 * authlib-injector, the Java agent that points the game's sign-in checks at another account
 * service: Ely.by here. Downloaded once from its own site, checked against the checksum the
 * site lists, and kept in the launcher's data folder; a newer build replaces it when one
 * comes out. Without internet the kept copy is used.
 */

const LATEST = "https://authlib-injector.yushi.moe/artifact/latest.json";
// Ely.by's address for authlib-injector, which it finds the rest from.
const ELY_BY = "ely.by";

/* Where the jar is kept: the launcher's data folder (next to the code, outside Electron). */
function folder() {
    const { app } = require("electron");
    return app?.getPath ? path.join(app.getPath("userData"), "authlib-injector") : path.join(__dirname, "../../authlib-injector");
}

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

async function fetchOk(url, request) {
    const res = await request(url, { signal: AbortSignal.timeout(60 * 1000) });
    if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}.`);
    return res;
}

/* The newest kept build in a folder, or null. */
function keptJar(folder) {
    try {
        const jars = fs.readdirSync(folder).filter((file) => /^authlib-injector-[\w.-]+\.jar$/.test(file));
        jars.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        return jars[0] ? path.join(folder, jars[0]) : null;
    } catch {
        return null;
    }
}

/* The path of a checked authlib-injector jar in folder, downloading it first when needed. */
async function ensure(folder, { request = fetch, onLog } = {}) {
    let latest;
    try {
        latest = await (await fetchOk(LATEST, request)).json();
    } catch (err) {
        const kept = keptJar(folder);
        if (kept) return kept;
        throw new Error(`Couldn't download authlib-injector, which Ely.by accounts need to play (${err.message}).`);
    }

    const version = String(latest?.version ?? "");
    const url = String(latest?.download_url ?? "");
    const expected = String(latest?.checksums?.sha256 ?? "").toLowerCase();
    if (!/^[\w.-]+$/.test(version) || !url.startsWith("https://") || !/^[0-9a-f]{64}$/.test(expected)) {
        throw new Error("authlib-injector's download page gave an answer the launcher can't use.");
    }

    const target = path.join(folder, `authlib-injector-${version}.jar`);
    if (fs.existsSync(target) && sha256(fs.readFileSync(target)) === expected) return target;

    onLog?.(`Downloading authlib-injector ${version} for the Ely.by account...`);
    const body = Buffer.from(await (await fetchOk(url, request)).arrayBuffer());
    if (sha256(body) !== expected) throw new Error("The authlib-injector download didn't match its checksum, so it wasn't used.");

    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(`${target}.part`, body);
    fs.renameSync(`${target}.part`, target);
    // Older builds aren't needed any more.
    for (const file of fs.readdirSync(folder)) {
        if (file !== path.basename(target) && file.startsWith("authlib-injector-")) fs.rmSync(path.join(folder, file), { force: true });
    }
    return target;
}

/* The Java options that start the game with authlib-injector pointed at a service. */
const jvmArgs = (jar, service = ELY_BY) => [`-javaagent:${jar}=${service}`];

module.exports = { ensure, jvmArgs, keptJar, folder, ELY_BY };
