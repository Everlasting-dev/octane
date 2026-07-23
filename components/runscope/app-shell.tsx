"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { Landing } from "./landing"
import { Dashboard, type DashboardHandle } from "./dashboard"
import { LoginScreen } from "./login-screen"
import { ErrorBoundary } from "./error-boundary"
import { UpdateModal } from "./update-modal"
import { getAuthState } from "@/lib/auth"
import { parseLog, type ParsedLog } from "@/lib/csv"
import { acknowledgeDesktopOpen, getPendingDesktopOpen, subscribeToDesktopOpen, type DesktopOpenLogPayload } from "@/lib/desktop-files"

export function AppShell() {
  const [authState, setAuthState] = useState<"checking" | "in" | "out">("checking")
  const [inAnalysis, setInAnalysis] = useState(false)
  const [initialLog, setInitialLog] = useState<ParsedLog | null>(null)
  const [showLandingOverlay, setShowLandingOverlay] = useState(false)
  const [desktopOpenError, setDesktopOpenError] = useState<string | null>(null)
  const dashRef = useRef<DashboardHandle>(null)
  const handledDesktopOpenIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    getAuthState().then((s) => setAuthState(s.authenticated ? "in" : "out"))
  }, [])

  const openLog = useCallback((log: ParsedLog | null) => {
    if (!inAnalysis) {
      setInitialLog(log)
      setInAnalysis(true)
    } else {
      if (log) dashRef.current?.loadParsedLog(log)
    }
    setShowLandingOverlay(false)
  }, [inAnalysis])

  useEffect(() => {
    if (authState !== "in") return

    let mounted = true

    async function openDesktopPayload(payload: DesktopOpenLogPayload | null) {
      if (!mounted || !payload || handledDesktopOpenIds.current.has(payload.id)) return
      handledDesktopOpenIds.current.add(payload.id)

      try {
        if (payload.error) throw new Error(payload.error)
        if (typeof payload.text !== "string") throw new Error("No file contents were provided.")
        openLog(parseLog(payload.text, payload.fileName, payload.size ?? payload.text.length))
      } catch (e) {
        setDesktopOpenError(`Could not open ${payload.fileName}: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        await acknowledgeDesktopOpen(payload.id)
      }
    }

    getPendingDesktopOpen().then(openDesktopPayload)
    const unsubscribe = subscribeToDesktopOpen((payload) => {
      void openDesktopPayload(payload)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [authState, openLog])

  const desktopErrorBanner = desktopOpenError ? (
    <div className="fixed left-1/2 top-4 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-md border border-destructive/40 bg-popover px-3 py-2 text-sm text-destructive shadow-xl">
      <span className="min-w-0 truncate">{desktopOpenError}</span>
      <button
        type="button"
        onClick={() => setDesktopOpenError(null)}
        className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        Dismiss
      </button>
    </div>
  ) : null

  if (authState === "checking") {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
        {desktopErrorBanner}
        <UpdateModal />
      </>
    )
  }

  if (authState === "out") {
    return (
      <>
        <LoginScreen onSuccess={() => setAuthState("in")} />
        {desktopErrorBanner}
        <UpdateModal />
      </>
    )
  }

  // Authenticated. Landing first; Dashboard mounts on first open and stays alive.
  const showLanding = !inAnalysis || showLandingOverlay

  return (
    <ErrorBoundary>
      {inAnalysis && <Dashboard ref={dashRef} initialLog={initialLog} onHome={() => setShowLandingOverlay(true)} />}
      {showLanding && (
        <div className="fixed inset-0 z-40 overflow-auto bg-background">
          <Landing onOpen={openLog} canResume={inAnalysis} onResume={() => setShowLandingOverlay(false)} />
        </div>
      )}
      {desktopErrorBanner}
      <UpdateModal />
    </ErrorBoundary>
  )
}
