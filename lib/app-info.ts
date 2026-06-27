// App version + update-check, via the Octane desktop bridge (window.octane).

function appBridge() {
  if (typeof window === "undefined") return null
  return (
    window as unknown as {
      octane?: { app?: { getVersion: () => Promise<string> }; updates?: { check: () => Promise<unknown> } }
    }
  ).octane
}

export function isDesktop(): boolean {
  return !!appBridge()
}

export async function getAppVersion(): Promise<string> {
  const b = appBridge()
  if (b?.app?.getVersion) {
    try {
      return await b.app.getVersion()
    } catch {
      /* ignore */
    }
  }
  return "dev"
}

export async function checkForUpdates(): Promise<void> {
  const b = appBridge()
  if (b?.updates?.check) {
    try {
      await b.updates.check()
    } catch {
      /* ignore */
    }
  }
}

export const GITHUB_URL = "https://github.com/Everlasting-dev/octane"
