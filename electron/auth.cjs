// Supabase email/password auth for the desktop app. Ported from the legacy
// Octane main process. Session is encrypted with Electron safeStorage and kept
// in the user-data dir, with an offline grace window.

const { app, safeStorage } = require("electron")
const fs = require("node:fs/promises")
const path = require("node:path")
const crypto = require("node:crypto")
const os = require("node:os")
const { execFile } = require("node:child_process")

const SUPABASE_URL = process.env.SUPABASE_URL || "https://hgwmdowavadfbctlypin.supabase.co"
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_wRhD8AZtNhOAXSv3k_f7Cg_5rzE11zp"
const AUTH_GRACE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days offline grace
// License: 15 days from the account's FIRST EVER login. The server
// (supabase/licenses.sql) is the source of truth; until that SQL is deployed the
// app falls back to the local rule below. Logout never resets either one.
const LICENSE_MS = 15 * 24 * 60 * 60 * 1000
const LICENSE_RECHECK_MS = 30 * 60 * 1000
const MACHINE_SALT = "octane-license-v1"
const ANCHOR_KEY = "HKLM\\SOFTWARE\\EverlastingDev\\Octane"

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

// --- License anchors (survive logout) ---------------------------------------

function anchorPath() {
  return path.join(app.getPath("userData"), "license-anchor.dat")
}

async function readAnchors() {
  try {
    const data = decodeSession(await fs.readFile(anchorPath()))
    return data && typeof data === "object" ? data : {}
  } catch {
    return {}
  }
}

function anchorOf(anchors, key) {
  const v = anchors[key]
  if (typeof v === "number") return { first: v } // older single-number format
  return v && typeof v === "object" ? v : {}
}

/** Earliest known first-login per email; only ever moves earlier. */
async function rememberFirstLogin(email, firstLoginAt) {
  const key = String(email || "").toLowerCase()
  if (!key || !Number.isFinite(firstLoginAt)) return firstLoginAt
  const anchors = await readAnchors()
  const prev = anchorOf(anchors, key)
  const earliest = Number.isFinite(prev.first) && prev.first > 0 ? Math.min(prev.first, firstLoginAt) : firstLoginAt
  if (earliest !== prev.first) {
    anchors[key] = { ...prev, first: earliest }
    try {
      await fs.writeFile(anchorPath(), encodeSession(anchors))
    } catch {
      /* ignore */
    }
  }
  return earliest
}

/** Cache the server's answer so an offline sign-in can't start a fresh window. */
async function rememberServerLicense(email, license) {
  const key = String(email || "").toLowerCase()
  if (!key) return
  const anchors = await readAnchors()
  anchors[key] = { ...anchorOf(anchors, key), ...license }
  try {
    await fs.writeFile(anchorPath(), encodeSession(anchors))
  } catch {
    /* ignore */
  }
}

async function cachedServerLicense(email) {
  const key = String(email || "").toLowerCase()
  return key ? anchorOf(await readAnchors(), key) : {}
}

function regQuery(key, value) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(null)
    execFile("reg", ["query", key, "/v", value], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
      if (err) return resolve(null)
      const m = String(stdout).match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`, "i"))
      resolve(m ? m[1].trim() : null)
    })
  })
}

let machineCache = null
/** Stable, anonymous PC id + the CLI's locked first-seen time (if set). */
async function machineInfo() {
  if (machineCache) return machineCache
  const guid = (await regQuery("HKLM\\SOFTWARE\\Microsoft\\Cryptography", "MachineGuid")) || os.hostname()
  const machineId = crypto.createHash("sha256").update(`${MACHINE_SALT}:${guid.toLowerCase()}`).digest("hex")
  const firstSeenRaw = await regQuery(ANCHOR_KEY, "FirstSeen")
  const firstSeen = firstSeenRaw ? Date.parse(firstSeenRaw) : NaN
  machineCache = {
    machineId,
    machineName: os.hostname(),
    machineFirstSeen: Number.isFinite(firstSeen) && firstSeen > 0 ? firstSeen : null,
  }
  return machineCache
}

// Legacy owner rule, used ONLY until the license SQL is deployed (the server
// then decides who the owner is by exact email).
function legacyOwner(email) {
  return typeof email === "string" && email.toLowerCase().includes("akramfariz")
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
    user: {
      ...nextUser,
      ...license,
      ...(sameUser(previous, nextUser)
        ? {
            isOwner: previous.user.isOwner,
            licenseSource: previous.user.licenseSource,
            licenseCheckedAt: previous.user.licenseCheckedAt,
            clockOffsetMs: previous.user.clockOffsetMs,
          }
        : {}),
    },
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

async function rpc(accessToken, fn, body = {}) {
  return supabaseAuthRequest(`/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
    // never let a slow network hold up app start; the cached license is used instead
    signal: AbortSignal.timeout(8000),
  })
}

