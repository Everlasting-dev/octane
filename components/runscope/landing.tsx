"use client"

import { useRef, useState } from "react"
import { ArrowLeft, FileUp, GitCompare, LayoutList, Loader2, LogOut, MapPin, TriangleAlert, Upload } from "lucide-react"
import { parseLogFile, type ParsedLog } from "@/lib/csv"
import { SAMPLE_LOG } from "@/lib/sample"
import { cn } from "@/lib/utils"
import { friendlyFileError } from "@/lib/friendly-errors"
import { OctaneLogo } from "./logo"
import { LicenseBadge } from "./license-badge"

const FEATURES = [
  { icon: LayoutList, title: "Channel views", text: "Move between Signal Matrix, Analysis, and preset diagnostics without changing tools." },
  { icon: GitCompare, title: "Compare runs", text: "Overlay multiple logs and read time-aligned deltas across captures." },
  { icon: MapPin, title: "Annotate", text: "Pin knock, shift and boost events to timestamps; they persist per file." },
]

export function Landing({
  onOpen,
  canResume,
  onResume,
  accountEmail,
  onLogout,
}: {
  onOpen: (log: ParsedLog | null) => void
  canResume?: boolean
  onResume?: () => void
  accountEmail?: string | null
  onLogout?: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  async function handleFile(file: File) {
    setLoading(true)
    setError(null)
    try {
      const log = await parseLogFile(file)
      onOpen(log)
    } catch (e) {
      const friendly = friendlyFileError(e, file.name)
      setError(`${friendly.title}: ${friendly.message}`)
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 px-4 py-4 sm:px-6">
        <span className="inline-flex size-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <OctaneLogo className="size-5" />
        </span>
        <span className="text-sm font-semibold tracking-tight">Octane</span>
        {accountEmail && (
          <div className="ml-auto hidden items-center gap-2 sm:flex">
            <span className="max-w-[16rem] truncate rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground" title={accountEmail}>
              Signed in as <span className="text-foreground">{accountEmail}</span>
            </span>
            <LicenseBadge email={accountEmail} compact />
          </div>
        )}
        {canResume && (
          <button
            type="button"
            onClick={onResume}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary sm:ml-0"
          >
            <ArrowLeft className="size-3.5" />
            Back to analysis
          </button>
        )}
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <LogOut className="size-3.5" />
            Logout
          </button>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-8 px-4 py-8 sm:gap-10 sm:px-6 sm:py-12">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <OctaneLogo className="size-9" />
          </span>
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Octane</h1>
          <p className="max-w-xl text-pretty text-base leading-relaxed text-muted-foreground">
            ECU telemetry viewer for imported CSV logs. Inspect, compare, annotate, and build tuning
            diagnostics locally - nothing leaves your device.
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
            e.target.value = ""
          }}
        />

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f) handleFile(f)
          }}
          className={cn(
            "flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border border-dashed px-4 py-8 text-center transition-colors sm:px-6 sm:py-10",
            dragOver ? "border-primary bg-primary/5" : "border-border bg-card/40",
          )}
        >
          <span className="inline-flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {loading ? <Loader2 className="size-5 animate-spin" /> : <FileUp className="size-5" />}
          </span>
          <p className="text-sm text-muted-foreground">
            {loading ? "Parsing log..." : "Drop a CSV / TXT log here, or"}
          </p>
          {!loading && (
            <div className="flex w-full flex-col items-stretch justify-center gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Upload className="size-4" />
                Import CSV
              </button>
              <button
                type="button"
                onClick={() => onOpen(SAMPLE_LOG)}
                className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
              >
                Load sample data
              </button>
            </div>
          )}
          {error && (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <TriangleAlert className="size-4" />
              {error}
            </p>
          )}
        </div>

        <div className="grid w-full gap-4 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-card/40 p-4">
              <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="size-4" />
              </span>
              <h3 className="mt-3 text-sm font-semibold text-foreground">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="px-4 py-4 text-center text-xs text-muted-foreground sm:px-6">
        Octane - ECU telemetry analyzer
      </footer>
    </div>
  )
}
