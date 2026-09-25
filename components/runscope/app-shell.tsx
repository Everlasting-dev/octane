"use client"

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { Loader2, TriangleAlert } from "lucide-react"
import { Landing } from "./landing"
import type { DashboardHandle } from "./dashboard"
import { LoginScreen } from "./login-screen"
import { ErrorBoundary } from "./error-boundary"
import { UpdateModal } from "./update-modal"
import { AboutModal } from "./about-modal"
import { getAuthState, logout, type AuthUser } from "@/lib/auth"
import { parseLog, parseLogFile, type ParsedLog } from "@/lib/csv"
import { acknowledgeDesktopOpen, getPendingDesktopOpen, subscribeToDesktopOpen, type DesktopOpenLogPayload } from "@/lib/desktop-files"
import { friendlyAuthError, friendlyFileError, type FriendlyError } from "@/lib/friendly-errors"

const Dashboard = lazy(async () => ({ default: (await import("./dashboard")).Dashboard }))

function CenteredLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  )
}

export function AppShell() {
  const [authState, setAuthState] = useState<"checking" | "in" | "out">("checking")
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [inAnalysis, setInAnalysis] = useState(false)
  const [initialLog, setInitialLog] = useState<ParsedLog | null>(null)
  const [showLandingOverlay, setShowLandingOverlay] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [authError, setAuthError] = useState<FriendlyError | null>(null)
  const [desktopOpenError, setDesktopOpenError] = useState<FriendlyError | null>(null)
  const dashRef = useRef<DashboardHandle>(null)
  const handledDesktopOpenIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    getAuthState().then((s) => {
      setAuthUser(s.user ?? null)
      setAuthError(!s.authenticated && (s.error || s.message) ? friendlyAuthError(s.error || s.message) : null)
      setAuthState(s.authenticated ? "in" : "out")
    })
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

  const openLogFileDialog = useCallback(() => {
    if (authState !== "in") {
      setDesktopOpenError({ title: "Sign in required", message: "Sign in before opening a log from the desktop menu." })
      return
    }
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".csv,.txt,text/csv,text/plain"
    input.style.position = "fixed"
    input.style.left = "-9999px"
    document.body.appendChild(input)
    const cleanup = () => {
      try {
        document.body.removeChild(input)
      } catch {
        /* already removed */
      }
    }
    input.addEventListener(
      "change",
      async () => {
        const file = input.files?.[0]
        cleanup()
        if (!file) return
        try {
          openLog(await parseLogFile(file))
        } catch (e) {
          setDesktopOpenError(friendlyFileError(e, file.name))
        }
      },
      { once: true },
    )
    setTimeout(cleanup, 5 * 60 * 1000)
    input.click()
  }, [authState, openLog])

  useEffect(() => {
    const globals = window as unknown as {
      __octaneOpenLog?: () => void
      __octaneOpenAbout?: () => void
    }
    globals.__octaneOpenLog = openLogFileDialog
    globals.__octaneOpenAbout = () => setShowAbout(true)
    return () => {
      delete globals.__octaneOpenLog
      delete globals.__octaneOpenAbout
    }
  }, [openLogFileDialog])

  async function signOut() {
    await logout()
    setAuthUser(null)
    setAuthError(null)
    setAuthState("out")
    setInAnalysis(false)
    setShowLandingOverlay(false)
    setInitialLog(null)
  }

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
        setDesktopOpenError(friendlyFileError(e, payload.fileName))
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
    <div className="fixed left-1/2 top-4 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-start gap-3 rounded-lg border border-destructive/40 bg-popover px-3 py-2 text-sm text-destructive shadow-xl">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">{desktopOpenError.title}</p>
        <p className="mt-0.5 max-w-xl break-words text-destructive/90">{desktopOpenError.message}</p>
        {desktopOpenError.details && (
          <details className="mt-1 text-xs text-destructive/80">
            <summary className="cursor-pointer select-none">Technical details</summary>
            <p className="mt-1 break-words font-mono leading-relaxed">{desktopOpenError.details}</p>
          </details>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDesktopOpenError(null)}
        className="ml-auto shrink-0 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        Dismiss
      </button>
    </div>
  ) : null

  if (authState === "checking") {
    return (
      <>
        <CenteredLoader />
        {desktopErrorBanner}
        <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />
        <UpdateModal />
      </>
    )
  }

  if (authState === "out") {
    return (
      <>
        <LoginScreen
          initialError={authError}
          onSuccess={(state) => {
            setAuthUser(state.user ?? null)
            setAuthError(null)
            setAuthState("in")
          }}
        />
        {desktopErrorBanner}
        <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />
        <UpdateModal />
      </>
    )
  }

  // Authenticated. Landing first; Dashboard mounts on first open and stays alive.
  const showLanding = !inAnalysis || showLandingOverlay

  return (
    <ErrorBoundary>
      <Suspense fallback={<CenteredLoader />}>
        {inAnalysis && (
          <Dashboard
            ref={dashRef}
            initialLog={initialLog}
            accountUser={authUser}
            accountEmail={authUser?.email ?? null}
            onHome={() => setShowLandingOverlay(true)}
          />
        )}
      </Suspense>
      {showLanding && (
        <div className="octane-landing-overlay fixed inset-0 z-40 overflow-auto bg-background">
          <Landing
            onOpen={openLog}
            canResume={inAnalysis}
            onResume={() => setShowLandingOverlay(false)}
            accountUser={authUser}
            accountEmail={authUser?.email ?? null}
            onLogout={() => void signOut()}
          />
        </div>
      )}
      {desktopErrorBanner}
      <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />
      <UpdateModal />
    </ErrorBoundary>
  )
}
