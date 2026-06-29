"use client"

import { useEffect, useState } from "react"
import { Car, Eye, EyeOff, Loader2, RefreshCw, TriangleAlert } from "lucide-react"
import type { ParsedLog } from "@/lib/csv"
import type { VehicleInfo } from "@/lib/vin/types"
import { extractVin } from "@/lib/vin/extract"
import { identifyVehicle } from "@/lib/vin/identity"
import { getVinMode, maskVin } from "@/lib/vin/settings"

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right text-xs text-foreground">{value}</span>
    </div>
  )
}

function sourceLabel(s: VehicleInfo["source"]): string {
  return s === "nhtsa" ? "NHTSA decoded" : s === "cache" ? "NHTSA (cached)" : s === "manual" ? "Manual" : "Octane inferred"
}

export function VehicleCard({ log }: { log: ParsedLog }) {
  const [info, setInfo] = useState<VehicleInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [reveal, setReveal] = useState(false)
  const [manual, setManual] = useState("")

  async function run(vin: string, isManual: boolean) {
    setLoading(true)
    const res = await identifyVehicle(vin, getVinMode(), isManual)
    setInfo(res)
    setLoading(false)
  }

  useEffect(() => {
    const vin = extractVin(log)
    if (!vin) {
      setInfo({ vin: "", status: "no-vin", checkDigitOk: false, warnings: [], source: "local" })
      setLoading(false)
      return
    }
    run(vin, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log])

  const headline = info ? [info.modelYear, info.make, info.model, info.trim].filter(Boolean).join(" ") : ""
  const engine =
    info?.engineCode || info?.engineDescription
      ? [info.engineCode, info.engineDescription].filter(Boolean).join(", ")
      : [info?.engineModel, info?.displacementL && `${info.displacementL}L`, info?.engineCylinders && `${info.engineCylinders}-cyl`]
          .filter(Boolean)
          .join(" · ") || undefined
  const transmission =
    info?.transmissionCode || info?.transmissionDescription
      ? [info.transmissionCode, info.transmissionDescription].filter(Boolean).join(", ")
      : [info?.transmissionStyle, info?.transmissionSpeeds && `${info.transmissionSpeeds}-speed`].filter(Boolean).join(" · ") || undefined
  const assembly = info?.assemblyPlant || [info?.plantCity, info?.plantCountry].filter(Boolean).join(", ") || undefined

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center gap-2">
        <Car className="size-4 text-muted-foreground" />
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Vehicle</h4>
        {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        {info && info.status !== "no-vin" && info.status !== "invalid" && (
          <span className="ml-auto rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {sourceLabel(info.source)}
          </span>
        )}
      </div>

      {info?.status === "identified" || info?.status === "decode-failed" || info?.status === "disabled" ? (
        <div className="rounded-lg border border-border bg-card/60 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">{headline || "Unknown vehicle"}</p>
            {info.trim && (
              <span className="shrink-0 text-[10px] text-muted-foreground">{info.trimSource}</span>
            )}
          </div>
          <div className="mt-2 divide-y divide-border">
            <Row label="Platform" value={info.platform} />
            <Row label="Engine" value={engine} />
            <Row label="Transmission" value={transmission} />
            <Row label="Drivetrain" value={info.drivetrain} />
            <Row label="Fuel" value={info.fuelType} />
            <Row label="Assembly" value={assembly} />
            <Row label="Serial sequence" value={info.serialSequence} />
            <div className="flex items-center justify-between gap-3 py-1">
              <span className="text-xs text-muted-foreground">VIN</span>
              <span className="flex items-center gap-1.5">
                <span className="font-mono text-xs text-foreground">{maskVin(info.vin, reveal)}</span>
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? "Hide VIN" : "Reveal VIN"}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </span>
            </div>
          </div>
          {info.status === "disabled" && (
            <p className="mt-2 text-[11px] text-muted-foreground">VIN decoding is off — enable it in Settings.</p>
          )}
          {info.warnings.map((w) => (
            <p key={w} className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-500">
              <TriangleAlert className="size-3.5 shrink-0" />
              {w}
            </p>
          ))}
          {info.status === "decode-failed" && (
            <button
              type="button"
              onClick={() => run(info.vin, info.source === "manual")}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <RefreshCw className="size-3" /> Retry online decode
            </button>
          )}
        </div>
      ) : info?.status === "invalid" ? (
        <p className="text-xs text-amber-500">The VIN found isn’t valid (need 17 characters, no I/O/Q).</p>
      ) : !loading ? (
        <p className="text-xs text-muted-foreground">No VIN found in this log. Enter one to decode:</p>
      ) : null}

      {/* Manual entry */}
      {!loading && info?.status !== "identified" && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (manual.trim()) run(manual.trim(), true)
          }}
          className="mt-2 flex items-center gap-1.5"
        >
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value.toUpperCase())}
            placeholder="Enter VIN…"
            maxLength={17}
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-card px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Decode
          </button>
        </form>
      )}
    </div>
  )
}
