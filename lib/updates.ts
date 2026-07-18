"use client"

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "not-available"
  | "error"

export interface UpdateStatus {
  phase: UpdatePhase
  version?: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  message?: string
}

type Unsubscribe = () => void

function updateBridge() {
  if (typeof window === "undefined") return null
  return (
    window as unknown as {
      octane?: {
        updates?: {
          check?: () => Promise<unknown>
          install?: () => Promise<unknown>
          onStatus?: (callback: (status: UpdateStatus) => void) => Unsubscribe
        }
      }
    }
  ).octane?.updates
}

export function subscribeToUpdates(callback: (status: UpdateStatus) => void): Unsubscribe {
  return updateBridge()?.onStatus?.(callback) ?? (() => {})
}

export async function checkForUpdates(): Promise<void> {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("octane:update-ui-open"))
  }
  await updateBridge()?.check?.()
}

export async function installUpdate(): Promise<void> {
  await updateBridge()?.install?.()
}
