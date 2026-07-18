"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Download, Loader2, RefreshCw, TriangleAlert, X } from "lucide-react"
import { GITHUB_URL, isDesktop } from "@/lib/app-info"
import { checkForUpdates, installUpdate, subscribeToUpdates, type UpdateStatus } from "@/lib/updates"
import { OctaneLogo } from "./logo"

const initialStatus: UpdateStatus = {
  phase: "idle",
  percent: 0,
  message: "Ready to check for Octane updates.",
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 MB"
  const mb = bytes / 1024 / 1024
  if (mb < 10) return `${mb.toFixed(1)} MB`
  return `${Math.round(mb)} MB`
}

function statusTitle(status: UpdateStatus): string {
  switch (status.phase) {
    case "checking":
      return "Checking for updates"
    case "available":
    case "downloading":
      return status.version ? `Downloading Octane ${status.version}` : "Downloading update"
    case "ready":
      return "Update ready"
    case "installing":
      return "Installing update"
    case "not-available":
      return "Octane is up to date"
    case "error":
      return "Update failed"
    default:
      return "Octane updates"
  }
}

function statusIcon(status: UpdateStatus) {
  if (status.phase === "error") return <TriangleAlert className="size-5" />
  if (status.phase === "not-available" || status.phase === "ready") return <CheckCircle2 className="size-5" />
  if (status.phase === "downloading" || status.phase === "available") return <Download className="size-5" />
  return <Loader2 className="size-5 animate-spin" />
}

export function UpdateModal() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<UpdateStatus>(initialStatus)
  const [checking, setChecking] = useState(false)

  const percent = Math.max(0, Math.min(100, status.percent ?? 0))
  const active = status.phase === "checking" || status.phase === "available" || status.phase === "downloading" || status.phase === "installing"
  const canInstall = status.phase === "ready"
  const canClose = !active

  const detail = useMemo(() => {
    if (status.phase !== "downloading") return status.message
    const downloaded = formatBytes(status.transferred)
    const total = formatBytes(status.total)
    return `${downloaded} of ${total}`
  }, [status])

  async function beginCheck() {
    if (!isDesktop()) {
      setStatus({ phase: "not-available", message: "Updates are only available in the installed app." })
      setOpen(true)
      return
    }

    setOpen(true)
    setChecking(true)
    setStatus({ phase: "checking", percent: 0, message: "Checking GitHub releases..." })
    try {
      await checkForUpdates()
    } finally {
      setChecking(false)
    }
  }

  async function beginInstall() {
    setStatus((current) => ({
      ...current,
      phase: "installing",
      percent: 100,
      message: "Closing Octane and launching the installer...",
    }))
    await installUpdate()
  }

  useEffect(() => {
    return subscribeToUpdates((next) => {
      setStatus((current) => ({ ...current, ...next }))
      setOpen(true)
      if (next.phase !== "checking") setChecking(false)
    })
  }, [])

  useEffect(() => {
    const openUi = () => setOpen(true)
    window.addEventListener("octane:update-ui-open", openUi)
    ;(window as unknown as { __octaneCheckUpdates?: () => void }).__octaneCheckUpdates = beginCheck
    return () => {
      window.removeEventListener("octane:update-ui-open", openUi)
      delete (window as unknown as { __octaneCheckUpdates?: () => void }).__octaneCheckUpdates
    }
  })

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      onClick={() => {
        if (canClose) setOpen(false)
      }}
    >
      <div
        className="relative w-full max-w-md rounded-xl border border-border bg-popover p-5 text-foreground shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {canClose && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}

        <div className="flex items-start gap-3 pr-8">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <OctaneLogo className="size-7" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-muted-foreground">Octane updater</p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{statusTitle(status)}</h2>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-border bg-card/60 p-4">
          <div className="flex items-center gap-3">
            <span
              className={
                status.phase === "error"
                  ? "text-destructive"
                  : status.phase === "not-available" || status.phase === "ready"
                    ? "text-accent"
                    : "text-primary"
              }
            >
              {statusIcon(status)}
            </span>
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">{detail || "Preparing update check..."}</p>
          </div>

          {(status.phase === "downloading" || status.phase === "installing" || status.phase === "ready") && (
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{status.phase === "installing" ? "Installing" : "Downloaded"}</span>
                <span>{Math.round(percent)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${percent}%` }} />
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          {status.phase === "error" && (
            <a
              href={`${GITHUB_URL}/releases/latest`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Download className="size-4" />
              Open release
            </a>
          )}

          {canInstall ? (
            <button
              type="button"
              onClick={() => void beginInstall()}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Download className="size-4" />
              Install now
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void beginCheck()}
              disabled={active || checking}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {active || checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Check again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
