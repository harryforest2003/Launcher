export async function findJava() {
    return window.launcherAPI.invoke("java:find");
}