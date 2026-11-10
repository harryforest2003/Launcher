const https = require("https");

// Electron 42 ships Node 20+, which has a global fetch. `node-fetch` was
// being required without being declared in package.json, so a clean
// `npm install` could crash main.cjs on startup.

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            let data = "";

            res.on("data", c => data += c);
            res.on("end", () => resolve(JSON.parse(data)));
        }).on("error", reject);
    });
}

// Names Mojang's bulk endpoint accepts per request.
const UUID_BATCH_SIZE = 10;

// How many players we resolve for one search. The old code walked 25 names
// sequentially with 2 HTTP calls each (50 round-trips), which routinely
// tripped Mojang's rate limit and returned an empty list.
const MAX_PLAYERS = 18;

async function fetchJsonSafe(url, options) {
    try {
        const res = await fetch(url, options);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

// Resolve many usernames to UUIDs using Mojang's bulk endpoint:
// 1 request per 10 names instead of 1 request per name.
async function resolveUuids(usernames) {
    const batches = [];

    for (let i = 0; i < usernames.length; i += UUID_BATCH_SIZE) {
        batches.push(usernames.slice(i, i + UUID_BATCH_SIZE));
    }

    const results = await Promise.all(
        batches.map(batch =>
            fetchJsonSafe("https://api.mojang.com/profiles/minecraft", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(batch),
            })
        )
    );

    return results
        .filter(Array.isArray)
        .flat()
        .filter(p => p && p.id && p.name);
}

// Mojang briefly refuses lookups when a search sends many at once, so a refused one
// waits a moment and tries again instead of silently dropping that player.
async function fetchJsonPatient(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(url);
            if (res.ok) return await res.json();
            if (res.status !== 429) return null;
        } catch {
            return null;
        }

        await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
    }

    return null;
}

// Read the skin URL + arm model out of a session-server profile.
async function resolveSkin(profileStub) {
    const profile = await fetchJsonPatient(
        `https://sessionserver.mojang.com/session/minecraft/profile/${profileStub.id}`
    );

    if (!profile || !Array.isArray(profile.properties)) return null;

    const textureProperty = profile.properties.find(p => p.name === "textures");
    if (!textureProperty) return null;

    let textures;
    try {
        textures = JSON.parse(
            Buffer.from(textureProperty.value, "base64").toString()
        );
    } catch {
        return null;
    }

    const skin = textures?.textures?.SKIN;
    if (!skin?.url) return null;

    return {
        username: profileStub.name,
        uuid: profileStub.id,
        // Mojang hands back http:// URLs, which a packaged renderer blocks
        // as mixed content. textures.minecraft.net serves https fine.
        skin: skin.url.replace(/^http:\/\//, "https://"),
        slim: skin.metadata?.model === "slim",
    };
}

/*
 * The exact name typed, straight from Mojang. The suggestion list only knows names it
 * has seen before, so without this a real player could be impossible to find.
 */
async function exactPlayer(name) {
    if (!/^[A-Za-z0-9_]{2,16}$/.test(name)) return null;

    const profile = await fetchJsonPatient(
        `https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodeURIComponent(name)}`
    );

    if (!profile?.id || !profile?.name) return null;

    return resolveSkin({ id: profile.id, name: profile.name });
}

async function searchPlayers(query) {
    if (!query || query.trim().length < 2) return [];

    const name = query.trim();

    const searchURL =
        `https://vrc.lol/api.php?suggest=${encodeURIComponent(name)}&limit=25`;

    // The exact match is looked up first, so it isn't the one a busy Mojang refuses.
    const [exact, suggestions] = await Promise.all([
        exactPlayer(name),
        fetchJsonSafe(searchURL),
    ]);

    const withExactFirst = (players) =>
        exact
            ? [exact, ...players.filter(p => p.uuid !== exact.uuid)]
            : players;

    if (!Array.isArray(suggestions)) {
        console.warn("Player suggest endpoint returned no usable list.");
        return withExactFirst([]);
    }

    // `types` was assumed to always exist; a single entry without it threw
    // and killed the whole search.
    const javaNames = suggestions
        .filter(p => p && typeof p.name === "string")
        .filter(p => !Array.isArray(p.types) || p.types.includes("Java"))
        .map(p => p.name)
        .slice(0, MAX_PLAYERS);

    if (javaNames.length === 0) return withExactFirst([]);

    const stubs = await resolveUuids(javaNames);

    // Profile lookups run in parallel rather than one-at-a-time.
    const players = (await Promise.all(stubs.map(resolveSkin)))
        .filter(Boolean);

    // Preserve the suggest endpoint's relevance ordering.
    const order = new Map(javaNames.map((n, i) => [n.toLowerCase(), i]));
    players.sort(
        (a, b) =>
            (order.get(a.username.toLowerCase()) ?? 999) -
            (order.get(b.username.toLowerCase()) ?? 999)
    );

    const results = withExactFirst(players);

    console.log(`Player search "${query}" -> ${results.length} players`);

    return results;
}

async function getVersions() {
    const manifest = await fetchJson(
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
    );

    return manifest.versions;
}

async function getFabricVersions(mcVersion) {
    return await fetchJson(
        `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`
    );
}

async function getQuiltVersions(mcVersion) {
    return await fetchJson(
        `https://meta.quiltmc.org/v3/versions/loader/${mcVersion}`
    );
}

// MCCreate called getForgeVersions/getNeoForgeVersions, but neither the
// preload bridge nor an IPC handler existed, so picking Forge or NeoForge
// threw "not a function" and left the version list empty.

async function getForgeVersions(mcVersion) {
    const meta = await fetchJsonSafe(
        "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json"
    );

    if (!meta?.promos) return [];

    // promos keys look like "1.20.1-latest" / "1.20.1-recommended".
    return Object.entries(meta.promos)
        .filter(([key]) => key.startsWith(`${mcVersion}-`))
        .map(([key, build]) => ({
            loader: { version: `${mcVersion}-${build}` },
            version: `${mcVersion}-${build}`,
            channel: key.split("-").pop(),
        }));
}

async function getNeoForgeVersions(mcVersion) {
    const meta = await fetchJsonSafe(
        "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge"
    );

    const all = meta?.versions ?? [];

    // NeoForge versions are "<minor>.<patch>.<build>" derived from the MC
    // version: MC 1.21.1 -> 21.1.x
    const parts = mcVersion.split(".");
    const prefix = parts.length >= 2
        ? `${parts[1]}.${parts[2] ?? "0"}.`
        : null;

    const matching = prefix
        ? all.filter(v => v.startsWith(prefix))
        : all;

    return matching
        .reverse()
        .map(v => ({ loader: { version: v }, version: v }));
}

module.exports = {
    getVersions,
    getFabricVersions,
    getQuiltVersions,
    getForgeVersions,
    getNeoForgeVersions,
    searchPlayers,
};

