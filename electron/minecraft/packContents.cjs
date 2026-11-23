/*
 * What a modpack version contains, for the Mods tab on its page. The pack's own file
 * list (modrinth.index.json or CurseForge's manifest.json) is read out of the pack with
 * range requests, then each file is matched to its project for a name and an icon.
 * A version's contents never change, so each is looked up once per run.
 */

const { fetchJson } = require("./net.cjs");
const { getSecret } = require("../secrets.cjs");
const { curseforgeJson } = require("../curseforge.cjs");
const { curseForgeType } = require("./contentTypes.cjs");
const { openRemoteZip } = require("./remoteZip.cjs");

const USER_AGENT = "UnityLauncher/1.0";
const MODRINTH_HOSTS = ["cdn.modrinth.com"];
const CURSEFORGE_HOSTS = ["edge.forgecdn.net", "mediafilez.forgecdn.net"];
const KIND_BY_FOLDER = { mods: "mod", resourcepacks: "resourcepack", shaderpacks: "shader", datapacks: "datapack" };
const KIND_ORDER = ["mod", "resourcepack", "shader", "datapack", "other"];

const cache = new Map();

const unique = (list) => [...new Set(list)];
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const baseName = (file) => String(file).replace(/\\/g, "/").split("/").pop();

function kindOf(filePath) {
    const parts = String(filePath).replace(/\\/g, "/").split("/");
    if (parts.slice(0, -1).includes("datapacks")) return "datapack";
    return KIND_BY_FOLDER[parts[0]] ?? "other";
}

// Which side a Modrinth pack file is for, from its env block.
function sideOf(env) {
    if (!env) return undefined;
    const client = env.client !== "unsupported";
    const server = env.server !== "unsupported";
    return client && server ? "both" : client ? "client" : server ? "server" : undefined;
}

// Jars and packs shipped inside the pack itself, rather than downloaded when it installs.
function bundled(zip, overrideFolders) {
    const items = [];
    for (const name of zip.names()) {
        const parts = name.split("/");
        if (parts.length !== 3 || !overrideFolders.includes(parts[0])) continue;
        const kind = KIND_BY_FOLDER[parts[1]];
        if (!kind || !/\.(jar|zip)$/i.test(parts[2])) continue;
        items.push({
            name: parts[2].replace(/\.(jar|zip)$/i, ""),
            fileName: parts[2],
            kind,
            bundled: true,
            side: parts[0].startsWith("client-") ? "client" : parts[0].startsWith("server-") ? "server" : undefined,
        });
    }
    return items;
}

