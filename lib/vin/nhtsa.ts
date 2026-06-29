// NHTSA vPIC decoder + per-VIN cache.
import type { VehicleInfo } from "./types"

const CACHE_PREFIX = "octane:vin:"

interface CacheEntry {
  fields: Partial<VehicleInfo>
  ts: number
}

function usable(v: unknown): v is string {
  const s = String(v ?? "").trim()
  return s !== "" && s !== "0" && !/not applicable/i.test(s) && !/^\s*$/.test(s)
}

export function readCache(vin: string): Partial<VehicleInfo> | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + vin)
    if (!raw) return null
    return (JSON.parse(raw) as CacheEntry).fields
  } catch {
    return null
  }
}

function writeCache(vin: string, fields: Partial<VehicleInfo>) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(CACHE_PREFIX + vin, JSON.stringify({ fields, ts: Date.now() } satisfies CacheEntry))
  } catch {
    /* ignore */
  }
}

/** Decode online via NHTSA vPIC. Returns the useful fields, or null on failure. */
export async function decodeNhtsa(vin: string): Promise<Partial<VehicleInfo> | null> {
  const cached = readCache(vin)
  if (cached) return cached

  let r: Record<string, unknown>
  try {
    const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`)
    if (!res.ok) return null
    const data = await res.json()
    r = data?.Results?.[0]
    if (!r) return null
  } catch {
    return null
  }

  const pick = (k: string): string | undefined => (usable(r[k]) ? String(r[k]).trim() : undefined)
  const fields: Partial<VehicleInfo> = {
    modelYear: pick("ModelYear"),
    make: pick("Make"),
    model: pick("Model"),
    trim: pick("Trim"),
    series: pick("Series"),
    bodyClass: pick("BodyClass"),
    engineManufacturer: pick("EngineManufacturer"),
    engineModel: pick("EngineModel"),
    engineCylinders: pick("EngineCylinders"),
    displacementL: pick("DisplacementL"),
    fuelType: pick("FuelTypePrimary"),
    transmissionStyle: pick("TransmissionStyle"),
    transmissionSpeeds: pick("TransmissionSpeeds"),
    plantCity: pick("PlantCity"),
    plantCountry: pick("PlantCountry"),
  }
  writeCache(vin, fields)
  return fields
}
