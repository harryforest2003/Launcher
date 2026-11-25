/*
 * The loaders for old Minecraft versions: LiteLoader's profile, made from its index of
 * builds (electron/minecraft/liteLoader.cjs), the tweaker it adds to the game's arguments,
 * and Legacy Fabric's LWJGL natives, named by Maven coordinate only
 * (electron/minecraft/versionData.cjs). Offline: the index and Maven files are made up
 * here in the shapes the real ones have.
 */
const test = require("node:test");
const assert = require("node:assert");
const liteLoader = require("../electron/minecraft/liteLoader.cjs");
const versionData = require("../electron/minecraft/versionData.cjs");

const LAUNCHWRAPPER = { name: "net.minecraft:launchwrapper:1.12" };

const INDEX = {
    versions: {
        "1.12.2": {
            repo: { stream: "SNAPSHOT", url: "http://repo.mumfrey.com/content/repositories/snapshots/" },
            artefacts: [],
            snapshots: {
                libraries: [LAUNCHWRAPPER, { name: "org.spongepowered:mixin:0.7.4-SNAPSHOT", url: "https://repo.spongepowered.org/maven/" }],
                "com.mumfrey:liteloader": {
                    "1420785e": {
                        version: "1.12.2-SNAPSHOT",
                        tweakClass: "com.mumfrey.liteloader.launch.LiteLoaderTweaker",
                        libraries: [LAUNCHWRAPPER, { name: "org.ow2.asm:asm-all:5.2" }],
                    },
                    latest: { version: "1.12.2-SNAPSHOT" },
                },
            },
        },
        "1.7.10": {
            repo: { stream: "RELEASE", url: "http://dl.liteloader.com/versions/" },
            artefacts: {
                "com.mumfrey:liteloader": {
                    a: { version: "1.7.10_02", tweakClass: "com.mumfrey.liteloader.launch.LiteLoaderTweaker" },
                    b: { version: "1.7.10_04", tweakClass: "com.mumfrey.liteloader.launch.LiteLoaderTweaker" },
                    latest: { version: "1.7.10_04" },
                },
            },
            snapshots: { "com.mumfrey:liteloader": { c: { version: "1.7.10-SNAPSHOT" } } },
        },
    },
};

const metadata = (timestamp, build) =>
    `<metadata><versioning><snapshot><timestamp>${timestamp}</timestamp><buildNumber>${build}</buildNumber></snapshot></versioning></metadata>`;

test("builds list releases first, newest first, without the index's 'latest' copies", () => {
    assert.deepStrictEqual(
        liteLoader.buildsFrom(INDEX, "1.7.10").map((b) => [b.version, b.stable]),
        [["1.7.10_04", true], ["1.7.10_02", true], ["1.7.10-SNAPSHOT", false]]
    );
    assert.deepStrictEqual(liteLoader.buildsFrom(INDEX, "1.12.2").map((b) => b.version), ["1.12.2-SNAPSHOT"]);
    assert.deepStrictEqual(liteLoader.buildsFrom(INDEX, "1.20.1"), []);
});

test("a Maven snapshot is downloaded under the name its metadata gives", () => {
    assert.strictEqual(liteLoader.snapshotFile("mixin", "0.7.4-SNAPSHOT", metadata("20171010.121826", "8")), "mixin-0.7.4-20171010.121826-8.jar");
    assert.strictEqual(liteLoader.snapshotFile("mixin", "0.7.4-SNAPSHOT", "<metadata/>"), "mixin-0.7.4-SNAPSHOT.jar");
});

