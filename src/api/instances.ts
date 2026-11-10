export async function getInstances() {
    return window.launcherAPI.invoke("instances:get");
}

export async function saveInstances(instances: any[]) {
    return window.launcherAPI.invoke(
        "instances:save",
        instances
    );
}