function sorted(items) {
    return items.sort((a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/* ---------------- Modrinth ---------------- */

async function modrinthPost(pathname, body) {
    const send = (token) =>
        fetch(`https://api.modrinth.com/v2${pathname}`, {
            method: "POST",
            headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60 * 1000),
        });
    const token = getSecret("modrinth");
    let res = await send(token);
    if (res.status === 401 && token) res = await send(null);
    if (!res.ok) throw new Error(`Modrinth HTTP ${res.status}`);
    return res.json();
}

async function modrinthProjects(ids) {
    const found = new Map();
    for (const batch of chunks(unique(ids), 100)) {
        const list = await fetchJson(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(batch))}`);
        for (const project of list ?? []) found.set(project.id, project);
    }
    return found;
}

function modrinthItem(project, extra) {
    return {
        name: project?.title ?? extra.name,
        kind: extra.kind,
        fileName: extra.fileName,
        source: project ? "modrinth" : undefined,
        projectId: project?.id,
        icon: project?.icon_url || null,
        summary: project?.description,
        version: extra.version,
        side: extra.side,
        optional: extra.optional,
    };
}

async function modrinthContents(versionId) {
    const version = await fetchJson(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`);
    const file = version.files?.find((f) => f.primary) ?? version.files?.[0];
    if (!file?.url) throw new Error("That version has no pack file.");

    let index = null;
    let zip = null;
    try {
        zip = await openRemoteZip(file.url, file.size, MODRINTH_HOSTS);
        index = JSON.parse((await zip.text("modrinth.index.json")) ?? "null");
    } catch (err) {
        console.warn("Couldn't read the pack's file list:", err.message);
    }

    // Without the file list, Modrinth's own record of the projects the pack embeds.
    if (!Array.isArray(index?.files)) {
        const embedded = (version.dependencies ?? []).filter((d) => d.dependency_type === "embedded" && d.project_id);
        const projects = await modrinthProjects(embedded.map((d) => d.project_id));
        return {
            versionId: version.id,
            versionName: version.version_number,
            partial: true,
            items: sorted(embedded.map((d) => {
                const project = projects.get(d.project_id);
                const kind = project?.project_type === "resourcepack" ? "resourcepack" : project?.project_type === "shader" ? "shader" : "mod";
                return modrinthItem(project, { name: d.file_name ?? d.project_id, kind });
            })),
        };
    }

    const files = index.files.filter((f) => typeof f?.path === "string");
    const hashes = files.map((f) => f.hashes?.sha1).filter(Boolean);
    const versions = hashes.length ? await modrinthPost("/version_files", { hashes, algorithm: "sha1" }).catch(() => ({})) : {};
    const projects = await modrinthProjects(Object.values(versions).map((v) => v.project_id)).catch(() => new Map());

    const items = files.map((f) => {
        const known = versions[f.hashes?.sha1];
        const fileName = baseName(f.path);
        return modrinthItem(known && projects.get(known.project_id), {
            name: fileName.replace(/\.(jar|zip)$/i, ""),
            kind: kindOf(f.path),
            fileName,
            version: known?.version_number,
            side: sideOf(f.env),
            optional: f.env?.client === "optional" || undefined,
        });
    });

    return {
        versionId: version.id,
        versionName: version.version_number,
        items: sorted([...items, ...bundled(zip, ["overrides", "client-overrides", "server-overrides"])]),
    };
}

/* ---------------- CurseForge ---------------- */

async function curseForgeBatch(pathname, field, ids) {
    const found = new Map();
    const lists = await Promise.all(chunks(unique(ids), 50).map((batch) =>
        curseforgeJson(pathname, { method: "POST", body: { [field]: batch } }).then((json) => json.data ?? [])));
    for (const entry of lists.flat()) found.set(entry.id, entry);
    return found;
}

async function curseForgeContents(projectId, fileId) {
    const [file] = (await curseforgeJson("/mods/files", { method: "POST", body: { fileIds: [Number(fileId)] } })).data ?? [];
    if (!file || String(file.modId) !== String(projectId)) throw new Error("That version isn't part of this pack.");
    if (!file.downloadUrl) {
        throw new Error("This pack's author doesn't let other launchers download it, so its contents can't be read here. CurseForge's site lists them.");
    }

    // edge.forgecdn.net only redirects to mediafilez, and answers a range request with 404.
    const url = file.downloadUrl.replace(/^https:\/\/edge\.forgecdn\.net\//i, "https://mediafilez.forgecdn.net/");
    const zip = await openRemoteZip(url, file.fileLength, CURSEFORGE_HOSTS);
    const manifest = JSON.parse((await zip.text("manifest.json")) ?? "null");
    if (!Array.isArray(manifest?.files)) throw new Error("That pack has no list of its files.");

    const entries = manifest.files.filter((f) => Number.isInteger(f?.projectID) && Number.isInteger(f?.fileID));
    const [projects, files] = await Promise.all([
        curseForgeBatch("/mods", "modIds", entries.map((f) => f.projectID)),
        curseForgeBatch("/mods/files", "fileIds", entries.map((f) => f.fileID)),
    ]);

    const items = entries.map((entry) => {
        const project = projects.get(entry.projectID);
        const packFile = files.get(entry.fileID);
        const type = curseForgeType(project?.classId);
        const kind = /\.jar$/i.test(packFile?.fileName ?? "") || type === "other" ? "mod" : type;
        return {
            name: project?.name ?? packFile?.displayName ?? `Project ${entry.projectID}`,
            kind,
            fileName: packFile?.fileName,
            source: "curseforge",
            projectId: String(entry.projectID),
            icon: project?.logo?.thumbnailUrl || project?.logo?.url || null,
            summary: project?.summary,
            version: packFile?.displayName,
            optional: entry.required === false || undefined,
        };
    });

    const overrides = typeof manifest.overrides === "string" && manifest.overrides ? manifest.overrides : "overrides";

    return {
        versionId: String(file.id),
        versionName: file.displayName,
        items: sorted([...items, ...bundled(zip, [overrides])]),
    };
}

function packContents(source, projectId, versionId) {
    const key = `${source}:${versionId}`;
    if (!cache.has(key)) {
        const job = source === "modrinth" ? modrinthContents(versionId) : curseForgeContents(projectId, versionId);
        cache.set(key, job);
        job.catch(() => cache.delete(key));
    }
    return cache.get(key);
}

module.exports = { packContents, kindOf, sideOf };
