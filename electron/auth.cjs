// Supabase email/password auth for the desktop app. Ported from the legacy
// Octane main process. Session is encrypted with Electron safeStorage and kept
// in the user-data dir, with an offline grace window.

const { app, safeStorage } = require("electron")
const fs = require("node:fs/promises")
const path = require("node:path")

const SUPABASE_URL = process.env.SUPABASE_URL || "https://hgwmdowavadfbctlypin.supabase.co"
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_wRhD8AZtNhOAXSv3k_f7Cg_5rzE11zp"
const AUTH_GRACE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days offline grace
const LICENSE_MS = 30 * 24 * 60 * 60 * 1000

function sessionPath() {
  return path.join(app.getPath("userData"), "auth-session.dat")
}

function encodeSession(session) {
  const raw = JSON.stringify(session)
  if (safeStorage.isEncryptionAvailable()) {
    return Buffer.concat([Buffer.from("safe:"), safeStorage.encryptString(raw)])
  }
  return Buffer.from(`plain:${Buffer.from(raw, "utf8").toString("base64")}`, "utf8")
}

function decodeSession(buffer) {
  const prefix = buffer.subarray(0, 5).toString("utf8")
  if (prefix === "safe:") return JSON.parse(safeStorage.decryptString(buffer.subarray(5)))
  const raw = buffer.toString("utf8")
  if (raw.startsWith("plain:")) return JSON.parse(Buffer.from(raw.slice(6), "base64").toString("utf8"))
  return JSON.parse(raw)
}

async function readSession() {
  try {
    return decodeSession(await fs.readFile(sessionPath()))
  } catch {
    return null
  }
}
async function writeSession(session) {
  await fs.writeFile(sessionPath(), encodeSession(session))
}
async function clearSession() {
  try {
    await fs.unlink(sessionPath())
  } catch {
    /* ignore */
  }
}

async function supabaseAuthRequest(pathname, options = {}) {
  let response
  try {
    response = await fetch(`${SUPABASE_URL}${pathname}`, {
      ...options,
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json", ...(options.headers || {}) },
    })
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot reach Supabase at ${SUPABASE_URL}. Check your connection. Details: ${details}`, { cause: error })
  }
  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { message: text }
    }
  }
  if (!response.ok) {
    const message = data?.error_description || data?.msg || data?.message || `Supabase request failed (${response.status})`
    const error = new Error(message)
    error.status = response.status
    throw error
  }
  return data
}

function sameUser(previous, nextUser) {
  if (!previous?.user || !nextUser) return false
  const prevEmail = String(previous.user.email || "").toLowerCase()
  const nextEmail = String(nextUser.email || "").toLowerCase()
  return (!!previous.user.id && previous.user.id === nextUser.id) || (!!prevEmail && prevEmail === nextEmail)
}

function addLicenseWindow(user, previous, now) {
  const keepExisting = sameUser(previous, user)
  const firstLoginAt =
    keepExisting && typeof previous.user.firstLoginAt === "number"
      ? previous.user.firstLoginAt
      : now
  const licenseExpiresAt =
    keepExisting && typeof previous.user.licenseExpiresAt === "number"
      ? previous.user.licenseExpiresAt
      : firstLoginAt + LICENSE_MS
  return { firstLoginAt, licenseExpiresAt }
}

function buildEnvelope(session, source = "login", previous = null) {
  const now = Date.now()
  const user = session.user || {}
  const nextUser = { id: user.id || "", email: user.email || "", role: user.role || "" }
  const license = addLicenseWindow(nextUser, previous, now)
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ? session.expires_at * 1000 : now + Number(session.expires_in || 3600) * 1000,
    lastValidatedAt: now,
    source,
    user: { ...nextUser, ...license },
  }
}

function ensureLicenseWindow(env) {
  if (!env?.user) return env
  if (typeof env.user.firstLoginAt === "number" && typeof env.user.licenseExpiresAt === "number") return env
  const firstLoginAt = Number(env.lastValidatedAt || Date.now())
  return {
    ...env,
    user: {
      ...env.user,
      firstLoginAt,
      licenseExpiresAt: firstLoginAt + LICENSE_MS,
    },
  }
}

function withinGrace(env) {
  return !!env?.lastValidatedAt && Date.now() - env.lastValidatedAt <= AUTH_GRACE_MS
}

async function refresh(env) {
  if (!env?.refreshToken) throw new Error("No refresh token saved.")
  const data = await supabaseAuthRequest("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: env.refreshToken }),
  })
  const next = buildEnvelope(data, "refresh", ensureLicenseWindow(env))
  await writeSession(next)
  return next
}

async function getState() {
  const raw = await readSession()
  const saved = ensureLicenseWindow(raw)
  if (!saved?.accessToken) return { authenticated: false }
  if (saved !== raw) await writeSession(saved)
  if (Number(saved.expiresAt || 0) > Date.now() + 5 * 60 * 1000) {
    return { authenticated: true, user: saved.user }
  }
  // Near/after expiry: try to refresh, else fall back to offline grace.
  try {
    const next = await refresh(saved)
    return { authenticated: true, user: next.user }
  } catch (error) {
    if (withinGrace(saved)) {
      return { authenticated: true, user: saved.user, warning: "Using saved offline access — sign in again soon." }
    }
    return { authenticated: false, message: error.message }
  }
}

async function login({ email, password }) {
  if (!email || !password) throw new Error("Email and password are required.")
  const previous = ensureLicenseWindow(await readSession())
  const data = await supabaseAuthRequest("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
  const env = buildEnvelope(data, "login", previous)
  await writeSession(env)
  return { authenticated: true, user: env.user }
}

async function logout() {
  await clearSession()
  return { authenticated: false }
}

async function getAccessToken() {
  const raw = await readSession()
  const saved = ensureLicenseWindow(raw)
  if (!saved?.accessToken) return null
  if (saved !== raw) await writeSession(saved)
  if (Number(saved.expiresAt || 0) <= Date.now() + 60 * 1000) {
    try {
      return (await refresh(saved)).accessToken
    } catch {
      return withinGrace(saved) ? saved.accessToken : null
    }
  }
  return saved.accessToken
}

module.exports = { getState, login, logout, getAccessToken }