function serverMissing(error) {
  // PostgREST: function not found (SQL not deployed yet).
  return error?.status === 404 || /PGRST202|could not find the function/i.test(String(error?.message || ""))
}

/**
 * Ask the server for this account's license (creating it on the first ever
 * call) and record this PC. Falls back to the local 15-day rule if the server
 * side isn't deployed. Never throws.
 */
async function applyLicense(env) {
  if (!env?.user) return env
  const now = Date.now()
  const machine = await machineInfo()
  const localStart = await rememberFirstLogin(
    env.user.email,
    Math.min(
      Number(env.user.firstLoginAt) || now,
      machine.machineFirstSeen ?? Infinity,
    ),
  )
  try {
    const lic = await rpc(env.accessToken, "octane_license_claim", {
      p_machine_id: machine.machineId,
      p_machine_name: machine.machineName,
      p_local_first_login: new Date(localStart).toISOString(),
      p_app_version: app.getVersion(),
    })
    const firstLoginAt = Date.parse(lic.first_login_at)
    const licenseExpiresAt = Date.parse(lic.expires_at)
    const serverNow = Date.parse(lic.server_time)
    await rememberFirstLogin(env.user.email, firstLoginAt)
    await rememberServerLicense(env.user.email, { serverExpires: licenseExpiresAt, owner: !!lic.is_owner })
    return {
      ...env,
      user: {
        ...env.user,
        firstLoginAt,
        licenseExpiresAt,
        isOwner: !!lic.is_owner,
        licenseSource: "server",
        licenseCheckedAt: now,
        // clock skew guard: how far the PC clock is ahead of the server
        clockOffsetMs: Number.isFinite(serverNow) ? now - serverNow : 0,
      },
    }
  } catch (error) {
    if (serverMissing(error)) {
      return {
        ...env,
        user: {
          ...env.user,
          firstLoginAt: localStart,
          licenseExpiresAt: localStart + LICENSE_MS,
          isOwner: legacyOwner(env.user.email),
          licenseSource: "local",
          licenseCheckedAt: now,
        },
      }
    }
    // Offline / transient: last known server answer, else the anchored local rule.
    const cached = await cachedServerLicense(env.user.email)
    const knownOwner = typeof cached.owner === "boolean" ? cached.owner : env.user.isOwner
    return {
      ...env,
      user: {
        ...env.user,
        firstLoginAt: localStart,
        licenseExpiresAt: Number.isFinite(cached.serverExpires) ? cached.serverExpires : localStart + LICENSE_MS,
        isOwner: knownOwner,
        licenseSource: env.user.licenseSource || (Number.isFinite(cached.serverExpires) ? "server" : "local"),
        // leave licenseCheckedAt alone so the next online check happens soon
      },
    }
  }
}

async function refresh(env) {
  if (!env?.refreshToken) throw new Error("No refresh token saved.")
  const data = await supabaseAuthRequest("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: env.refreshToken }),
  })
  const next = await applyLicense(buildEnvelope(data, "refresh", ensureLicenseWindow(env)))
  await writeSession(next)
  return next
}

async function getState() {
  const raw = await readSession()
  const saved = ensureLicenseWindow(raw)
  if (!saved?.accessToken) return { authenticated: false }
  if (saved !== raw) await writeSession(saved)
  if (Number(saved.expiresAt || 0) > Date.now() + 5 * 60 * 1000) {
    const stale =
      !saved.user?.licenseSource ||
      Date.now() - Number(saved.user?.licenseCheckedAt || 0) > LICENSE_RECHECK_MS ||
      Number(saved.user?.licenseExpiresAt || 0) <= Date.now()
    if (stale) {
      const next = await applyLicense(saved)
      if (next !== saved) await writeSession(next)
      return { authenticated: true, user: next.user }
    }
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
  const env = await applyLicense(buildEnvelope(data, "login", previous))
  await writeSession(env)
  return { authenticated: true, user: env.user }
}

async function logout() {
  // Only the sign-in session is removed. license-anchor.dat (first login per
  // account) and the server record stay, so logging out never resets the 15 days.
  await clearSession()
  return { authenticated: false }
}

async function ownerToken() {
  const state = await getState()
  if (!state?.authenticated || !state.user?.isOwner) throw new Error("Only the Octane owner account can manage licenses.")
  const token = await getAccessToken()
  if (!token) throw new Error("Octane could not refresh your session. Sign in again and retry.")
  return token
}

async function licenseList() {
  const token = await ownerToken()
  try {
    return await rpc(token, "octane_license_list")
  } catch (error) {
    if (serverMissing(error)) throw new Error("The license tables aren't set up in Supabase yet. Run supabase/licenses.sql first.", { cause: error })
    throw error
  }
}

async function licenseRenew(userId) {
  const token = await ownerToken()
  return rpc(token, "octane_license_renew", { p_user: userId })
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

module.exports = { getState, login, logout, getAccessToken, licenseList, licenseRenew }
