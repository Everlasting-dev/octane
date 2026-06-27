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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {kpis.map((k) => {
        const Icon = ICONS[k.icon]
        return (
          <div key={k.key} className="rounded-xl border border-border bg-card/60 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <Icon className="size-3.5" />
              {k.label}
            </div>
            <div className="mt-1.5 flex items-baseline gap-1">
              <span className="text-xl font-semibold tabular-nums text-foreground">{k.value}</span>
              {k.unit && <span className="font-mono text-[11px] text-muted-foreground">{k.unit}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
