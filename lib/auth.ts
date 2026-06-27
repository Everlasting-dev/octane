// Thin wrapper over the Electron auth bridge (window.octane.auth).
// In a plain browser (npm run dev) there is no bridge, so auth is bypassed.

export interface AuthUser {
  id: string
  email: string
  role?: string
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
