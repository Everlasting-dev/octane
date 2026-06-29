// Find a VIN in a parsed log: filename metadata, comment fields, or raw text.
import type { ParsedLog } from "@/lib/csv"
import { cleanVin, isValidVin, VIN_SCAN_RE } from "./validate"

const VIN_LABEL_RE = /\b(vin|vehicle\s*identification|vehicle\s*vin)\b/i

export function extractVin(log: ParsedLog): string | null {
  // 1. VIN parsed from the filename.
  if (log.meta.vin) {
    const v = cleanVin(log.meta.vin)
    if (isValidVin(v)) return v
  }
  // 2. A comment field labelled like a VIN, or any field value that is a VIN.
  for (const f of log.meta.fields) {
    if (VIN_LABEL_RE.test(f.key)) {
      const v = cleanVin(f.value)
      if (isValidVin(v)) return v
    }
  }
  for (const f of log.meta.fields) {
    const m = f.value.match(VIN_SCAN_RE)
    if (m && isValidVin(m[0])) return m[0]
  }
  // 3. Fall back to scanning the filename text itself.
  const m = cleanVin(log.fileName).match(VIN_SCAN_RE)
  return m && isValidVin(m[0]) ? m[0] : null
}
