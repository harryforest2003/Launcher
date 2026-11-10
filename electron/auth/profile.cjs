async function getProfile(accessToken) {
    const res = await fetch(
        "https://api.minecraftservices.com/minecraft/profile",
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        }
    );

    if (res.status === 404) {
        throw new Error("This Microsoft account doesn't own Minecraft: Java Edition.");
    }

    if (!res.ok) {
        throw new Error(`Couldn't read your Minecraft profile (HTTP ${res.status}).`);
    }

    return res.json();
}

function activeSkinUrl(profile) {
    const skins = profile.skins ?? [];
    return (skins.find((skin) => skin.state === "ACTIVE") ?? skins[0])?.url ?? null;
}

module.exports = {
    getProfile,
    activeSkinUrl,
};
