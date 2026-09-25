// Admin-only cloud log library backed by Supabase Storage + PostgREST.
// The renderer talks to this module through IPC so cloud credentials and cached
// files stay inside the desktop shell.

const { app } = require("electron")
const crypto = require("node:crypto")
const fs = require("node:fs/promises")
const path = require("node:path")
const { promisify } = require("node:util")
const zlib = require("node:zlib")
const auth = require("./auth.cjs")

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

const SUPABASE_URL = process.env.SUPABASE_URL || "https://hgwmdowavadfbctlypin.supabase.co"
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_wRhD8AZtNhOAXSv3k_f7Cg_5rzE11zp"
const TABLE = process.env.OCTANE_CLOUD_LOGS_TABLE || "cloud_logs"
const BUCKET = process.env.OCTANE_CLOUD_LOGS_BUCKET || "octane-logs"
const MAX_LIST = 200

function isAdminEmail(email) {
  return typeof email === "string" && email.toLowerCase().includes("akramfariz")
}

function baseUrl() {
  return SUPABASE_URL.replace(/\/+$/, "")
}

function encodeObjectPath(value) {
  return String(value)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")
}

function cacheDir() {
  return path.join(app.getPath("userData"), "cloud-log-cache")
}

function cachePath(hash) {
  return path.join(cacheDir(), `${hash}.csv`)
}

async function fileExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function safeName(value) {
  return String(value || "log")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "log"
}

function displayFileName(row) {
  const custom = String(row.custom_name || "").trim()
  const original = String(row.original_filename || "cloud-log.csv").trim()
  const chosen = custom || original
  if (/\.[^.\\/]+$/.test(chosen)) return chosen
  const ext = path.extname(original) || ".csv"
  return `${chosen}${ext}`
}

function cloudLogSelect() {
  return [
    "id",
    "user_id",
    "custom_name",
    "comment",
    "original_filename",
    "storage_path",
    "storage_encoding",
    "file_size",
    "compressed_size",
    "duration",
    "sample_count",
    "channel_count",
    "channel_names",
    "sha256_hash",
    "uploaded_at",
    "updated_at",
  ].join(",")
}

async function requireAdmin() {
  const state = await auth.getState()
  if (!state?.authenticated) {
    throw new Error("Cloud Logs need an active Octane sign-in.")
  }
  const user = state.user || {}
  if (!isAdminEmail(user.email)) {
    throw new Error("Cloud Logs are only enabled for the Octane admin account.")
  }
  const token = await auth.getAccessToken()
  if (!token) {
    throw new Error("Octane could not refresh your cloud session. Sign in again and retry.")
  }
  return { token, user }
}

function errorMessage(status, data, fallback) {
  const message =
    data?.message ||
    data?.msg ||
    data?.error_description ||
    data?.error ||
    (typeof data === "string" ? data : "") ||
    fallback
  return `${message} (${status})`
}

