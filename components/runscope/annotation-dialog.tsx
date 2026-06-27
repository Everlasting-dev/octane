"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { ANNOTATION_TYPES, type AnnotationType } from "@/lib/annotations"

export interface AnnotationDraft {
  t: number
  channel: string
}

export function AnnotationDialog({
  draft,
  timeUnit,
  onSave,
  onClose,
}: {
  draft: AnnotationDraft
  timeUnit: string
  onSave: (type: AnnotationType, note: string) => void
  onClose: () => void
}) {
  const [type, setType] = useState<AnnotationType>("custom")
  const [note, setNote] = useState("")

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-popover p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Add Annotation</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
            <span className="text-muted-foreground">Time</span>
            <span className="font-mono tabular-nums text-foreground">
              {draft.t.toFixed(3)}
              {timeUnit}
            </span>
          </div>
          {draft.channel && (
            <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
              <span className="text-muted-foreground">Channel</span>
              <span className="truncate text-foreground" title={draft.channel}>
                {draft.channel}
              </span>
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AnnotationType)}
              className="h-9 rounded-md border border-border bg-card px-2 text-sm text-foreground focus:border-ring focus:outline-none"
            >
              {ANNOTATION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Note</span>
            <textarea
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Add a note about this event…"
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(type, note.trim())}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
