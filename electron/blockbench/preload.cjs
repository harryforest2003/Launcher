const { contextBridge, ipcRenderer } = require("electron");

/*
 * All Blockbench's window can do with the launcher: ask what it's editing, say when it's
 * open (or that it couldn't start), and hand back what Save produced.
 */
contextBridge.exposeInMainWorld("unityLauncher", {
    job: () => ipcRenderer.invoke("blockbench-bridge:job"),
    ready: () => ipcRenderer.invoke("blockbench-bridge:ready"),
    save: (result) => ipcRenderer.invoke("blockbench-bridge:save", result),
    failed: () => ipcRenderer.invoke("blockbench-bridge:failed"),
});
