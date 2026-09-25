"use client"

export interface LicenseStatus {
  email: string | null
  plan: "admin" | "subscription" | "guest"
  status: "lifetime" | "active" | "expired" | "unknown"
  label: string
  remainingLabel: string
  issuedAt: number | null
  expiresAt: number | null
}

const PREFIX = "octane:license:"
const SUBSCRIPTION_MS = 30 * 24 * 60 * 60 * 1000

function storageKey(email: string) {
  return `${PREFIX}${email.toLowerCase()}`
}

function isAdminEmail(email: string | null | undefined) {
  return !!email && email.toLowerCase().includes("akramfariz")
}

function remainingLabel(expiresAt: number, now: number) {
  const ms = expiresAt - now
  if (ms <= 0) return "Expired"
  const days = Math.floor(ms / (24 * 60 * 60 * 1000))
  if (days >= 2) return `${days} days left`
  if (days === 1) return "1 day left"
  const hours = Math.max(1, Math.ceil(ms / (60 * 60 * 1000)))
  return `${hours} hours left`
}

export function getLicenseStatus(
  email: string | null | undefined,
  now = Date.now(),
  license?: { firstLoginAt?: number | null; expiresAt?: number | null },
): LicenseStatus {
  const normalized = email?.trim() || null
  if (!normalized) {
    return {
      email: null,
      plan: "guest",
      status: "unknown",
      label: "License not checked",
      remainingLabel: "Sign in required",
      issuedAt: null,
      expiresAt: null,
    }
  }

  if (isAdminEmail(normalized)) {
    return {
      email: normalized,
      plan: "admin",
      status: "lifetime",
      label: "Admin license",
      remainingLabel: "Lifetime",
      issuedAt: null,
      expiresAt: null,
    }
  }

  let issuedAt = typeof license?.firstLoginAt === "number" ? license.firstLoginAt : now
  let expiresAt =
    typeof license?.expiresAt === "number"
      ? license.expiresAt
      : issuedAt + SUBSCRIPTION_MS

  if (typeof window !== "undefined") {
    try {
      const key = storageKey(normalized)
      const stored = typeof license?.expiresAt === "number" ? null : window.localStorage.getItem(key)
      if (stored) {
        const parsed = JSON.parse(stored) as { issuedAt?: unknown; expiresAt?: unknown }
        if (typeof parsed.issuedAt === "number") issuedAt = parsed.issuedAt
        if (typeof parsed.expiresAt === "number") expiresAt = parsed.expiresAt
      } else if (typeof license?.expiresAt !== "number") {
        window.localStorage.setItem(key, JSON.stringify({ issuedAt, expiresAt }))
      }
    } catch {
      /* local preview fallback */
    }
  }

  const active = expiresAt > now
  return {
    email: normalized,
    plan: "subscription",
    status: active ? "active" : "expired",
    label: active ? "Subscription active" : "Subscription expired",
    remainingLabel: remainingLabel(expiresAt, now),
    issuedAt,
    expiresAt,
  }
}
