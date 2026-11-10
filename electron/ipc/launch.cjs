const { ipcMain } = require("electron");

const {
    launchMinecraft,
} = require("../minecraft/launcher.cjs");

ipcMain.handle("minecraft:launch", (_, java, args) => {
    launchMinecraft(java, args);
});
