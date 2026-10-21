// Thin wrapper over the Electron auth bridge (window.octane.auth). In a plain
// browser (the GitHub Pages mobile build, npm run dev) the same Supabase
// email/password sign-in runs from the page, so the web app is gated too.

export interface AuthUser {
  id: string
  email: string
  role?: string
  firstLoginAt?: number
  licenseExpiresAt?: number
  /** decided by the server (exact owner email); undefined until the license SQL is deployed */
  isOwner?: boolean
  licenseSource?: "server" | "local"
  licenseCheckedAt?: number
}

export interface LicenseMachine {
  machine_id: string
  machine_name: string | null
  app_version: string | null
  first_seen: string
  last_seen: string
}

export interface LicenseAccount {
  user_id: string
  email: string
  first_login_at: string
  expires_at: string
  renewed_at: string | null
  renew_count: number
  machines: LicenseMachine[]
}

export interface AuthState {
  authenticated: boolean
  user?: AuthUser
  error?: string
  message?: string
  warning?: string
}

interface ApexAuth {
  getState: () => Promise<AuthState>
  login: (c: { email: string; password: string }) => Promise<AuthState>
  logout: () => Promise<unknown>
  getAccessToken: () => Promise<string | null>
}

interface LicensesBridge {
  list: () => Promise<{ ok: true; accounts: LicenseAccount[] } | { ok: false; error: string }>
  renew: (userId: string) => Promise<{ ok: true; result: unknown } | { ok: false; error: string }>
}

function licensesBridge(): LicensesBridge | null {
  if (typeof window === "undefined") return null
  return (window as unknown as { octane?: { licenses?: LicensesBridge } }).octane?.licenses ?? null
}

export async function listLicenses(): Promise<{ ok: true; accounts: LicenseAccount[] } | { ok: false; error: string }> {
  const b = licensesBridge()
  if (!b) return { ok: false, error: "Licenses are managed from the Octane desktop app." }
  return b.list()
}

export async function renewLicense(userId: string): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const b = licensesBridge()
  if (!b) return { ok: false, error: "Licenses are managed from the Octane desktop app." }
  return b.renew(userId)
}

/** Owner = server's answer; before the license SQL is deployed, the old rule. */
export function isOwnerUser(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  if (typeof user.isOwner === "boolean") return user.isOwner
  return !!user.email && user.email.toLowerCase().includes("akramfariz")
}

/** True when a signed-in, non-owner account's license has run out. */
export function isLicenseExpired(user: AuthUser | null | undefined, now = Date.now()): boolean {
  if (!user || isOwnerUser(user)) return false
  return typeof user.licenseExpiresAt === "number" && user.licenseExpiresAt <= now
}

// --- Browser (web/mobile) auth ----------------------------------------------
// Same Supabase project and publishable key as electron/auth.cjs. The session
// lives in localStorage, so the iPhone home-screen app stays signed in.

const SUPABASE_URL = "https://hgwmdowavadfbctlypin.supabase.co"
const SUPABASE_ANON_KEY = "sb_publishable_wRhD8AZtNhOAXSv3k_f7Cg_5rzE11zp"
const WEB_SESSION_KEY = "octane-web-auth-v1"
const WEB_GRACE_MS = 7 * 24 * 60 * 60 * 1000 // offline grace, matches desktop

interface WebSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
  lastValidatedAt: number
  user: AuthUser
}

interface SupabaseSession {
  access_token: string
  refresh_token: string
  expires_at?: number
  expires_in?: number
  user?: { id?: string; email?: string; role?: string }
}

function readWebSession(): WebSession | null {
  try {
    const raw = window.localStorage.getItem(WEB_SESSION_KEY)
    const s = raw ? (JSON.parse(raw) as WebSession) : null
    return s?.accessToken && s.refreshToken && s.user?.email ? s : null
  } catch {
    return null
  }
}

function writeWebSession(s: WebSession) {
  try {
    window.localStorage.setItem(WEB_SESSION_KEY, JSON.stringify(s))
  } catch {
    /* storage blocked: the session just won't survive a reload */
  }
}

function clearWebSession() {
  try {
    window.localStorage.removeItem(WEB_SESSION_KEY)
  } catch {
    /* ignore */
  }
}

async function supabaseRequest<T>(pathname: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init
  let response: Response
  try {
    response = await fetch(`${SUPABASE_URL}${pathname}`, {
      ...rest,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers as Record<string, string> | undefined),
      },
    })
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    throw Object.assign(new Error(`Cannot reach Supabase. Check your connection. Details: ${details}`), { network: true })
  }
  const text = await response.text()
  let data: Record<string, unknown> | null = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { message: text }
    }
  }
  if (!response.ok) {
    const message =
      (data?.error_description as string) || (data?.msg as string) || (data?.message as string) || `Supabase request failed (${response.status})`
    throw Object.assign(new Error(message), { status: response.status })
  }
  return data as T
}

