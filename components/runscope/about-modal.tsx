"use client"

import { useEffect, useState } from "react"
import { ExternalLink, RefreshCw, X } from "lucide-react"
import { OctaneLogo } from "./logo"
import { getAppVersion, checkForUpdates, isDesktop, GITHUB_URL } from "@/lib/app-info"
import { getAuthState } from "@/lib/auth"

export function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [version, setVersion] = useState("")
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    getAppVersion().then(setVersion)
    getAuthState().then((s) => setEmail(s.user?.email ?? null))
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs rounded-xl border border-border bg-popover p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        <div className="flex flex-col items-center gap-3 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <OctaneLogo className="size-9" />
          </span>
          <div>
            <h3 className="text-base font-semibold text-foreground">Octane</h3>
            <p className="font-mono text-xs text-muted-foreground">version {version || "…"}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-col divide-y divide-border text-xs">
          <div className="flex items-center justify-between py-2">
            <span className="text-muted-foreground">Signed in as</span>
            <span className="max-w-[180px] truncate text-foreground" title={email ?? undefined}>
              {email ?? "—"}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {isDesktop() && (
            <button
              type="button"
              onClick={() => checkForUpdates()}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
            >
              <RefreshCw className="size-3.5" />
              Check for updates
            </button>
          )}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
            Octane on GitHub
          </a>
        </div>

        <p className="mt-4 text-center text-[10px] text-muted-foreground">© AK Everlasting Dev · ECU telemetry analyzer</p>
      </div>
    </div>
  )
}
