/*
 * Ely.by accounts (electron/auth/elyBy.cjs) and the authlib-injector download the game needs
 * for them (electron/minecraft/authlibInjector.cjs). Offline: Ely.by's answers and the
 * download are made up here in the shapes the real ones have, and the jar lives in a
 * temporary folder.
 */
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const elyBy = require("../electron/auth/elyBy.cjs");
const authlibInjector = require("../electron/minecraft/authlibInjector.cjs");

const answer = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
    arrayBuffer: async () => {
        const buffer = Buffer.from(body);
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
    },
});

const SIGNED_IN = {
    accessToken: "token-1",
    clientToken: "client-1",
    selectedProfile: { id: "0123abcd-0000-0000-0000-00000000beef", name: "Steve_Ely" },
};

test("sign-in sends the login once, with the authenticator code added to the password", async () => {
    const sent = [];
    const request = async (url, init) => {
        sent.push({ url, body: JSON.parse(init.body) });
        return answer(200, SIGNED_IN);
    };

    const account = await elyBy.signIn("  steve@example.test ", "hunter2", "123 456", { request });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].url, "https://authserver.ely.by/auth/authenticate");
    assert.strictEqual(sent[0].body.username, "steve@example.test");
    assert.strictEqual(sent[0].body.password, "hunter2:123456");
    assert.match(sent[0].body.clientToken, /^[0-9a-f]{32}$/);
    assert.deepStrictEqual(account, {
        name: "Steve_Ely",
        uuid: "0123abcd00000000000000000000beef",
        accessToken: "token-1",
        clientToken: "client-1",
        skin: "https://skinsystem.ely.by/skins/Steve_Ely.png",
    });

    await elyBy.signIn("steve", "hunter2", "", { request });
    assert.strictEqual(sent[1].body.password, "hunter2");
});

test("sign-in problems come back in words, and two-step sign-in asks for the code", async () => {
    const saying = (status, errorMessage) => async () => answer(status, { error: "ForbiddenOperationException", errorMessage });

    await assert.rejects(
        elyBy.signIn("steve", "pw", "", { request: saying(401, "Account protected with two factor auth.") }),
        (err) => err instanceof elyBy.NeedsCode && err.code === "ELY_NEEDS_CODE"
    );
    await assert.rejects(
        elyBy.signIn("steve", "pw", "", { request: saying(401, "Invalid credentials. Invalid username or password.") }),
        /didn't accept that login and password/
    );
    await assert.rejects(elyBy.signIn("steve", "pw", "", { request: async () => answer(429, "") }), /pause/);
    await assert.rejects(elyBy.signIn("steve", "pw", "", { request: async () => answer(503, "<html>") }), /HTTP 503/);

    // Checked before anything is sent.
    const never = async () => assert.fail("nothing should be sent");
    await assert.rejects(elyBy.signIn("", "pw", "", { request: never }), /login and password/);
    await assert.rejects(elyBy.signIn("steve", "pw", "12ab", { request: never }), /6 digits/);
});

test("an Ely.by account without a Minecraft player can't be used", () => {
    assert.throws(() => elyBy.accountFrom({ accessToken: "t", selectedProfile: null }, "c"), /no Minecraft player/);
    assert.strictEqual(elyBy.accountFrom({ ...SIGNED_IN, clientToken: undefined }, "mine").clientToken, "mine");
});

test("renewing and checking a token use Ely.by's refresh and validate", async () => {
    const asked = [];
    const request = async (url, init) => {
        asked.push(url.split("/").pop());
        if (url.endsWith("/validate")) return answer(403, { errorMessage: "Token expired." });
        return answer(200, { ...SIGNED_IN, accessToken: "token-2" });
    };
    assert.strictEqual(await elyBy.isValid("token-1", { request }), false);
    assert.strictEqual((await elyBy.renew("token-1", "client-1", { request })).accessToken, "token-2");
    await elyBy.signOut("token-2", "client-1", { request: async () => { throw new TypeError("fetch failed"); } });
    assert.deepStrictEqual(asked, ["validate", "refresh"]);
});

const JAR = Buffer.from("PK\u0003\u0004 pretend authlib-injector");
const SHA = crypto.createHash("sha256").update(JAR).digest("hex");

function injectorSite({ sha256 = SHA, body = JAR, online = true } = {}) {
    const asked = [];
    const request = async (url) => {
        asked.push(url);
        if (!online) throw new TypeError("fetch failed");
        if (url.endsWith("/latest.json")) {
            return answer(200, { version: "1.2.8", download_url: "https://authlib-injector.yushi.moe/artifact/57/authlib-injector-1.2.8.jar", checksums: { sha256 } });
        }
        return answer(200, body);
    };
    return { request, asked };
}

const tempFolder = () => fs.mkdtempSync(path.join(os.tmpdir(), "authlib-injector-test-"));

test("authlib-injector is downloaded once, checked, and replaces older builds", async () => {
    const folder = tempFolder();
    try {
        fs.writeFileSync(path.join(folder, "authlib-injector-1.2.5.jar"), "old");
        const site = injectorSite();
        const jar = await authlibInjector.ensure(folder, { request: site.request });
        assert.strictEqual(jar, path.join(folder, "authlib-injector-1.2.8.jar"));
        assert.deepStrictEqual(fs.readdirSync(folder), ["authlib-injector-1.2.8.jar"]);
        assert.strictEqual(site.asked.length, 2);

        // Already kept and matching: only the version check goes out.
        const again = injectorSite();
        assert.strictEqual(await authlibInjector.ensure(folder, { request: again.request }), jar);
        assert.strictEqual(again.asked.length, 1);

        // Offline: the kept jar is used.
        assert.strictEqual(await authlibInjector.ensure(folder, { request: injectorSite({ online: false }).request }), jar);
        assert.deepStrictEqual(authlibInjector.jvmArgs(jar), [`-javaagent:${jar}=ely.by`]);
    } finally {
        fs.rmSync(folder, { recursive: true, force: true });
    }
});

test("a download that doesn't match its checksum is never kept", async () => {
    const folder = tempFolder();
    try {
        await assert.rejects(
            authlibInjector.ensure(folder, { request: injectorSite({ body: Buffer.from("something else") }).request }),
            /didn't match its checksum/
        );
        assert.deepStrictEqual(fs.readdirSync(folder), []);
        await assert.rejects(authlibInjector.ensure(folder, { request: injectorSite({ sha256: "nope" }).request }), /can't use/);
        await assert.rejects(authlibInjector.ensure(folder, { request: injectorSite({ online: false }).request }), /Couldn't download authlib-injector/);
    } finally {
        fs.rmSync(folder, { recursive: true, force: true });
    }
});
