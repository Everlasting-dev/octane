// Octane's local vehicle database. The generic NHTSA API won't return terms
// like "R35", "VR38DETT" or "GR6", so we merge them in for known cars.
import type { VehicleInfo } from "./types"

interface Enrichment {
  platform: string
  engineCode: string
  engineDescription: string
  transmissionCode: string
  transmissionDescription: string
  drivetrain: string
  assemblyPlant: string
}

export const VEHICLE_ENRICHMENT: Record<string, Enrichment> = {
  NISSAN_GT_R_R35: {
    platform: "R35",
    engineCode: "VR38DETT",
    engineDescription: "3.8L twin-turbocharged V6",
    transmissionCode: "GR6",
    transmissionDescription: "6-speed dual-clutch transaxle",
    drivetrain: "ATTESA E-TS all-wheel drive",
    assemblyPlant: "Tochigi, Japan",
  },
}

function isGtr(info: VehicleInfo, vin: string): boolean {
  if (/nissan/i.test(info.make ?? "") && /gt-?r/i.test(info.model ?? "")) return true
  // Local fallback: Nissan GT-R R35 VINs begin JN1AR5.
  return /^JN1AR5/i.test(vin)
}

/** Merge Octane DB facts into a decoded result for known vehicles. */
export function enrich(info: VehicleInfo, vin: string): VehicleInfo {
  const out = { ...info }
  out.serialSequence = vin.slice(11) // last 6 chars = production sequence

  if (isGtr(info, vin)) {
    const e = VEHICLE_ENRICHMENT.NISSAN_GT_R_R35
    out.make = out.make || "Nissan"
    out.model = out.model || "GT-R"
    out.platform = e.platform
    out.engineCode = e.engineCode
    out.engineDescription = e.engineDescription
    out.transmissionCode = e.transmissionCode
    out.transmissionDescription = e.transmissionDescription
    out.drivetrain = e.drivetrain
    out.assemblyPlant = out.assemblyPlant || (out.plantCity ? `${out.plantCity}, ${out.plantCountry ?? ""}`.replace(/, $/, "") : e.assemblyPlant)
  }
  return out
}
