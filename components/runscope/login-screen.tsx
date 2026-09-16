"use client"

import { useEffect, useState } from "react"
import { FileUp, Keyboard, Layers3, Loader2, LogIn, Search, ShieldCheck, TriangleAlert } from "lucide-react"
import { login, type AuthState } from "@/lib/auth"
import { friendlyAuthError, type FriendlyError } from "@/lib/friendly-errors"
import { OctaneLogo } from "./logo"

const GUIDE = [
  { icon: FileUp, title: "Import ECU logs", text: "Open CSV/TXT captures, inspect channels locally, and keep file data on this machine." },
  { icon: Layers3, title: "Matrix, Analysis, Channels", text: "Use Signal Matrix for raw channels, Analysis for overlays/groups, and Channels for tuning presets." },
  { icon: Search, title: "Fast navigation", text: "Search channels, jump to plots, scrub the timeline, and compare visible values at the cursor." },
  { icon: ShieldCheck, title: "Desktop workflow", text: "Signed-in sessions are remembered; updates and desktop file-open run through the local Octane shell." },
]

const SHORTCUTS = [
  ["Ctrl+O", "Open log"],
  ["Ctrl+K", "Search channels"],
  ["?", "Shortcuts"],
  ["1 / 2 / 3 / 4", "Matrix / Analysis / Channels / Compare"],
  ["V", "Toggle plot picking"],
  ["E", "Edit Channels layout"],
  ["/", "Plot quick search"],
  ["F", "Fullscreen plot"],
]

export function LoginScreen({ onSuccess, initialError = null }: { onSuccess: (state: AuthState) => void; initialError?: FriendlyError | null }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<FriendlyError | null>(null)

  useEffect(() => {
    setError(initialError)
  }, [initialError])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await login(email.trim(), password)
      if (res.authenticated) onSuccess(res)
      else setError(friendlyAuthError(res.error || res.message))
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="octane-safe-inline flex min-h-dvh items-center justify-center bg-background px-4 py-6 text-foreground sm:px-6">
      <div className="grid w-full max-w-5xl gap-5 lg:grid-cols-[minmax(20rem,24rem)_1fr]">
        <div>
        <div className="mb-6 flex flex-col items-center gap-3 text-center lg:items-start lg:text-left">
          <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <OctaneLogo className="size-8" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Octane</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to continue</p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-border bg-card/60 p-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Email</span>
            <input
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              className="h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
              placeholder="you@example.com"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">{error.title}</p>
                <p className="mt-0.5 leading-relaxed">{error.message}</p>
                {error.details && (
                  <details className="mt-2 text-xs text-destructive/85">
                    <summary className="cursor-pointer select-none">Technical details</summary>
                    <p className="mt-1 break-words font-mono leading-relaxed">{error.details}</p>
                  </details>
                )}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="mt-1 inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
            Sign in
          </button>
        </form>
        </div>

        <section className="rounded-xl border border-border bg-card/40 p-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Keyboard className="size-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-foreground">Quick guide</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Octane is built for ECUtek-style log review: import a capture, find the signals you need, compare runs, and inspect exact cursor values without sending data away from the PC.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {GUIDE.map((item) => (
              <div key={item.title} className="rounded-lg border border-border bg-background/35 p-3">
                <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <item.icon className="size-4" />
                </span>
                <h3 className="mt-2 text-sm font-semibold text-foreground">{item.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 hidden rounded-lg border border-border bg-background/35 p-3 lg:block">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Shortcuts</h3>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              {SHORTCUTS.map(([combo, label]) => (
                <div key={combo} className="flex items-center justify-between gap-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-foreground">{combo}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </div>
    </div>
  )
}
