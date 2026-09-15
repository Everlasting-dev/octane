import { networkInterfaces } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync } from "node:fs"
import { startServer } from "../electron/static-server.cjs"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")
const outDir = resolve(root, "out")
const port = Number(process.env.PORT ?? 3001)

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((addr) => addr && addr.family === "IPv4" && !addr.internal)
    .map((addr) => addr.address)
}

if (!existsSync(resolve(outDir, "index.html"))) {
  console.error("No static build found. Run `npm run build` first.")
  process.exit(1)
}

const server = await startServer(outDir, port, "0.0.0.0")
const address = server.address()
const actualPort = typeof address === "object" && address ? address.port : port

console.log(`Octane mobile preview is serving ./out on port ${actualPort}`)
console.log(`Local:   http://localhost:${actualPort}`)
for (const ip of lanAddresses()) {
  console.log(`Phone:   http://${ip}:${actualPort}`)
}
