// Single Octane bridge: templates, auth, app info, updates.
const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("octane", {
  templates: {
    load: () => ipcRenderer.invoke("templates:load"),
    save: (json) => ipcRenderer.invoke("templates:save", json),
  },
  auth: {
    getState: () => ipcRenderer.invoke("auth:get-state"),
    login: (credentials) => ipcRenderer.invoke("auth:login", credentials),
    logout: () => ipcRenderer.invoke("auth:logout"),
    getAccessToken: () => ipcRenderer.invoke("auth:get-access-token"),
  },
  app: {
    getVersion: () => ipcRenderer.invoke("app:version"),
  },
  updates: {
    check: () => ipcRenderer.invoke("updates:check"),
  },
})
