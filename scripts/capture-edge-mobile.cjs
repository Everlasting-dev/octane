const { spawn } = require("node:child_process")
const fs = require("node:fs/promises")
const http = require("node:http")
const os = require("node:os")
const path = require("node:path")

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
const url = process.argv[2] || "http://localhost:3001"
const output = path.resolve(process.argv[3] || "mobile-analysis-landscape-preview.png")
const outputChannels = path.resolve(process.argv[4] || "mobile-analysis-landscape-channels-preview.png")
const outputMatrix = path.resolve(process.argv[5] || "mobile-matrix-landscape-preview.png")
const outputMatrixWindow = path.resolve(process.argv[6] || "mobile-matrix-landscape-window-preview.png")
const port = 9223

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getJson(targetUrl) {
  return new Promise((resolve, reject) => {
    http
      .get(targetUrl, (res) => {
        let body = ""
        res.setEncoding("utf8")
        res.on("data", (chunk) => (body += chunk))
        res.on("end", () => {
          try {
            resolve(JSON.parse(body))
          } catch (error) {
            reject(error)
          }
        })
      })
      .on("error", reject)
  })
}

async function waitForDebugTarget() {
  const started = Date.now()
  while (Date.now() - started < 15000) {
    try {
      const targets = await getJson(`http://127.0.0.1:${port}/json`)
      const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl)
      if (target) return target.webSocketDebuggerUrl
    } catch {
      /* Edge is still starting */
    }
    await sleep(150)
  }
  throw new Error("Timed out waiting for Edge remote debugging target.")
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener("message", (event) => {
    const data = JSON.parse(event.data)
    if (!data.id) return
    const item = pending.get(data.id)
    if (!item) return
    pending.delete(data.id)
    if (data.error) item.reject(new Error(data.error.message || JSON.stringify(data.error)))
    else item.resolve(data.result)
  })
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const nextId = ++id
            pending.set(nextId, { resolve: res, reject: rej })
            ws.send(JSON.stringify({ id: nextId, method, params }))
          })
        },
        close() {
          ws.close()
        },
      })
    })
    ws.addEventListener("error", reject)
  })
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Evaluation failed")
  return result.result.value
}

async function waitFor(cdp, expression, timeout = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await evaluate(cdp, expression)) return
    await sleep(150)
  }
  throw new Error(`Timed out waiting for ${expression}`)
}

async function clickButton(cdp, text) {
  const clicked = await evaluate(
    cdp,
    `(() => {
      const needle = ${JSON.stringify(text)}
      const button = Array.from(document.querySelectorAll("button")).find((item) => {
        const body = (item.textContent || "").trim()
        const title = item.getAttribute("title") || ""
        const label = item.getAttribute("aria-label") || ""
        return body.includes(needle) || title.includes(needle) || label.includes(needle)
      })
      if (!button) return false
      button.click()
      return true
    })()`,
  )
  if (!clicked) throw new Error(`Button not found: ${text}`)
}

async function screenshot(cdp, filePath) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true })
  await fs.writeFile(filePath, Buffer.from(result.data, "base64"))
  console.log(`Wrote ${filePath}`)
}

async function main() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "octane-edge-"))
  const edge = spawn(edgePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--window-size=932,430",
    url,
  ])

  try {
    const wsUrl = await waitForDebugTarget()
    console.log("Connected to Edge")
    const cdp = await connect(wsUrl)
    await cdp.send("Page.enable")
    await cdp.send("Runtime.enable")
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 932,
      height: 430,
      deviceScaleFactor: 1,
      mobile: true,
      screenOrientation: { type: "landscapePrimary", angle: 90 },
    })
    await cdp.send("Page.navigate", { url })
    console.log("Opened Octane")
    await waitFor(cdp, `document.body.innerText.includes("Load sample data")`)
    await clickButton(cdp, "Load sample data")
    console.log("Loaded sample data")
    await waitFor(cdp, `document.querySelector(".octane-mobile-simple-actions") !== null`)
    await sleep(800)
    await screenshot(cdp, outputMatrix)
    await clickButton(cdp, "Window")
    await sleep(500)
    await screenshot(cdp, outputMatrixWindow)
    await waitFor(cdp, `document.querySelector('[aria-label="Analysis Plot"]') !== null`)
    await clickButton(cdp, "Analysis Plot")
    console.log("Opened Analysis Plot")
    await waitFor(cdp, `document.querySelector(".octane-analysis-plot") !== null`)
    await sleep(1000)
    await screenshot(cdp, output)
    await clickButton(cdp, "Select channels")
    await sleep(500)
    await screenshot(cdp, outputChannels)
    cdp.close()
  } finally {
    edge.kill()
    await sleep(500)
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
