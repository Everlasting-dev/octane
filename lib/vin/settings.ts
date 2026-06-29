import type { VinMode } from "./types"

const KEY = "octane:vin-mode"

export function getVinMode(): VinMode {
  if (typeof window === "undefined") return "online"
  const v = window.localStorage.getItem(KEY)
  return v === "local" || v === "off" ? v : "online"
}

export function setVinMode(mode: VinMode) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(KEY, mode)
  } catch {
    /* ignore */
  }
}

/** Mask all but the first 13 chars unless revealed. */
export function maskVin(vin: string, reveal: boolean): string {
  if (reveal) return vin
  return vin.slice(0, 13) + "•".repeat(Math.max(0, vin.length - 13))
}
