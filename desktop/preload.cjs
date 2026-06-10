const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("digitalBrain", {
  chooseVault: () => ipcRenderer.invoke("vault:choose"),
  readConfig: (vaultPath) => ipcRenderer.invoke("vault:read-config", vaultPath),
  openVault: (vaultPath) => ipcRenderer.invoke("vault:open", vaultPath),
  openObsidian: (vaultPath) => ipcRenderer.invoke("obsidian:open", vaultPath),
  runCli: (payload) => ipcRenderer.invoke("cli:run", payload),
  onCliOutput: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("cli:output", listener);
    return () => ipcRenderer.removeListener("cli:output", listener);
  },
});
