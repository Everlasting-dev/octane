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
  cloudLogs: {
    list: () => ipcRenderer.invoke("cloud-logs:list"),
    upload: (payload) => ipcRenderer.invoke("cloud-logs:upload", payload),
    update: (payload) => ipcRenderer.invoke("cloud-logs:update", payload),
    delete: (id) => ipcRenderer.invoke("cloud-logs:delete", id),
    download: (id) => ipcRenderer.invoke("cloud-logs:download", id),
  },
  app: {
    getVersion: () => ipcRenderer.invoke("app:version"),
  },
  updates: {
    check: () => ipcRenderer.invoke("updates:check"),
    install: () => ipcRenderer.invoke("updates:install"),
    onStatus: (callback) => {
      const listener = (_event, status) => callback(status)
      ipcRenderer.on("updates:status", listener)
      return () => ipcRenderer.removeListener("updates:status", listener)
    },
  },
  files: {
    getPendingOpen: () => ipcRenderer.invoke("files:get-pending-open"),
    ackOpen: (id) => ipcRenderer.invoke("files:ack-open", id),
    onOpenLog: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on("files:open-log", listener)
      return () => ipcRenderer.removeListener("files:open-log", listener)
    },
  },
})
