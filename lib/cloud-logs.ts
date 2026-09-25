"use client"

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

function requireBridge(): CloudLogsBridge {
  const b = bridge()
  if (!b) throw new Error("Cloud Logs are available only in the Octane desktop app.")
  return b
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
