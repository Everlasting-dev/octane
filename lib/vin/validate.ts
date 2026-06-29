// VIN format + check-digit validation. VINs exclude I, O, Q.

export const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/
export const VIN_SCAN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/

export function cleanVin(raw: string): string {
  return String(raw || "")
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
}

export function isValidVin(vin: string): boolean {
  return VIN_RE.test(vin)
}

const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
}
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

/** North-American check-digit (9th char). International VINs may legitimately fail. */
export function checkDigitOk(vin: string): boolean {
  if (!isValidVin(vin)) return false
  let sum = 0
  for (let i = 0; i < 17; i++) {
    const v = TRANSLIT[vin[i]]
    if (v == null) return false
    sum += v * WEIGHTS[i]
  }
  const rem = sum % 11
  const expected = rem === 10 ? "X" : String(rem)
  return vin[8] === expected
}

// VIN model-year codes (position 10).
const YEAR_CODES: Record<string, number> = {
  A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015, G: 2016, H: 2017,
  J: 2018, K: 2019, L: 2020, M: 2021, N: 2022, P: 2023, R: 2024, S: 2025, T: 2026,
  V: 2027, W: 2028, X: 2029, Y: 2030,
  "1": 2001, "2": 2002, "3": 2003, "4": 2004, "5": 2005, "6": 2006, "7": 2007, "8": 2008, "9": 2009,
}

export function modelYearFromVin(vin: string): string | undefined {
  const y = YEAR_CODES[vin[9]]
  return y ? String(y) : undefined
}
