"use client"

import { SUPABASE, getAccessToken, getAuthState, isOwnerUser } from "./auth"

export interface CloudLogSummary {
  id: string
  customName: string
  comment: string
  originalFileName: string
  displayFileName: string
  fileSize: number
  compressedSize: number
  duration: number
  samples: number
  channelCount: number
  channelNames: string[]
  sha256Hash: string
  uploadedAt: string
  updatedAt: string
  cached: boolean
}

export interface CloudLogUploadPayload {
  originalFileName: string
  customName: string
  comment: string
  text: string
  fileSize: number
  duration: number
  samples: number
  channelCount: number
  channelNames: string[]
}

export interface CloudLogDownload {
  id: string
  fileName: string
  originalFileName: string
  text: string
  byteSize: number
  cached: boolean
}

interface CloudLogsBridge {
  list: () => Promise<CloudLogSummary[]>
  upload: (payload: CloudLogUploadPayload) => Promise<CloudLogSummary>
  update: (payload: { id: string; customName: string; comment: string }) => Promise<CloudLogSummary>
  delete: (id: string) => Promise<{ ok: boolean }>
  download: (id: string) => Promise<CloudLogDownload>
}

function bridge(): CloudLogsBridge | null {
  if (typeof window === "undefined") return null
  return (window as unknown as { octane?: { cloudLogs?: CloudLogsBridge } }).octane?.cloudLogs ?? null
}

export function isCloudLogAdmin(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().includes("akramfariz")
}

// The desktop app goes through its Electron bridge. The web / phone build talks
// to the same Supabase bucket and table directly with the signed-in session;
// the table and bucket policies only let the owner account read or write.
function requireBridge(): CloudLogsBridge {
  return bridge() ?? webCloudLogs
}

