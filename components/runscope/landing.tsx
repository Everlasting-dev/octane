"use client"

import { useRef, useState } from "react"
import { ArrowLeft, FileUp, GitCompare, LayoutList, Loader2, MapPin, TriangleAlert, Upload } from "lucide-react"
import { parseLogFile, type ParsedLog } from "@/lib/csv"
import { SAMPLE_LOG } from "@/lib/sample"
import { cn } from "@/lib/utils"
import { OctaneLogo } from "./logo"

const FEATURES = [
  { icon: LayoutList, title: "Signal Matrix", text: "Plot every channel on a synced time axis and click to inspect exact values." },
  { icon: GitCompare, title: "Compare runs", text: "Overlay multiple logs and read time-aligned deltas across captures." },
  { icon: MapPin, title: "Annotate", text: "Pin knock, shift and boost events to timestamps; they persist per file." },
]

export function Landing({
  onOpen,
  canResume,
  onResume,
}: {
  onOpen: (log: ParsedLog | null) => void
  canResume?: boolean
  onResume?: () => void
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
      setError(e instanceof Error ? e.message : "Could not parse this file.")
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 px-6 py-4">
        <span className="inline-flex size-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <OctaneLogo className="size-5" />
        </span>
        <span className="text-sm font-semibold tracking-tight">Octane</span>
        {canResume && (
          <button
            type="button"
            onClick={onResume}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
          >
            <ArrowLeft className="size-3.5" />
            Back to analysis
          </button>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-10 px-6 py-12">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <OctaneLogo className="size-9" />
          </span>
          <h1 className="text-balance text-4xl font-semibold tracking-tight">Signal Matrix</h1>
          <p className="max-w-xl text-pretty text-base leading-relaxed text-muted-foreground">
            Client-side ECU log analysis. Import a CSV capture to inspect, compare and annotate your
            run data — nothing leaves your device.
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
            "flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border border-dashed px-6 py-10 text-center transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-border bg-card/40",
          )}
        >
          <span className="inline-flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {loading ? <Loader2 className="size-5 animate-spin" /> : <FileUp className="size-5" />}
          </span>
          <p className="text-sm text-muted-foreground">
            {loading ? "Parsing log…" : "Drop a CSV / TXT log here, or"}
          </p>
          {!loading && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
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

      <footer className="px-6 py-4 text-center text-xs text-muted-foreground">
        Octane · ECU telemetry analyzer
      </footer>
    </div>
  )
}
