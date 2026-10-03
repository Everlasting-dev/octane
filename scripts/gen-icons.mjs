// Builds every Octane icon from one source image (the white rounded tile with
// the navy turbo mark). Run: node scripts/gen-icons.mjs   (or: npm run gen:icons)
//
// Source: build/icon-source.png (any size; the light tile is auto-detected and
// cropped, its corners are made transparent with a rounded mask).
//
// Outputs:
//   public/icon-192.png, icon-512.png       PWA icons (transparent corners)
//   public/icon-dark-32x32.png              32px favicon (dark UI)
//   public/icon-light-32x32.png             32px favicon (light UI)
//   public/favicon.ico                      16/32/48 favicon (PNG-in-ICO)
//   public/apple-icon.png                   180px Apple touch icon (opaque, iOS rounds it)
//   public/maskable-192.png, -512.png       Android maskable (tile inside the safe zone on dark)
//   public/logo-mark.png                    256px in-app logo
//   public/icon.svg                         SVG favicon wrapping the 192 PNG
//   public/og-image.png                     1200x630 social preview
//   build/icon.png                          512px Electron/installer icon
//   electron/icon.png                       256px window/taskbar icon (shipped with the app)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")
const SOURCE = join(root, "build/icon-source.png")
const DARK = "#0b0f19"

if (!existsSync(SOURCE)) {
  console.error(`Missing ${SOURCE}. Put the source icon image there.`)
  process.exit(1)
}

// --- find the light tile ----------------------------------------------------
const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true })
let minX = info.width
let minY = info.height
let maxX = -1
let maxY = -1
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    if (lum > 200) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
}
if (maxX < 0) throw new Error("Could not find a light tile in the source image")
// square crop around the tile, inset a hair so no dark edge survives
const side0 = Math.max(maxX - minX + 1, maxY - minY + 1)
const inset = Math.round(side0 * 0.006)
const side = side0 - inset * 2
const left = Math.round((minX + maxX + 1) / 2 - side / 2)
const top = Math.round((minY + maxY + 1) / 2 - side / 2)
const tile = await sharp(SOURCE).removeAlpha().extract({ left, top, width: side, height: side }).png().toBuffer()

const RADIUS = 0.215 // corner radius as a fraction of the side (matches the artwork)
const maskSvg = (n) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}"><rect width="${n}" height="${n}" rx="${Math.round(n * RADIUS)}" fill="#fff"/></svg>`)

/** Tile resized to n with transparent rounded corners. */
async function rounded(n) {
  const base = await sharp(tile).resize(n, n, { kernel: "lanczos3" }).png().toBuffer()
  return sharp(base).ensureAlpha().composite([{ input: maskSvg(n), blend: "dest-in" }]).png({ compressionLevel: 9 }).toBuffer()
}

/** Opaque square: tile full-bleed (iOS applies its own mask). */
async function opaque(n) {
  return sharp(tile).resize(n, n, { kernel: "lanczos3" }).flatten({ background: "#ffffff" }).png({ compressionLevel: 9 }).toBuffer()
}

/** Maskable: rounded tile at 78% on a dark square (inside the 80% safe zone). */
async function maskable(n) {
  const inner = Math.round(n * 0.78)
  const t = await rounded(inner)
  return sharp({ create: { width: n, height: n, channels: 4, background: DARK } })
    .composite([{ input: t, left: Math.round((n - inner) / 2), top: Math.round((n - inner) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** ICO with PNG-compressed entries (Vista+ / all browsers). */
function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + 16 * pngs.length
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2)
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(buf.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += buf.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)])
}

mkdirSync(join(root, "public"), { recursive: true })
mkdirSync(join(root, "build"), { recursive: true })
const write = (file, buf) => writeFileSync(join(root, file), buf)

const r192 = await rounded(192)
write("public/icon-192.png", r192)
write("public/icon-512.png", await rounded(512))
write("public/icon-dark-32x32.png", await rounded(32))
write("public/icon-light-32x32.png", await rounded(32))
write("public/logo-mark.png", await rounded(256))
write("public/apple-icon.png", await opaque(180))
write("public/maskable-192.png", await maskable(192))
write("public/maskable-512.png", await maskable(512))
write("build/icon.png", await rounded(512))
write("electron/icon.png", await rounded(256))
write(
  "public/favicon.ico",
  ico([
    { size: 16, buf: await rounded(16) },
    { size: 32, buf: await rounded(32) },
    { size: 48, buf: await rounded(48) },
  ]),
)
write(
  "public/icon.svg",
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192"><image width="192" height="192" href="data:image/png;base64,${r192.toString("base64")}"/></svg>\n`,
  ),
)

const ogTile = await rounded(260)
const ogText = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <text x="420" y="300" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="96" font-weight="700">Octane</text>
  <text x="424" y="368" fill="#8bd8ff" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="600">ECU Telemetry Viewer</text>
  <text x="424" y="424" fill="#b7c1cc" font-family="Arial, Helvetica, sans-serif" font-size="28">Desktop and mobile CSV log analysis</text>
</svg>`)
write(
  "public/og-image.png",
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: DARK } })
    .composite([
      { input: ogTile, left: 110, top: 185 },
      { input: ogText, left: 0, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer(),
)

const stat = readFileSync(join(root, "public/favicon.ico")).length
console.log(`Octane icons generated from ${side}px tile (crop ${left},${top}); favicon.ico ${stat} bytes`)
