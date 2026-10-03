// Thin wrapper over the Electron auth bridge (window.octane.auth).
// In a plain browser (npm run dev) there is no bridge, so auth is bypassed.

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

function bridge(): ApexAuth | null {
  if (typeof window === "undefined") return null
  return (window as unknown as { octane?: { auth?: ApexAuth } }).octane?.auth ?? null
}

/** True when running inside the desktop app (auth enforced). */
export function isDesktopAuth(): boolean {
  return !!bridge()
}

export async function getAuthState(): Promise<AuthState> {
  const b = bridge()
  if (!b) return { authenticated: true } // browser dev: no gate
  try {
    return await b.getState()
  } catch (e) {
    return { authenticated: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function login(email: string, password: string): Promise<AuthState> {
  const b = bridge()
  if (!b) return { authenticated: true }
  return b.login({ email, password })
}

export async function logout(): Promise<void> {
  const b = bridge()
  if (b) await b.logout()
}
