"use client"

import { FileText, X } from "lucide-react"
import { cn } from "@/lib/utils"

export interface LogFile {
  id: string
  name: string
  size: string
  samples: number
}

interface LoadedFilesProps {
  files: LogFile[]
  activeIndex: number
  compare: boolean
  /** color per file index, used when comparing */
  colors: string[]
  onSelect: (index: number) => void
  onRemove: (index: number) => void
}

export function LoadedFiles({ files, activeIndex, compare, colors, onSelect, onRemove }: LoadedFilesProps) {
  return (
    <section className="rounded-xl border border-border bg-card/60">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-accent">Loaded Files</h2>
        <span className="font-mono text-xs text-muted-foreground">
          {files.length} {files.length === 1 ? "capture" : "captures"}
          {compare && files.length > 1 ? " · comparing" : ""}
        </span>
      </header>
      <ul className="divide-y divide-border">
        {files.map((file, i) => {
          const active = i === activeIndex
          return (
            <li
              key={file.id}
              className={cn(
                "flex items-center gap-3 px-4 py-3 transition-colors",
                !compare && "cursor-pointer hover:bg-secondary/40",
                !compare && active && "bg-secondary/30",
              )}
              onClick={() => !compare && onSelect(i)}
            >
              <span
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
                style={compare ? { color: colors[i % colors.length] } : undefined}
              >
                <FileText className="size-4" />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Log {i + 1}
                  {!compare && active && <span className="text-primary">· active</span>}
                  {compare && (
                    <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: colors[i % colors.length] }} />
                  )}
                </span>
                <span className="truncate text-sm text-foreground" title={file.name}>
                  {file.name}
                </span>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-4 text-right">
                <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                  {file.samples.toLocaleString()} samples
                </span>
                <span className="font-mono text-xs text-muted-foreground">{file.size}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(i)
                  }}
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