async function parseResponse(response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function supabaseRequest(pathname, token, options = {}) {
  let response
  try {
    response = await fetch(`${baseUrl()}${pathname}`, {
      method: options.method || "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        ...(options.body && !(options.body instanceof Buffer) ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      body: options.body,
    })
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot reach the Octane cloud library. Details: ${details}`, { cause: error })
  }

  const data = await parseResponse(response)
  if (!response.ok) throw new Error(errorMessage(response.status, data, "Supabase request failed"))
  return data
}

async function storageDownload(storagePath, token) {
  let response
  try {
    response = await fetch(`${baseUrl()}/storage/v1/object/authenticated/${BUCKET}/${encodeObjectPath(storagePath)}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    })
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot reach the cloud log file. Details: ${details}`, { cause: error })
  }

  if (!response.ok) {
    const data = await parseResponse(response)
    throw new Error(errorMessage(response.status, data, "Cloud log download failed"))
  }
  return Buffer.from(await response.arrayBuffer())
}

async function storageUpload(storagePath, token, buffer) {
  await supabaseRequest(`/storage/v1/object/${BUCKET}/${encodeObjectPath(storagePath)}`, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/gzip",
      "x-upsert": "true",
    },
    body: buffer,
  })
}

async function storageDelete(storagePath, token) {
  try {
    await supabaseRequest(`/storage/v1/object/${BUCKET}/${encodeObjectPath(storagePath)}`, token, { method: "DELETE" })
  } catch {
    // The metadata row is the source of truth for Octane. If Storage says the
    // file is already gone, still let the admin remove the stale row.
  }
}

async function toSummary(row) {
  const cached = row.sha256_hash ? await fileExists(cachePath(row.sha256_hash)) : false
  return {
    id: row.id,
    customName: row.custom_name || "",
    comment: row.comment || "",
    originalFileName: row.original_filename || "",
    displayFileName: displayFileName(row),
    fileSize: Number(row.file_size || 0),
    compressedSize: Number(row.compressed_size || 0),
    duration: Number(row.duration || 0),
    samples: Number(row.sample_count || 0),
    channelCount: Number(row.channel_count || 0),
    channelNames: Array.isArray(row.channel_names) ? row.channel_names : [],
    sha256Hash: row.sha256_hash || "",
    uploadedAt: row.uploaded_at || "",
    updatedAt: row.updated_at || "",
    cached,
  }
}

async function queryRows(token, query) {
  const data = await supabaseRequest(`/rest/v1/${TABLE}?${query}`, token)
  return Array.isArray(data) ? data : []
}

async function listLogs() {
  const { token } = await requireAdmin()
  const rows = await queryRows(token, `select=${cloudLogSelect()}&order=uploaded_at.desc&limit=${MAX_LIST}`)
  return Promise.all(rows.map(toSummary))
}

async function findRow(token, id) {
  const rows = await queryRows(token, `id=eq.${encodeURIComponent(id)}&select=${cloudLogSelect()}&limit=1`)
  return rows[0] || null
}

async function uploadLog(input = {}) {
  const { token, user } = await requireAdmin()
  const text = typeof input.text === "string" ? input.text : ""
  if (!text.trim()) throw new Error("The current log has no original file text to upload.")

  const originalFileName = String(input.originalFileName || "octane-log.csv").trim() || "octane-log.csv"
  const customName = String(input.customName || originalFileName).trim() || originalFileName
  const comment = String(input.comment || "").trim()
  const raw = Buffer.from(text, "utf8")
  const hash = crypto.createHash("sha256").update(raw).digest("hex")

  const duplicates = await queryRows(
    token,
    `sha256_hash=eq.${hash}&select=id,custom_name,original_filename&limit=1`,
  )
  if (duplicates[0]) {
    const label = duplicates[0].custom_name || duplicates[0].original_filename || "that saved log"
    throw new Error(`This log is already saved in the cloud library as "${label}".`)
  }

  const compressed = await gzip(raw, { level: 9 })
  const storagePath = `${user.id}/${hash}-${safeName(originalFileName)}.csv.gz`
  await storageUpload(storagePath, token, compressed)

  const payload = {
    user_id: user.id,
    custom_name: customName,
    comment,
    original_filename: originalFileName,
    storage_path: storagePath,
    storage_encoding: "gzip",
    file_size: Number(input.fileSize || raw.length),
    compressed_size: compressed.length,
    duration: Number(input.duration || 0),
    sample_count: Number(input.samples || 0),
    channel_count: Number(input.channelCount || 0),
    channel_names: Array.isArray(input.channelNames) ? input.channelNames.slice(0, 500) : [],
    sha256_hash: hash,
  }

  let rows
  try {
    rows = await supabaseRequest(`/rest/v1/${TABLE}?select=${cloudLogSelect()}`, token, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    await storageDelete(storagePath, token)
    throw error
  }

  await fs.mkdir(cacheDir(), { recursive: true })
  await fs.writeFile(cachePath(hash), text, "utf8")
  return toSummary(Array.isArray(rows) ? rows[0] : rows)
}

async function updateLog(input = {}) {
  const { token } = await requireAdmin()
  if (!input.id) throw new Error("Choose a cloud log before saving changes.")
  const payload = {
    custom_name: String(input.customName || "").trim(),
    comment: String(input.comment || "").trim(),
    updated_at: new Date().toISOString(),
  }
  const rows = await supabaseRequest(`/rest/v1/${TABLE}?id=eq.${encodeURIComponent(input.id)}&select=${cloudLogSelect()}`, token, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  })
  return toSummary(Array.isArray(rows) ? rows[0] : rows)
}

async function deleteLog(id) {
  const { token } = await requireAdmin()
  if (!id) throw new Error("Choose a cloud log before deleting.")
  const row = await findRow(token, id)
  if (!row) return { ok: true }
  if (row.storage_path) await storageDelete(row.storage_path, token)
  await supabaseRequest(`/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`, token, { method: "DELETE" })
  if (row.sha256_hash) {
    try {
      await fs.unlink(cachePath(row.sha256_hash))
    } catch {
      /* cache already gone */
    }
  }
  return { ok: true }
}

async function downloadLog(id) {
  const { token } = await requireAdmin()
  if (!id) throw new Error("Choose a cloud log before loading.")
  const row = await findRow(token, id)
  if (!row) throw new Error("That cloud log is no longer available.")

  const fileName = displayFileName(row)
  const cachedPath = row.sha256_hash ? cachePath(row.sha256_hash) : ""
  if (cachedPath && (await fileExists(cachedPath))) {
    const text = await fs.readFile(cachedPath, "utf8")
    return {
      id: row.id,
      fileName,
      originalFileName: row.original_filename || fileName,
      text,
      byteSize: Buffer.byteLength(text, "utf8"),
      cached: true,
    }
  }

  let buffer = await storageDownload(row.storage_path, token)
  if (row.storage_encoding === "gzip" || String(row.storage_path || "").endsWith(".gz")) {
    buffer = await gunzip(buffer)
  }
  const text = buffer.toString("utf8")
  if (cachedPath) {
    await fs.mkdir(cacheDir(), { recursive: true })
    await fs.writeFile(cachedPath, text, "utf8")
  }
  return {
    id: row.id,
    fileName,
    originalFileName: row.original_filename || fileName,
    text,
    byteSize: Buffer.byteLength(text, "utf8"),
    cached: false,
  }
}

module.exports = { listLogs, uploadLog, updateLog, deleteLog, downloadLog }
