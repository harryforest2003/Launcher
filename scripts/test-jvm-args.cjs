/*
 * Checks which Java arguments the launcher passes on (electron/minecraft/settings.cjs).
 * Run: node scripts/test-jvm-args.cjs (scripts/security-check.cjs runs it too).
 * The refused list includes every example the security review found getting through.
 */
const assert = require("assert");
const settings = require("../electron/minecraft/settings.cjs");

const ALLOWED = [
    "-Xmx4G", "-Xms2G", "-Xmn512M", "-Xss2M",
    // The Minecraft Launcher's (and so this launcher's default) garbage collection flags.
    ...settings.DEFAULT_GC_ARGS,
    // Aikar's flags.
    "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1",
    "-XX:+UseZGC -XX:+ZGenerational",
    "-XX:+UseShenandoahGC -XX:ShenandoahGCMode=iu",
    "-XX:ReservedCodeCacheSize=400M -XX:MaxDirectMemorySize=2G -XX:ThreadPriorityPolicy=1 -XX:AllocatePrefetchStyle=3",
    "-Dfile.encoding=UTF-8", "-Djava.awt.headless=true", "-Djava.net.preferIPv4Stack=true", "-Dlog4j2.formatMsgNoLookups=true",
    "-Dfml.ignoreInvalidMinecraftCertificates=true -Dfml.ignorePatchDiscrepancies=true",
];

const REFUSED = [
    // Run a program, write or read a file, load code.
    "-XX:OnOutOfMemoryError=whoami", "-XX:OnError=1", "-Xlog:gc:file=/tmp/x", "-XX:HeapDumpPath=/tmp/x", "-XX:ErrorFile=/tmp/x",
    "-XX:LogFile=x", "-XX:Flags=.hotspotrc", "-XX:VMOptionsFile=x", "-javaagent:/tmp/a.jar", "-agentpath:/x", "-agentlib:jdwp=transport=dt_socket",
    "-cp /tmp", "-Xbootclasspath/a:/tmp",
    // From the security review: all got through an earlier, looser check.
    "-Dfabric.addMods=@mods.txt", "-Dfabric.addMods=evil.jar",
    "-XX:+UnlockDiagnosticVMOptions", "-XX:+PrintAssembly",
    "-DsocksProxyHost=evil.example", "-Dhttps.proxyHost=evil.example", "-Djavax.net.debug=all",
    "-Dcom.sun.jndi.ldap.object.trustURLCodebase=true", "-Djava.rmi.server.useCodebaseOnly=false", "-Djava.security.manager=allow",
    "-Djdk.internal.httpclient.disableHostnameVerification=true",
    "-Djava.util.logging.manager=Evil", "-Dlog4j2.configurationFactory=Evil", "-Djava.protocol.handler.pkgs=evil",
    "-Djava.nio.file.spi.DefaultFileSystemProvider=Evil", "-Dorg.lwjgl.glfw.libname=evil",
    "-XX:+EnableJVMCI", "-XX:+UseJVMCICompiler", "-XX:+PauseAtStartup", "-XX:+StartAttachListener",
    "-Dlog4j.configurationFile=evil.xml", "-Djava.library.path=/tmp", "-Djava.system.class.loader=Evil",
    // An allowed name with a value that isn't plain.
    "-Dfile.encoding=${jndi:ldap://e/a}", "-Dfile.encoding=/tmp/x", "-XX:MaxGCPauseMillis=evil",
];

let failed = 0;
for (const args of ALLOWED) {
    const { refused } = settings.safeJvmArgs(args);
    if (refused.length) {
        failed++;
        console.log(`FAIL should be allowed: ${refused.map((r) => r.arg).join(" ")}`);
    }
    assert.doesNotThrow(() => settings.checkJvmArgs(args));
}
for (const arg of REFUSED) {
    const { refused, args } = settings.safeJvmArgs(arg);
    const ok = refused.length > 0 && !args.some((kept) => arg.includes(kept) && kept !== "-XX:+UnlockExperimentalVMOptions");
    if (!ok) {
        failed++;
        console.log(`FAIL should be refused: ${arg}`);
    }
    assert.throws(() => settings.checkJvmArgs(arg));
}

// Experimental flags are unlocked by the launcher, once, first, and only when needed.
assert.deepStrictEqual(settings.safeJvmArgs("-XX:G1NewSizePercent=20").args, ["-XX:+UnlockExperimentalVMOptions", "-XX:G1NewSizePercent=20"]);
assert.deepStrictEqual(settings.safeJvmArgs("-XX:+UnlockExperimentalVMOptions -Xmx4G").args, ["-Xmx4G"]);

console.log(failed ? `${failed} Java argument check(s) failed.` : `Java arguments: ${ALLOWED.length} allowed sets and ${REFUSED.length} refused examples all as expected.`);
process.exit(failed ? 1 : 0);
