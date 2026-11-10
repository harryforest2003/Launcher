const microsoft = require("./microsoftAuth.cjs");
const xbox = require("./xboxAuth.cjs");
const xsts = require("./xstsAuth.cjs");
const minecraft = require("./minecraftAuth.cjs");
const profile = require("./profile.cjs");

/*
 * Turns a Microsoft sign-in into a Minecraft one: Microsoft -> Xbox Live -> XSTS ->
 * Minecraft -> profile. Each step needs the last one's token.
 */
async function finishLogin(ms) {
    const xbl = await xbox.authenticateXbox(ms.access_token);
    const xstsResult = await xsts.authenticateXSTS(xbl.Token);
    const userHash = xstsResult.DisplayClaims.xui[0].uhs;
    const mc = await minecraft.authenticateMinecraft(xstsResult.Token, userHash);
    const user = await profile.getProfile(mc.access_token);

    return {
        microsoft: ms,
        minecraft: mc,
        profile: user,
        skin: profile.activeSkinUrl(user),
    };
}

async function loginMicrosoft() {
    return finishLogin(await microsoft.loginMicrosoft());
}

/* A Minecraft token lasts a day. This gets a new one without asking the user again. */
async function refreshLogin(refreshToken) {
    return finishLogin(await microsoft.refreshMicrosoft(refreshToken));
}

module.exports = {
    loginMicrosoft,
    refreshLogin,
};
