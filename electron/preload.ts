import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopApp", {
  getRuntimeInfo: () => ipcRenderer.invoke("desktop:get-runtime-info"),
  openDataDir: () => ipcRenderer.invoke("desktop:open-data-dir"),
  openLogDir: () => ipcRenderer.invoke("desktop:open-log-dir"),
});
