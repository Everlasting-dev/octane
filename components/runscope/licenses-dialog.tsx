"use client"

import { useCallback, useEffect, useState } from "react"
import { KeyRound, Loader2, Monitor, RefreshCw, X } from "lucide-react"
import { listLicenses, renewLicense, type LicenseAccount } from "@/lib/auth"
import { cn } from "@/lib/utils"

const DAY = 24 * 60 * 60 * 1000

function daysLeft(expiresAt: string): { label: string; expired: boolean } {
  const ms = Date.parse(expiresAt) - Date.now()
  if (ms <= 0) return { label: `expired ${Math.ceil(-ms / DAY)}d ago`, expired: true }
  const d = Math.floor(ms / DAY)
  return { label: d >= 1 ? `${d}d left` : `${Math.max(1, Math.ceil(ms / 3600000))}h left`, expired: false }
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—")

/** Owner-only: every Octane account, its 15-day license, its PCs, and Renew. */
export function LicensesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [accounts, setAccounts] = useState<LicenseAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await listLicenses()
    if (res.ok) setAccounts(res.accounts)
    else setError(res.error)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  if (!open) return null

  async function renew(a: LicenseAccount) {
    setBusy(a.user_id)
    const res = await renewLicense(a.user_id)
    if (!res.ok) setError(res.error)
    await load()
    setBusy(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Licenses">
      <div className="flex max-h-[min(88dvh,46rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Owner</p>
            <h3 className="mt-1 text-lg font-semibold text-foreground">Licenses</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Each account gets 15 days from its first ever sign-in. Renew adds 15 days (from today, or from the expiry if it hasn&apos;t passed).
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
              aria-label="Refresh"
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </button>
            <button type="button" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        </div>

        {error && <div className="mx-5 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading && accounts.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading accounts…
            </div>
          )}
          {!loading && accounts.length === 0 && !error && <p className="py-12 text-center text-sm text-muted-foreground">No accounts have signed in yet.</p>}
          {accounts.map((a) => {
            const left = daysLeft(a.expires_at)
            return (
              <div key={a.user_id} className="mb-2 rounded-lg border border-border bg-card/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{a.email}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      first sign-in {fmt(a.first_login_at)} · expires {fmt(a.expires_at)} · renewed {a.renew_count}×
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-md border px-2 py-0.5 font-mono text-xs",
                        left.expired ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-accent/40 bg-accent/10 text-accent",
                      )}
                    >
                      {left.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => void renew(a)}
                      disabled={busy === a.user_id}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                    >
                      {busy === a.user_id ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
                      Renew 15 days
                    </button>
                  </div>
                </div>
                {a.machines.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {a.machines.map((m) => (
                      <span
                        key={m.machine_id}
                        title={`PC id ${m.machine_id.slice(0, 12)}… · first seen ${fmt(m.first_seen)}`}
                        className="inline-flex items-center gap-1 rounded border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        <Monitor className="size-3" />
                        {m.machine_name || "PC"} · v{m.app_version || "?"} · last {fmt(m.last_seen)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Full-screen lock shown when a (non-owner) account's 15 days have run out. */
export function LicenseExpiredScreen({ email, expiresAt, onSignOut, onRetry }: { email?: string; expiresAt?: number; onSignOut: () => void; onRetry: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-md rounded-xl border border-border bg-card/60 p-6 text-center shadow-2xl">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <KeyRound className="size-6" />
        </span>
        <h1 className="mt-4 text-xl font-semibold">License expired</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The 15-day license for <span className="font-medium text-foreground">{email || "this account"}</span> ended
          {expiresAt ? ` on ${new Date(expiresAt).toLocaleString()}` : ""}. Ask the Octane owner to renew it, then press Check again.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <button type="button" onClick={onRetry} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <RefreshCw className="size-4" />
            Check again
          </button>
          <button type="button" onClick={onSignOut} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm text-foreground hover:bg-secondary">
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
