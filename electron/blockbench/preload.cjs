const { contextBridge, ipcRenderer } = require("electron");

/*
 * All Blockbench's window can do with the launcher: ask what it's editing, and hand
 * back what Save produced.
 */
contextBridge.exposeInMainWorld("unityLauncher", {
    job: () => ipcRenderer.invoke("blockbench-bridge:job"),
    save: (result) => ipcRenderer.invoke("blockbench-bridge:save", result),
});
