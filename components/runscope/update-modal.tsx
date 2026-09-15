"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Download, Loader2, RefreshCw, ShieldCheck, TriangleAlert, X } from "lucide-react"
import { isDesktop } from "@/lib/app-info"
import { checkForUpdates, installUpdate, subscribeToUpdates, type UpdateStatus } from "@/lib/updates"
import { errorDetails, friendlyUpdateError } from "@/lib/friendly-errors"
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
  const friendlyError = useMemo(() => (status.phase === "error" ? friendlyUpdateError(status.message) : null), [status.message, status.phase])

  const detail = useMemo(() => {
    if (status.phase === "error") return friendlyError?.message
    if (status.phase !== "downloading") return status.message
    const downloaded = formatBytes(status.transferred)
    const total = formatBytes(status.total)
    return `${downloaded} of ${total}`
  }, [friendlyError, status])

  async function beginCheck() {
    if (!isDesktop()) {
      setStatus({ phase: "not-available", message: "Updates are only available in the installed app." })
      setOpen(true)
      return
    }

    setOpen(true)
    setChecking(true)
    setStatus({ phase: "checking", percent: 0, message: "Checking Octane updates..." })
    try {
      await checkForUpdates()
    } catch (error) {
      setStatus({ phase: "error", message: errorDetails(error) })
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
    try {
      await installUpdate()
    } catch (error) {
      setStatus({ phase: "error", message: errorDetails(error) })
    }
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
            {friendlyError ? (
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium text-foreground">{friendlyError.title}</p>
                <p className="mt-0.5 leading-relaxed text-muted-foreground">{detail || "Preparing update check..."}</p>
                {friendlyError.details && (
                  <details className="mt-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none">Technical details</summary>
                    <p className="mt-1 break-words font-mono leading-relaxed">{friendlyError.details}</p>
                  </details>
                )}
              </div>
            ) : (
              <p className="min-w-0 flex-1 text-sm text-muted-foreground">{detail || "Preparing update check..."}</p>
            )}
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

        <div className="mt-3 rounded-lg border border-border bg-card/40 p-3">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Certificate validation</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Windows verifies the installer signature before install. Trust this publisher on shop PCs by deploying the Octane signing certificate through Windows certificate management or policy.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
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