const TABLE = "cloud_logs"
const BUCKET = "octane-logs"
const SELECT = [
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

interface CloudRow {
  id: string
  user_id?: string
  custom_name?: string | null
  comment?: string | null
  original_filename?: string | null
  storage_path?: string | null
  storage_encoding?: string | null
  file_size?: number | null
  compressed_size?: number | null
  duration?: number | null
  sample_count?: number | null
  channel_count?: number | null
  channel_names?: string[] | null
  sha256_hash?: string | null
  uploaded_at?: string | null
  updated_at?: string | null
}

async function requireAdminWeb(): Promise<{ token: string; userId: string }> {
  const state = await getAuthState()
  if (!state.authenticated || !state.user) throw new Error("Cloud Logs need an active Octane sign-in.")
  if (!isOwnerUser(state.user)) throw new Error("Cloud Logs are only enabled for the Octane admin account.")
  const token = await getAccessToken()
  if (!token) throw new Error("Octane could not refresh your cloud session. Sign in again and retry.")
  return { token, userId: state.user.id }
}

const encodePath = (v: string) => v.split("/").map(encodeURIComponent).join("/")

async function request<T>(pathname: string, token: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${SUPABASE.url}${pathname}`, {
      ...init,
      headers: {
        apikey: SUPABASE.anonKey,
        Authorization: `Bearer ${token}`,
        ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    })
  } catch (e) {
    throw new Error(`Cannot reach the Octane cloud library. ${e instanceof Error ? e.message : ""}`.trim(), { cause: e })
  }
  const text = await res.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const d = data as { message?: string; error?: string; msg?: string } | string | null
    const msg = (typeof d === "string" ? d : d?.message || d?.msg || d?.error) || "Cloud request failed"
    throw new Error(`${msg} (${res.status})`)
  }
  return data as T
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Saving to the cloud needs a secure (https) page.")
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

async function pipeBytes(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

const gzipBytes = (b: Uint8Array) => pipeBytes(b, new CompressionStream("gzip"))
const gunzipBytes = (b: Uint8Array) => pipeBytes(b, new DecompressionStream("gzip"))

function safeName(v: string) {
  return (
    v
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "log"
  )
}

function displayName(row: CloudRow) {
  const original = (row.original_filename || "cloud-log.csv").trim()
  const chosen = (row.custom_name || "").trim() || original
  if (/\.[^.\\/]+$/.test(chosen)) return chosen
  const ext = original.match(/\.[^.]+$/)?.[0] ?? ".csv"
  return `${chosen}${ext}`
}

function toSummary(row: CloudRow): CloudLogSummary {
  return {
    id: row.id,
    customName: row.custom_name || "",
    comment: row.comment || "",
    originalFileName: row.original_filename || "",
    displayFileName: displayName(row),
    fileSize: Number(row.file_size || 0),
    compressedSize: Number(row.compressed_size || 0),
    duration: Number(row.duration || 0),
    samples: Number(row.sample_count || 0),
    channelCount: Number(row.channel_count || 0),
    channelNames: Array.isArray(row.channel_names) ? row.channel_names : [],
    sha256Hash: row.sha256_hash || "",
    uploadedAt: row.uploaded_at || "",
    updatedAt: row.updated_at || "",
    cached: false,
  }
}

const firstRow = (rows: CloudRow[] | CloudRow) => (Array.isArray(rows) ? rows[0] : rows)

async function findRow(token: string, id: string): Promise<CloudRow | null> {
  const rows = await request<CloudRow[]>(`/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}&select=${SELECT}&limit=1`, token)
  return rows?.[0] ?? null
}

const webCloudLogs: CloudLogsBridge = {
  async list() {
    const { token } = await requireAdminWeb()
    const rows = await request<CloudRow[]>(`/rest/v1/${TABLE}?select=${SELECT}&order=uploaded_at.desc&limit=200`, token)
    return (rows ?? []).map(toSummary)
  },

  async upload(input) {
    const { token, userId } = await requireAdminWeb()
    if (!input.text?.trim()) throw new Error("The current log has no original file text to upload.")
    const originalFileName = input.originalFileName?.trim() || "octane-log.csv"
    const raw = new TextEncoder().encode(input.text)
    const hash = await sha256Hex(raw)
    const dup = await request<CloudRow[]>(`/rest/v1/${TABLE}?sha256_hash=eq.${hash}&select=id,custom_name,original_filename&limit=1`, token)
    if (dup?.[0]) {
      throw new Error(`This log is already saved in the cloud library as "${dup[0].custom_name || dup[0].original_filename || "that saved log"}".`)
    }
    const gz = await gzipBytes(raw)
    const storagePath = `${userId}/${hash}-${safeName(originalFileName)}.csv.gz`
    await request(`/storage/v1/object/${BUCKET}/${encodePath(storagePath)}`, token, {
      method: "POST",
      headers: { "Content-Type": "application/gzip", "x-upsert": "true" },
      body: new Blob([gz as BlobPart], { type: "application/gzip" }),
    })
    const payload = {
      user_id: userId,
      custom_name: input.customName?.trim() || originalFileName,
      comment: input.comment?.trim() || "",
      original_filename: originalFileName,
      storage_path: storagePath,
      storage_encoding: "gzip",
      file_size: Number(input.fileSize || raw.length),
      compressed_size: gz.length,
      duration: Number(input.duration || 0),
      sample_count: Number(input.samples || 0),
      channel_count: Number(input.channelCount || 0),
      channel_names: (input.channelNames ?? []).slice(0, 500),
      sha256_hash: hash,
    }
    try {
      const rows = await request<CloudRow[] | CloudRow>(`/rest/v1/${TABLE}?select=${SELECT}`, token, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(payload),
      })
      return toSummary(firstRow(rows))
    } catch (e) {
      // keep storage and the table in step: drop the file if the row failed
      await request(`/storage/v1/object/${BUCKET}/${encodePath(storagePath)}`, token, { method: "DELETE" }).catch(() => undefined)
      throw e
    }
  },

  async update(input) {
    const { token } = await requireAdminWeb()
    const rows = await request<CloudRow[] | CloudRow>(`/rest/v1/${TABLE}?id=eq.${encodeURIComponent(input.id)}&select=${SELECT}`, token, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ custom_name: input.customName.trim(), comment: input.comment.trim(), updated_at: new Date().toISOString() }),
    })
    return toSummary(firstRow(rows))
  },

  async delete(id) {
    const { token } = await requireAdminWeb()
    const row = await findRow(token, id)
    if (!row) return { ok: true }
    if (row.storage_path) {
      await request(`/storage/v1/object/${BUCKET}/${encodePath(row.storage_path)}`, token, { method: "DELETE" }).catch(() => undefined)
    }
    await request(`/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`, token, { method: "DELETE" })
    return { ok: true }
  },

  async download(id) {
    const { token } = await requireAdminWeb()
    const row = await findRow(token, id)
    if (!row || !row.storage_path) throw new Error("That cloud log is no longer available.")
    let res: Response
    try {
      res = await fetch(`${SUPABASE.url}/storage/v1/object/authenticated/${BUCKET}/${encodePath(row.storage_path)}`, {
        headers: { apikey: SUPABASE.anonKey, Authorization: `Bearer ${token}` },
      })
    } catch (e) {
      throw new Error(`Cannot reach the cloud log file. ${e instanceof Error ? e.message : ""}`.trim(), { cause: e })
    }
    if (!res.ok) throw new Error(`Cloud log download failed (${res.status})`)
    let bytes: Uint8Array = new Uint8Array(await res.arrayBuffer())
    if (row.storage_encoding === "gzip" || row.storage_path.endsWith(".gz")) bytes = await gunzipBytes(bytes)
    const text = new TextDecoder().decode(bytes)
    const fileName = displayName(row)
    return { id: row.id, fileName, originalFileName: row.original_filename || fileName, text, byteSize: bytes.length, cached: false }
  },
}

/** Save a cloud log to this device as a .csv file (PC: Downloads / save dialog). */
export function saveCloudLogFile(log: CloudLogDownload) {
  const blob = new Blob([log.text], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = /\.[a-z0-9]+$/i.test(log.fileName) ? log.fileName : `${log.fileName}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function listCloudLogs(): Promise<CloudLogSummary[]> {
  return requireBridge().list()
}

export async function uploadCloudLog(payload: CloudLogUploadPayload): Promise<CloudLogSummary> {
  return requireBridge().upload(payload)
}

export async function updateCloudLog(payload: { id: string; customName: string; comment: string }): Promise<CloudLogSummary> {
  return requireBridge().update(payload)
}

export async function deleteCloudLog(id: string): Promise<{ ok: boolean }> {
  return requireBridge().delete(id)
}

export async function downloadCloudLog(id: string): Promise<CloudLogDownload> {
  return requireBridge().download(id)
}