/** Server decides the owner (supabase/licenses.sql); old email rule if that isn't deployed. */
async function fetchIsOwner(accessToken: string, email: string): Promise<boolean> {
  try {
    return (await supabaseRequest<boolean>("/rest/v1/rpc/octane_owner", { method: "POST", token: accessToken, body: "{}" })) === true
  } catch {
    return email.toLowerCase().includes("akramfariz")
  }
}

async function toWebSession(data: SupabaseSession, previous: WebSession | null): Promise<WebSession> {
  const now = Date.now()
  const id = data.user?.id || previous?.user.id || ""
  const email = data.user?.email || previous?.user.email || ""
  const knownOwner = previous && previous.user.id === id ? previous.user.isOwner : undefined
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at ? data.expires_at * 1000 : now + Number(data.expires_in || 3600) * 1000,
    lastValidatedAt: now,
    user: {
      id,
      email,
      role: data.user?.role || "",
      // No license window on the web build: it only admits existing accounts.
      isOwner: typeof knownOwner === "boolean" ? knownOwner : await fetchIsOwner(data.access_token, email),
    },
  }
}

let refreshing: Promise<WebSession> | null = null

/** Refresh tokens are single-use, so concurrent callers share one refresh. */
function refreshWebSession(saved: WebSession): Promise<WebSession> {
  refreshing ??= supabaseRequest<SupabaseSession>("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: saved.refreshToken }),
  })
    .then((data) => toWebSession(data, saved))
    .then((next) => {
      writeWebSession(next)
      return next
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

function isNetworkError(error: unknown): boolean {
  return !!(error as { network?: boolean } | null)?.network
}

const webAuth: ApexAuth = {
  async getState() {
    const saved = readWebSession()
    if (!saved) return { authenticated: false }
    if (saved.expiresAt > Date.now() + 5 * 60 * 1000) return { authenticated: true, user: saved.user }
    try {
      const next = await refreshWebSession(saved)
      return { authenticated: true, user: next.user }
    } catch (error) {
      // Offline: keep working for a while. Rejected by the server (revoked,
      // user deleted, password changed): back to the login screen.
      if (isNetworkError(error) && Date.now() - saved.lastValidatedAt <= WEB_GRACE_MS) {
        return { authenticated: true, user: saved.user, warning: "Using saved offline access — sign in again soon." }
      }
      clearWebSession()
      return { authenticated: false, message: error instanceof Error ? error.message : String(error) }
    }
  },

  async login({ email, password }) {
    if (!email || !password) throw new Error("Email and password are required.")
    const data = await supabaseRequest<SupabaseSession>("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    })
    const next = await toWebSession(data, readWebSession())
    writeWebSession(next)
    return { authenticated: true, user: next.user }
  },

  async logout() {
    const saved = readWebSession()
    clearWebSession()
    // Best effort: revoke the refresh token server-side too.
    if (saved) await supabaseRequest("/auth/v1/logout", { method: "POST", token: saved.accessToken }).catch(() => undefined)
    return { authenticated: false }
  },

  async getAccessToken() {
    const saved = readWebSession()
    if (!saved) return null
    if (saved.expiresAt > Date.now() + 60 * 1000) return saved.accessToken
    try {
      return (await refreshWebSession(saved)).accessToken
    } catch {
      return null
    }
  },
}

function desktopBridge(): ApexAuth | null {
  if (typeof window === "undefined") return null
  return (window as unknown as { octane?: { auth?: ApexAuth } }).octane?.auth ?? null
}

function bridge(): ApexAuth | null {
  if (typeof window === "undefined") return null
  return desktopBridge() ?? webAuth
}

/** True when running inside the desktop app (Electron auth bridge). */
export function isDesktopAuth(): boolean {
  return !!desktopBridge()
}

export async function getAuthState(): Promise<AuthState> {
  const b = bridge()
  if (!b) return { authenticated: false } // no window (prerender): never assume signed in
  try {
    return await b.getState()
  } catch (e) {
    return { authenticated: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function login(email: string, password: string): Promise<AuthState> {
  const b = bridge()
  if (!b) return { authenticated: false, error: "Sign in is not available here." }
  return b.login({ email, password })
}

export async function logout(): Promise<void> {
  const b = bridge()
  if (b) await b.logout()
}

/** Supabase project used by Octane (public URL + publishable key). */
export const SUPABASE = { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }

/** A current access token for the signed-in account (refreshed when needed), or null. */
export async function getAccessToken(): Promise<string | null> {
  const b = bridge()
  if (!b) return null
  try {
    return await b.getAccessToken()
  } catch {
    return null
  }
}
