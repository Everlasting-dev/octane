"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Cloud, Download, Loader2, Pencil, RefreshCw, Search, Trash2, TriangleAlert, Upload, X } from "lucide-react"
import { parseLog, type ParsedLog } from "@/lib/csv"
import {
  deleteCloudLog,
  downloadCloudLog,
  listCloudLogs,
  updateCloudLog,
  uploadCloudLog,
  type CloudLogSummary,
} from "@/lib/cloud-logs"
import { friendlyCloudLogError, friendlyFileError, type FriendlyError } from "@/lib/friendly-errors"
import { cn } from "@/lib/utils"

type Mode = "library" | "upload"

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(2)} MB`
}

function formatDate(value: string): string {
  if (!value) return "Unknown"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Unknown"
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function defaultName(log: ParsedLog | null): string {
  return log?.fileName?.replace(/\.[^.]+$/, "") ?? ""
}

function ErrorCard({ error }: { error: FriendlyError }) {
  return (
    <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">{error.title}</p>
          <p className="mt-0.5 text-destructive/90">{error.message}</p>
          {error.details && (
            <details className="mt-1 text-xs text-destructive/80">
              <summary className="cursor-pointer select-none">Technical details</summary>
              <p className="mt-1 break-words font-mono leading-relaxed">{error.details}</p>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}

export function CloudLogsDialog({
  open,
  activeLog,
  onClose,
  onLoad,
}: {
  open: boolean
  activeLog: ParsedLog | null
  onClose: () => void
  onLoad: (log: ParsedLog) => void
}) {
  const [mode, setMode] = useState<Mode>("library")
  const [logs, setLogs] = useState<CloudLogSummary[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [customName, setCustomName] = useState("")
  const [comment, setComment] = useState("")
  const [editing, setEditing] = useState<{ id: string; customName: string; comment: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<CloudLogSummary | null>(null)

  const canUpload = !!activeLog?.sourceText

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return logs
    return logs.filter((log) =>
      [
        log.customName,
        log.comment,
        log.originalFileName,
        log.displayFileName,
        log.channelNames.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    )
  }, [logs, query])

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      setLogs(await listCloudLogs())
    } catch (err) {
      setError(friendlyCloudLogError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setMode("library")
    setQuery("")
    setError(null)
    setNotice(null)
    setEditing(null)
    setConfirmDelete(null)
    setCustomName(defaultName(activeLog))
    setComment("")
    void refresh()
  }, [activeLog, open])

  async function uploadCurrent() {
    if (!activeLog) return
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await uploadCloudLog({
        originalFileName: activeLog.fileName,
        customName: customName.trim() || defaultName(activeLog) || activeLog.fileName,
        comment,
        text: activeLog.sourceText || "",
        fileSize: activeLog.sourceByteSize || activeLog.sourceText?.length || 0,
        duration: activeLog.duration,
        samples: activeLog.samples,
        channelCount: activeLog.signals.length,
        channelNames: activeLog.signals.map((signal) => signal.label),
      })
      setLogs((current) => [saved, ...current])
      setNotice(
        `Saved "${saved.customName || saved.displayFileName}" - ${formatBytes(saved.fileSize)} compressed to ${formatBytes(saved.compressedSize)}.`,
      )
      setMode("library")
      setComment("")
    } catch (err) {
      setError(friendlyCloudLogError(err))
    } finally {
      setLoading(false)
    }
  }

  async function loadCloudLog(log: CloudLogSummary) {
    setBusyId(log.id)
    setError(null)
    setNotice(null)
    try {
      const payload = await downloadCloudLog(log.id)
      const parsed = parseLog(payload.text, payload.originalFileName || payload.fileName, payload.byteSize)
      parsed.fileName = payload.fileName
      onLoad(parsed)
      setNotice(payload.cached ? "Loaded from local cache." : "Downloaded and loaded.")
    } catch (err) {
      const fileError = friendlyFileError(err, log.displayFileName)
      const cloudError = friendlyCloudLogError(err)
      setError(cloudError.title === "Cloud Logs error" ? fileError : cloudError)
    } finally {
      setBusyId(null)
    }
  }

  async function saveEdit() {
    if (!editing) return
    setBusyId(editing.id)
    setError(null)
    setNotice(null)
    try {
      const updated = await updateCloudLog(editing)
      setLogs((current) => current.map((log) => (log.id === updated.id ? updated : log)))
      setEditing(null)
      setNotice("Cloud log details saved.")
    } catch (err) {
      setError(friendlyCloudLogError(err))
    } finally {
      setBusyId(null)
    }
  }

  async function removeLog(log: CloudLogSummary) {
    setBusyId(log.id)
    setError(null)
    setNotice(null)
    try {
      await deleteCloudLog(log.id)
      setLogs((current) => current.filter((item) => item.id !== log.id))
      setConfirmDelete(null)
      setNotice("Cloud log deleted.")
    } catch (err) {
      setError(friendlyCloudLogError(err))
    } finally {
      setBusyId(null)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-popover text-foreground shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Cloud className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">Cloud Logs</h2>
              <p className="truncate text-xs text-muted-foreground">Metadata lists only; files download only when you choose a log</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            {(["library", "upload"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setMode(item)
                  setError(null)
                  setNotice(null)
                }}
                className={cn(
                  "rounded px-3 py-1.5 text-xs font-medium transition-colors",
                  mode === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {item === "library" ? "Library" : "Upload current"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </button>
          {mode === "library" && (
            <div className="relative ml-auto min-w-[14rem] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search cloud logs..."
                className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
          {error && <ErrorCard error={error} />}
          {notice && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-primary">
              <CheckCircle2 className="size-4" />
              {notice}
            </div>
          )}
          {confirmDelete && (
            <div className="rounded-xl border border-destructive/35 bg-destructive/10 p-4 text-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">Delete cloud log?</p>
                  <p className="mt-1 break-words text-muted-foreground">
                    {confirmDelete.customName || confirmDelete.originalFileName} will be removed from the cloud library and local cache.
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(null)}
                    className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeLog(confirmDelete)}
                    disabled={busyId === confirmDelete.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-destructive/45 bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
                  >
                    {busyId === confirmDelete.id && <Loader2 className="size-3.5 animate-spin" />}
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}

          {mode === "upload" ? (
            <section className="rounded-xl border border-border bg-card/60 p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                  Custom name
                  <input
                    value={customName}
                    onChange={(event) => setCustomName(event.target.value)}
                    placeholder="Reference name"
                    className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                  />
                </label>
                <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">{activeLog?.fileName ?? "No active log"}</p>
                  <p className="mt-1">
                    {activeLog ? `${activeLog.samples.toLocaleString()} samples - ${activeLog.signals.length} channels - ${activeLog.duration.toFixed(1)}s` : "Open a log before uploading."}
                  </p>
                </div>
              </div>
              <label className="mt-3 flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                Comment
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Why this log matters, tune version, car state, notes..."
                  rows={4}
                  className="resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
              </label>
              {!canUpload && (
                <p className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                  Reopen the original CSV/TXT before uploading. Logs loaded before this feature may not have their original file text attached.
                </p>
              )}
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => void uploadCurrent()}
                  disabled={!canUpload || loading}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  Save to Cloud
                </button>
              </div>
            </section>
          ) : (
            <section className="overflow-hidden rounded-xl border border-border bg-card/60">
              {loading && logs.length === 0 ? (
                <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading cloud logs...
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {logs.length === 0 ? "No cloud logs saved yet." : "No cloud logs match the search."}
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map((log) => {
                    const isEditing = editing?.id === log.id
                    return (
                      <li key={log.id} className="p-4">
                        {isEditing ? (
                          <div className="grid gap-3">
                            <input
                              value={editing.customName}
                              onChange={(event) => setEditing({ ...editing, customName: event.target.value })}
                              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                            />
                            <textarea
                              value={editing.comment}
                              onChange={(event) => setEditing({ ...editing, comment: event.target.value })}
                              rows={3}
                              className="resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditing(null)}
                                className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => void saveEdit()}
                                disabled={busyId === log.id}
                                className="rounded-md border border-border bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <h3 className="truncate text-sm font-semibold text-foreground">{log.customName || log.displayFileName}</h3>
                                {log.cached && (
                                  <span className="rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-primary">
                                    cached
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 break-words text-sm text-muted-foreground">{log.comment || "No comment added."}</p>
                              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                                {log.originalFileName} - {log.samples.toLocaleString()} samples - {log.channelCount} channels - {formatBytes(log.compressedSize || log.fileSize)} - {formatDate(log.uploadedAt)}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void loadCloudLog(log)}
                                disabled={busyId === log.id}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                              >
                                {busyId === log.id ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                                {log.cached ? "Load cached" : `Download ${formatBytes(log.compressedSize || log.fileSize)}`}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditing({ id: log.id, customName: log.customName || log.displayFileName, comment: log.comment })}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                              >
                                <Pencil className="size-3.5" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDelete(log)}
                                disabled={busyId === log.id}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-60"
                              >
                                <Trash2 className="size-3.5" />
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
