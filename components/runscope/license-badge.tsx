"use client"

import { useEffect, useState } from "react"
import { ShieldCheck } from "lucide-react"
import { getLicenseStatus, type LicenseStatus } from "@/lib/license"
import { cn } from "@/lib/utils"

export function LicenseBadge({
  email,
  firstLoginAt,
  expiresAt,
  compact = false,
}: {
  email?: string | null
  firstLoginAt?: number | null
  expiresAt?: number | null
  compact?: boolean
}) {
  const [now, setNow] = useState(Date.now)
  const [license, setLicense] = useState<LicenseStatus>(() => getLicenseStatus(email, now, { firstLoginAt, expiresAt }))

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setLicense(getLicenseStatus(email, now, { firstLoginAt, expiresAt }))
  }, [email, expiresAt, firstLoginAt, now])

  const tone =
    license.status === "lifetime"
      ? "border-primary/40 bg-primary/10 text-primary"
      : license.status === "active"
        ? "border-accent/40 bg-accent/10 text-accent"
        : "border-destructive/40 bg-destructive/10 text-destructive"
  const expires = license.expiresAt ? new Date(license.expiresAt).toLocaleString() : "Never"
  const compactLabel =
    license.status === "lifetime"
      ? "Admin - Lifetime"
      : license.status === "active"
        ? `Active - ${license.remainingLabel}`
        : license.status === "expired"
          ? "Expired"
          : license.remainingLabel

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
        tone,
      )}
      title={`${license.label}. Expiration: ${expires}`}
    >
      <ShieldCheck className="size-3.5" />
      <span>{compact ? compactLabel : `${license.label} - ${license.remainingLabel}`}</span>
    </span>
  )
}
