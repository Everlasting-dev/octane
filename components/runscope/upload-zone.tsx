"use client"

import { useRef, useState } from "react"
import { FileUp, Loader2, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"

interface UploadZoneProps {
  onFile: (file: File) => void
  onSample?: () => void
  loading?: boolean
  error?: string | null
  compact?: boolean
}

export function UploadZone({ onFile, onSample, loading, error, compact }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    onFile(files[0])
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        handleFiles(e.dataTransfer.files)
      }}
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed text-center transition-colors",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-20",
        dragOver ? "border-primary bg-primary/5" : "border-border bg-card/40",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <span
        className={cn(
          "inline-flex items-center justify-center rounded-xl bg-primary/10 text-primary",
          compact ? "size-9" : "size-12",
        )}
      >
        {loading ? (
          <Loader2 className={cn("animate-spin", compact ? "size-4" : "size-6")} />
        ) : (
          <FileUp className={compact ? "size-4" : "size-6"} />
        )}
      </span>

      <div className="flex flex-col gap-1">
        <p className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-base")}>
          {loading ? "Parsing log…" : "Drop a CSV log to analyze"}
        </p>
        {!loading && (
          <p className="text-sm text-muted-foreground">
            EcuTek or generic telemetry exports (.csv, .txt)
          </p>
        )}
      </div>

      {!loading && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Browse files
          </button>
          {onSample && (
            <button
              type="button"
              onClick={onSample}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
            >
              Load sample data
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-destructive">
          <TriangleAlert className="size-4" />
          {error}
        </p>
      )}
    </div>
  )
}
