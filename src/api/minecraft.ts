export async function launchMinecraft(
    java: string,
    args: string[]
) {
    // preload's generic invoke forwards a single payload argument.
    return window.launcherAPI.invoke(
        "minecraft:launch",
        { java, args }
    );
}
