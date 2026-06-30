"use client"

import type { ParsedLog } from "@/lib/csv"

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right font-mono text-xs text-foreground">{value}</span>
    </div>
  )
}

export function FileMeta({ log }: { log: ParsedLog }) {
  const { meta } = log
  const empty = !meta.vin && meta.calIds.length === 0 && meta.fields.length === 0
  return (
    <div className="flex flex-col">
      <div className="divide-y divide-border">
        <MetaRow label="File" value={log.fileName} />
        <MetaRow label="Size" value={log.sizeLabel} />
        <MetaRow label="Samples" value={log.samples.toLocaleString()} />
        <MetaRow label="Duration" value={`${log.duration.toFixed(1)}${log.indexed ? "" : "s"}`} />
        {/* VIN intentionally omitted here — shown once (masked, with reveal) in the Vehicle card. */}
        {meta.calIds.length > 0 && <MetaRow label="Calibration / dongle IDs" value={meta.calIds.join(", ")} />}
        {meta.capturedAt && <MetaRow label="Captured" value={meta.capturedAt} />}
        {meta.fields
          .filter((f) => !/vin/i.test(f.key))
          .map((f, i) => (
            <MetaRow key={i} label={f.key || "Note"} value={f.value} />
          ))}
      </div>
      {empty && (
        <p className="mt-2 text-xs text-muted-foreground">No embedded calibration metadata found in this file.</p>
      )}
    </div>
  )
}
