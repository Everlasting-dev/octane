export type VinMode = "online" | "local" | "off"

export type VinStatus =
  | "identified" // decoded (online or local)
  | "decode-failed" // valid VIN, online decode failed
  | "no-vin" // none found in the log
  | "invalid" // not 17 valid chars
  | "disabled" // decoding turned off

export interface VehicleInfo {
  vin: string
  status: VinStatus
  checkDigitOk: boolean
  warnings: string[]
  source: "nhtsa" | "local" | "cache" | "manual"
  // decoded / inferred fields (only set when known)
  modelYear?: string
  make?: string
  model?: string
  trim?: string
  trimSource?: "NHTSA decoded" | "Octane inferred"
  series?: string
  bodyClass?: string
  engineManufacturer?: string
  engineModel?: string
  engineCylinders?: string
  displacementL?: string
  fuelType?: string
  transmissionStyle?: string
  transmissionSpeeds?: string
  plantCity?: string
  plantCountry?: string
  // Octane enrichment
  platform?: string
  engineCode?: string
  engineDescription?: string
  transmissionCode?: string
  transmissionDescription?: string
  drivetrain?: string
  assemblyPlant?: string
  serialSequence?: string
}
