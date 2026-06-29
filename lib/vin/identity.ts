// Orchestrates VIN → vehicle identity: validate → decode (online/local) → enrich.
import type { VehicleInfo, VinMode } from "./types"
import { cleanVin, isValidVin, checkDigitOk, modelYearFromVin } from "./validate"
import { decodeNhtsa, readCache } from "./nhtsa"
import { enrich } from "./enrichment"

function base(vin: string): VehicleInfo {
  const ok = checkDigitOk(vin)
  return {
    vin,
    status: "identified",
    checkDigitOk: ok,
    warnings: ok ? [] : ["Check digit doesn't match — common for non-US-market VINs."],
    source: "local",
  }
}

// Local-only inference for known Octane vehicles (no network).
function localInfer(vin: string): Partial<VehicleInfo> {
  const year = modelYearFromVin(vin)
  if (/^JN1AR5/i.test(vin)) {
    return { make: "Nissan", model: "GT-R", modelYear: year, trim: undefined, trimSource: "Octane inferred" }
  }
  return { modelYear: year }
}

export async function identifyVehicle(rawVin: string, mode: VinMode, manual = false): Promise<VehicleInfo> {
  const vin = cleanVin(rawVin)
  if (!isValidVin(vin)) {
    return { vin, status: "invalid", checkDigitOk: false, warnings: ["Not a valid 17-character VIN."], source: manual ? "manual" : "local" }
  }
  if (mode === "off") {
    return { ...base(vin), status: "disabled", source: manual ? "manual" : "local" }
  }

  let info = base(vin)
  if (manual) info.source = "manual"

  // Local inference always runs (free, offline).
  Object.assign(info, localInfer(vin))

  if (mode === "online") {
    const cached = readCache(vin)
    const decoded = cached ?? (await decodeNhtsa(vin))
    if (decoded && (decoded.make || decoded.model || decoded.modelYear)) {
      info = { ...info, ...decoded, source: cached ? "cache" : "nhtsa" }
    } else if (!info.make) {
      // No local match and online failed → report decode-failed.
      info.status = "decode-failed"
      info.warnings = [...info.warnings, "Online decode unavailable — check your connection."]
    }
  }

  // Trim priority: NHTSA Trim → NHTSA Series → local rule → Unknown.
  const trim = info.trim || info.series
  if (trim) {
    info.trim = trim
    info.trimSource = "NHTSA decoded"
  } else {
    info.trimSource = info.trim ? info.trimSource : "Octane inferred"
  }

  return enrich(info, vin)
}
