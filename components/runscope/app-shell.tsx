"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { Landing } from "./landing"
import { Dashboard, type DashboardHandle } from "./dashboard"
import { LoginScreen } from "./login-screen"
import { ErrorBoundary } from "./error-boundary"
import { getAuthState } from "@/lib/auth"
import type { ParsedLog } from "@/lib/csv"

export function AppShell() {
  const [authState, setAuthState] = useState<"checking" | "in" | "out">("checking")
  const [inAnalysis, setInAnalysis] = useState(false)
  const [initialLog, setInitialLog] = useState<ParsedLog | null>(null)
  const dashRef = useRef<DashboardHandle>(null)

  useEffect(() => {
    getAuthState().then((s) => setAuthState(s.authenticated ? "in" : "out"))
  }, [])

  function openLog(log: ParsedLog | null) {
    if (!inAnalysis) {
      setInitialLog(log)
      setInAnalysis(true)
    } else {
      if (log) dashRef.current?.loadParsedLog(log)
    }
    setShowLandingOverlay(false)
  }

  const [showLandingOverlay, setShowLandingOverlay] = useState(false)

  if (authState === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  if (authState === "out") {
    return <LoginScreen onSuccess={() => setAuthState("in")} />
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
    </ErrorBoundary>
  )
}