test("LiteLoader's profile: its jar and what it needs, launchwrapper first, one tweaker", async () => {
    const asked = [];
    const read = async (url) => {
        asked.push(url);
        if (url.includes("/liteloader/")) return metadata("20171128.144431", "4");
        if (url.includes("/mixin/")) return metadata("20171010.121826", "8");
        throw new Error(`Not expected: ${url}`);
    };
    const profile = await liteLoader.profile("1.12.2", "1.12.2-SNAPSHOT", { data: INDEX, read });

    assert.strictEqual(profile.mainClass, "net.minecraft.launchwrapper.Launch");
    assert.deepStrictEqual(profile.tweakers, ["com.mumfrey.liteloader.launch.LiteLoaderTweaker"]);
    assert.deepStrictEqual(
        profile.libraries.map((lib) => lib.downloads.artifact.url),
        [
            "https://repo.mumfrey.com/content/repositories/snapshots/com/mumfrey/liteloader/1.12.2-SNAPSHOT/liteloader-1.12.2-20171128.144431-4.jar",
            "https://libraries.minecraft.net/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar",
            "https://repo.spongepowered.org/maven/org/spongepowered/mixin/0.7.4-SNAPSHOT/mixin-0.7.4-20171010.121826-8.jar",
            "https://repo1.maven.org/maven2/org/ow2/asm/asm-all/5.2/asm-all-5.2.jar",
        ]
    );
    // Stored under the plain name, as every other library is.
    assert.strictEqual(profile.libraries[0].downloads.artifact.path, "com/mumfrey/liteloader/1.12.2-SNAPSHOT/liteloader-1.12.2-SNAPSHOT.jar");
    assert.strictEqual(asked.length, 2);

    const release = await liteLoader.profile("1.7.10", "1.7.10_04", { data: INDEX, read });
    assert.strictEqual(release.libraries[0].downloads.artifact.url, "https://dl.liteloader.com/versions/com/mumfrey/liteloader/1.7.10_04/liteloader-1.7.10_04.jar");

    await assert.rejects(liteLoader.profile("1.12.2", "9.9", { data: INDEX, read }), /no build 9\.9/);
});

test("tweakers join the game's arguments, in the old format and the new", () => {
    const tweaker = { mainClass: "net.minecraft.launchwrapper.Launch", tweakers: ["com.mumfrey.liteloader.launch.LiteLoaderTweaker"], libraries: [] };

    const old = versionData.mergeVersions({ id: "1.12.2", minecraftArguments: "--username ${auth_player_name}", libraries: [] }, tweaker);
    assert.strictEqual(old.minecraftArguments, "--username ${auth_player_name} --tweakClass com.mumfrey.liteloader.launch.LiteLoaderTweaker");
    assert.strictEqual(old.mainClass, "net.minecraft.launchwrapper.Launch");

    const modern = versionData.mergeVersions({ id: "x", arguments: { game: ["--demo"], jvm: [] }, libraries: [] }, tweaker);
    assert.deepStrictEqual(modern.arguments.game, ["--demo", "--tweakClass", "com.mumfrey.liteloader.launch.LiteLoaderTweaker"]);

    const plain = versionData.mergeVersions({ id: "1.8.9", minecraftArguments: "--a b", libraries: [] }, { mainClass: "K", libraries: [] });
    assert.strictEqual(plain.minecraftArguments, "--a b");
});

test("Legacy Fabric's LWJGL natives come from its repository, and add nothing to the classpath", () => {
    const platform = {
        name: "org.lwjgl.lwjgl:lwjgl-platform:2.9.4+legacyfabric.17",
        url: "https://maven.legacyfabric.net/",
        natives: { linux: "natives-linux", osx: "natives-osx", windows: "natives-windows" },
    };
    const classifier = versionData.nativeClassifier(platform);
    const native = versionData.nativeArtifact(platform);
    assert.strictEqual(native.path, `org/lwjgl/lwjgl/lwjgl-platform/2.9.4+legacyfabric.17/lwjgl-platform-2.9.4+legacyfabric.17-${classifier}.jar`);
    assert.strictEqual(native.url, `https://maven.legacyfabric.net/${native.path}`);

    // Vanilla's own natives entry, which the loader's replaces, keeps its listed download.
    const vanilla = {
        name: "org.lwjgl.lwjgl:lwjgl-platform:2.9.4-nightly-20150209",
        natives: platform.natives,
        downloads: { classifiers: { [classifier]: { path: "v.jar", url: "https://libraries.minecraft.net/v.jar", sha1: "s", size: 1 } } },
    };
    assert.strictEqual(versionData.nativeArtifact(vanilla).url, "https://libraries.minecraft.net/v.jar");

    const merged = versionData.mergeVersions({ id: "1.8.9", libraries: [vanilla] }, { id: "fabric-loader-1.8.9", libraries: [platform] });
    assert.deepStrictEqual(merged.libraries, [platform]);
    const classpath = versionData.buildClasspath(merged, "/i");
    assert.ok(!classpath.some((entry) => entry.includes("lwjgl-platform")), classpath.join("\n"));
});
