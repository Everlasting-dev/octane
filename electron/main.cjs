// Octane Electron desktop shell.
// Serves the static Next.js export from an in-process localhost server, then
// loads it in a BrowserWindow so Next's absolute asset paths work offline.

const { app, BrowserWindow, Menu, shell, ipcMain, screen } = require("electron")
const path = require("node:path")
const fs = require("node:fs")
const { startServer } = require("./static-server.cjs")
const auth = require("./auth.cjs")

const OUT_DIR = path.join(__dirname, "..", "out")
const PRELOAD = path.join(__dirname, "preload.cjs")
const PORT = 43117
const isDev = !app.isPackaged && process.env.OCTANE_DEV_URL
let updater = null
let updaterListenersBound = false
let installWhenDownloaded = false

app.setName("Octane")

function templatesFile() {
  return path.join(app.getPath("userData"), "templates", "templates.json")
}

ipcMain.handle("templates:load", () => {
  try {
    return fs.readFileSync(templatesFile(), "utf8")
  } catch {
    return null
  }
})
ipcMain.handle("templates:save", (_e, json) => {
  try {
    fs.mkdirSync(path.dirname(templatesFile()), { recursive: true })
    fs.writeFileSync(templatesFile(), typeof json === "string" ? json : JSON.stringify(json))
    return true
  } catch {
    return false
  }
})

ipcMain.handle("auth:get-state", async () => {
  try {
    return await auth.getState()
  } catch (e) {
    return { authenticated: false, message: e instanceof Error ? e.message : String(e) }
  }
})
ipcMain.handle("auth:login", async (_e, credentials) => {
  try {
    return await auth.login(credentials || {})
  } catch (e) {
    return { authenticated: false, error: e instanceof Error ? e.message : String(e) }
  }
})
ipcMain.handle("auth:logout", () => auth.logout())
ipcMain.handle("auth:get-access-token", () => auth.getAccessToken())

ipcMain.handle("app:version", () => app.getVersion())
ipcMain.handle("updates:check", () => {
  checkForUpdates()
  return true
})
ipcMain.handle("updates:install", () => {
  installUpdate()
  return true
})

app.commandLine.appendSwitch("ignore-gpu-blocklist")
app.commandLine.appendSwitch("enable-gpu-rasterization")
app.commandLine.appendSwitch("enable-zero-copy")
app.commandLine.appendSwitch("enable-accelerated-2d-canvas")

function sendUpdateStatus(status) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send("updates:status", status)
    }
  }
}

function getUpdater() {
  if (updater) return updater

  const { autoUpdater } = require("electron-updater")
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  updater = autoUpdater

  if (!updaterListenersBound) {
    updaterListenersBound = true

    autoUpdater.on("checking-for-update", () => {
      sendUpdateStatus({ phase: "checking", message: "Checking GitHub releases..." })
    })

    autoUpdater.on("update-available", (info) => {
      sendUpdateStatus({
        phase: "available",
        version: info?.version,
        message: `Octane ${info?.version ?? ""} is available.`,
      })
      autoUpdater.downloadUpdate().catch((error) => {
        sendUpdateStatus({ phase: "error", message: error?.message ?? String(error) })
      })
    })

    autoUpdater.on("update-not-available", () => {
      sendUpdateStatus({ phase: "not-available", message: "Octane is up to date." })
    })

    autoUpdater.on("download-progress", (progress) => {
      sendUpdateStatus({
        phase: "downloading",
        percent: Math.max(0, Math.min(100, progress?.percent ?? 0)),
        transferred: progress?.transferred ?? 0,
        total: progress?.total ?? 0,
        bytesPerSecond: progress?.bytesPerSecond ?? 0,
        message: "Downloading update...",
      })
    })

    autoUpdater.on("update-downloaded", (info) => {
      sendUpdateStatus({
        phase: installWhenDownloaded ? "installing" : "ready",
        version: info?.version,
        percent: 100,
        message: installWhenDownloaded ? "Download complete. Restarting Octane..." : "Download complete.",
      })

      if (installWhenDownloaded) {
        setTimeout(() => installUpdate(), 900)
      }
    })

    autoUpdater.on("error", (error) => {
      sendUpdateStatus({ phase: "error", message: error?.message ?? String(error) })
    })
  }

  return updater
}

function installUpdate() {
  try {
    const autoUpdater = getUpdater()
    sendUpdateStatus({
      phase: "installing",
      percent: 100,
      message: "Closing Octane and launching the installer...",
    })
    autoUpdater.quitAndInstall(false, true)
  } catch (error) {
    sendUpdateStatus({ phase: "error", message: error?.message ?? String(error) })
  }
}

function checkForUpdates() {
  if (!app.isPackaged) {
    sendUpdateStatus({ phase: "not-available", message: "Updates are only available in the installed app." })
    return
  }

  try {
    installWhenDownloaded = true
    getUpdater().checkForUpdates().catch((error) => {
      sendUpdateStatus({ phase: "error", message: error?.message ?? String(error) })
    })
  } catch (e) {
    sendUpdateStatus({ phase: "error", message: `Updater unavailable: ${e?.message ?? e}` })
  }
}

function runInRenderer(win, code) {
  try {
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.executeJavaScript(code).catch(() => {})
    }
  } catch {
    /* frame gone */
  }
}

function buildMenu(win) {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Open log...",
          accelerator: "CmdOrCtrl+O",
          click: () => runInRenderer(win, "window.__octaneOpenLog && window.__octaneOpenLog()"),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Check for Updates...",
          click: () => runInRenderer(win, "window.__octaneCheckUpdates && window.__octaneCheckUpdates()"),
        },
        {
          label: "About Octane",
          click: () => runInRenderer(win, "window.__octaneOpenAbout && window.__octaneOpenAbout()"),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function createWindow() {
  const { width: areaW, height: areaH } = screen.getPrimaryDisplay().workAreaSize
  const winW = Math.max(880, Math.min(1920, Math.round(areaW * 0.85)))
  const winH = Math.max(600, Math.min(1200, Math.round(areaH * 0.85)))

  const win = new BrowserWindow({
    width: winW,
    height: winH,
    minWidth: 880,
    minHeight: 600,
    center: true,
    backgroundColor: "#0a0a0a",
    title: "Octane",
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
    },
  })

  if (areaH >= 1400) win.maximize()

  buildMenu(win)

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  win.once("ready-to-show", () => win.show())

  if (process.env.OCTANE_SMOKE) {
    win.webContents.once("did-finish-load", () => {
      console.log("[smoke] window loaded OK")
      setTimeout(() => app.exit(0), 300)
    })
    win.webContents.once("did-fail-load", (_e, code, desc) => {
      console.error(`[smoke] load failed: ${code} ${desc}`)
      app.exit(1)
    })
  }

  if (isDev) {
    await win.loadURL(process.env.OCTANE_DEV_URL)
  } else {
    const server = await startServer(OUT_DIR, PORT)
    const { port } = server.address()
    await win.loadURL(`http://127.0.0.1:${port}/`)
  }

  return win
}

app.whenReady().then(() => {
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
