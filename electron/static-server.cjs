// Tiny dependency-free static file server for the Next.js export.
// Extracted so it can be unit-tested without the Electron runtime.

const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
}

/**
 * Start an HTTP server that serves `outDir`. Tries `preferredPort` for a stable
 * origin (so localStorage persists); falls back to a random port if it's taken.
 * Resolves with the http.Server.
 */
function startServer(outDir, preferredPort = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname)
        let filePath = path.normalize(path.join(outDir, urlPath))

        // Block path traversal outside the export dir.
        if (!filePath.startsWith(outDir)) {
          res.writeHead(403)
          res.end("Forbidden")
          return
        }

        if (urlPath === "/" || urlPath.endsWith("/")) {
          filePath = path.join(filePath, "index.html")
        }
        if (!fs.existsSync(filePath)) {
          if (fs.existsSync(filePath + ".html")) filePath += ".html"
          else filePath = path.join(outDir, "index.html") // SPA fallback
        }
        if (fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, "index.html")
        }

        const ext = path.extname(filePath).toLowerCase()
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" })
        res.end(fs.readFileSync(filePath))
      } catch {
        res.writeHead(404)
        res.end("Not found")
      }
    })
    let triedFallback = false
    server.on("listening", () => resolve(server))
    server.on("error", (err) => {
      if (preferredPort && !triedFallback && err.code === "EADDRINUSE") {
        triedFallback = true
        server.listen(0, "127.0.0.1") // fall back to a random free port
      } else {
        reject(err)
      }
    })
    server.listen(preferredPort, "127.0.0.1")
  })
}

module.exports = { startServer }
