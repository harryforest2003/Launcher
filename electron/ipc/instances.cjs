const { ipcMain } = require("electron");

const {
    loadInstances,
    saveInstances,
} = require("../minecraft/instances.cjs");

ipcMain.handle("instances:get", () => {
    return loadInstances();
});

ipcMain.handle("instances:save", (_, instances) => {
    saveInstances(instances);
});