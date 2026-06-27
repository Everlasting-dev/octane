"use client"

import { X } from "lucide-react"
import { FileMeta } from "./file-meta"
import type { ParsedLog } from "@/lib/csv"

export function MetadataModal({
  open,
  log,
  onClose,
}: {
  open: boolean
  log: ParsedLog | null
  onClose: () => void
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-sm font-semibold text-foreground">File metadata</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          {log ? <FileMeta log={log} /> : <p className="text-sm text-muted-foreground">No log loaded.</p>}
        </div>
      </div>
    </div>
  )
}
