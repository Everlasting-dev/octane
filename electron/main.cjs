// Octane — Electron desktop shell.
// Serves the static Next.js export (../out) from an in-process localhost
// server, then loads it in a BrowserWindow. This avoids file:// asset-path
// breakage from Next's absolute /_next/ references and works fully offline.

const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require("electron")
const path = require("node:path")
const fs = require("node:fs")
const { startServer } = require("./static-server.cjs")
const auth = require("./auth.cjs")

const OUT_DIR = path.join(__dirname, "..", "out")
const PRELOAD = path.join(__dirname, "preload.cjs")
// Stable port → stable origin → localStorage (annotations, etc.) survives restarts.
const PORT = 43117
const isDev = !app.isPackaged && process.env.OCTANE_DEV_URL

function templatesFile() {
  return path.join(app.getPath("userData"), "templates", "templates.json")
}

// File-backed templates (a real folder the user can back up / transfer).
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

// Supabase auth (login screen).
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

// Encourage GPU-accelerated rasterization/compositing for smoother scrolling.
app.commandLine.appendSwitch("ignore-gpu-blocklist")
app.commandLine.appendSwitch("enable-gpu-rasterization")
app.commandLine.appendSwitch("enable-zero-copy")
app.commandLine.appendSwitch("enable-accelerated-2d-canvas")

// Manual "Check for Updates" with dialog feedback.
function checkForUpdates() {
  if (!app.isPackaged) {
    dialog.showMessageBox({ type: "info", message: "Updates are only available in the installed app.", buttons: ["OK"] })
    return
  }
  try {
    const { autoUpdater } = require("electron-updater")
    autoUpdater.removeAllListeners()
    autoUpdater.once("update-available", (info) =>
      dialog.showMessageBox({ type: "info", message: `Update ${info?.version ?? ""} available — downloading…`, buttons: ["OK"] }),
    )
    autoUpdater.once("update-not-available", () =>
      dialog.showMessageBox({ type: "info", message: "Octane is up to date.", buttons: ["OK"] }),
    )
    autoUpdater.once("error", (err) =>
      dialog.showMessageBox({ type: "error", message: `Update check failed: ${err?.message ?? err}`, buttons: ["OK"] }),
    )
    autoUpdater.once("update-downloaded", () =>
      dialog
        .showMessageBox({ type: "question", message: "Update downloaded. Restart Octane to install?", buttons: ["Restart", "Later"], defaultId: 0 })
        .then((r) => {
          if (r.response === 0) autoUpdater.quitAndInstall()
        }),
    )
    autoUpdater.checkForUpdates().catch((e) =>
      dialog.showMessageBox({ type: "error", message: `Update check failed: ${e?.message ?? e}`, buttons: ["OK"] }),
    )
  } catch (e) {
    dialog.showMessageBox({ type: "error", message: `Updater unavailable: ${e?.message ?? e}`, buttons: ["OK"] })
  }
}

// Run code in the renderer, guarded against a disposed frame (avoids
// "Render frame was disposed before WebFrameMain could be accessed").
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
          label: "Open log…",
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
        { label: "Check for Updates…", click: () => checkForUpdates() },
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
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    title: "Octane",
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false, // production app — no devtools / F12 / Ctrl+Shift+I
    },
  })

  buildMenu(win)

  // Open external links in the system browser, not a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  win.once("ready-to-show", () => win.show())

  // Self-terminating launch check (CI / smoke test): load, confirm, exit.
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
  // Auto-update existing installs from the published GitHub releases.
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require("electron-updater")
      autoUpdater.checkForUpdatesAndNotify().catch(() => {})
    } catch {
      /* updater unavailable */
    }
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
