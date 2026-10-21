// Run the Self check rules over CSV logs from the command line, for tuning
// thresholds against real data.
//
//   node scripts/self-check-report.mjs <log.csv | folder> [...more] [--all] [--json]
//
// --all lists every finding (default: up to 5 per rule), --json prints the raw report.

import { createJiti } from "jiti"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"

const jiti = createJiti(import.meta.url)
const { parseLog } = await jiti.import("../lib/csv.ts")
const { runSelfCheck, RULE_BY_ID } = await jiti.import("../lib/self-check.ts")

const args = process.argv.slice(2)
const all = args.includes("--all")
const json = args.includes("--json")
const inputs = args.filter((a) => !a.startsWith("--"))
if (!inputs.length) {
  console.error("usage: node scripts/self-check-report.mjs <log.csv | folder> [...] [--all] [--json]")
  process.exit(1)
}

const files = inputs.flatMap((p) =>
  statSync(p).isDirectory()
    ? readdirSync(p)
        .filter((f) => /\.(csv|txt)$/i.test(f))
        .map((f) => join(p, f))
    : [p],
)

const totals = {}
for (const file of files) {
  const buf = readFileSync(file)
  let log
  try {
    log = parseLog(buf.toString("utf8"), basename(file), buf.length)
  } catch (err) {
    console.log(`\n## ${basename(file)}: not a log (${err.message})`)
    continue
  }
  const report = runSelfCheck(log)
  if (json) {
    console.log(JSON.stringify({ file: basename(file), ...report }, null, 1))
    continue
  }
  const { critical, warn, info } = report.counts
  console.log(`\n## ${basename(file)}  (${log.samples} samples, ${report.sampleRate.toFixed(1)} Hz, ${report.shifts} shifts)  critical ${critical} · warn ${warn} · info ${info}`)
  for (const r of report.results) {
    if (!r.findings.length) continue
    const rule = RULE_BY_ID[r.ruleId]
    totals[r.ruleId] = (totals[r.ruleId] ?? 0) + r.findings.length
    console.log(`  [${rule.system}] ${rule.title}: ${r.findings.length}`)
    for (const f of all ? r.findings : r.findings.slice(0, 5)) {
      console.log(`     ${f.severity.padEnd(8)} ${f.start.toFixed(2).padStart(7)}s  ${f.title} — ${f.detail}`)
    }
    if (!all && r.findings.length > 5) console.log(`     … ${r.findings.length - 5} more`)
  }
}
if (!json && files.length > 1) {
  console.log("\n## Findings per rule across all logs")
  for (const [id, n] of Object.entries(totals).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${id}`)
}
