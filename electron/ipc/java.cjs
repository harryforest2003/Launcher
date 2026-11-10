const { ipcMain } = require("electron");

const {
    findJava,
} = require("../minecraft/java.cjs");

ipcMain.handle("java:find", () => {
    return findJava();
});