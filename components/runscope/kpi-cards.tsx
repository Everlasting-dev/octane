"use client"

import { Activity, Clock, Database, Gauge, Thermometer, Wind, Zap } from "lucide-react"
import type { Kpi } from "@/lib/kpis"

const ICONS = {
  clock: Clock,
  gauge: Gauge,
  speed: Zap,
  boost: Wind,
  channels: Activity,
  samples: Database,
  temp: Thermometer,
} as const

export function KpiCards({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
      {kpis.map((k) => {
        const Icon = ICONS[k.icon]
        return (
          <div key={k.key} className="min-w-0 rounded-xl border border-border bg-card/60 px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:text-[11px]">
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{k.label}</span>
            </div>
            <div className="mt-1.5 flex min-w-0 items-baseline gap-1">
              <span className="min-w-0 truncate text-lg font-semibold tabular-nums text-foreground sm:text-xl">{k.value}</span>
              {k.unit && <span className="font-mono text-[11px] text-muted-foreground">{k.unit}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
