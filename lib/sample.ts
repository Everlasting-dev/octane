// Synthetic sample capture, shared by the landing page and the dashboard.

import { buildSignals, LOG_DURATION, SAMPLE_COUNT } from "./telemetry"
import { parseFileNameMeta, type ParsedLog } from "./csv"

export const SAMPLE_FILENAME = "JN1AR5EFXFM700052 - 80B6A,80B0BEA - 2026-06-24 16-53-48.csv"

export const SAMPLE_LOG: ParsedLog = {
  fileName: SAMPLE_FILENAME,
  sizeLabel: "103.3 KB",
  samples: SAMPLE_COUNT,
  duration: LOG_DURATION,
  indexed: false,
  signals: buildSignals(),
  meta: parseFileNameMeta(SAMPLE_FILENAME),
}
