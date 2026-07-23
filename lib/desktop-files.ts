export interface DesktopOpenLogPayload {
  id: string
  fileName: string
  path: string
  size?: number
  text?: string
  error?: string
}

type Unsubscribe = () => void

interface DesktopFilesBridge {
  getPendingOpen?: () => Promise<DesktopOpenLogPayload | null>
  ackOpen?: (id: string) => Promise<unknown>
  onOpenLog?: (callback: (payload: DesktopOpenLogPayload) => void) => Unsubscribe
}

function filesBridge(): DesktopFilesBridge | null {
  if (typeof window === "undefined") return null
  return (window as unknown as { octane?: { files?: DesktopFilesBridge } }).octane?.files ?? null
}

export async function getPendingDesktopOpen(): Promise<DesktopOpenLogPayload | null> {
  return (await filesBridge()?.getPendingOpen?.()) ?? null
}

export async function acknowledgeDesktopOpen(id: string): Promise<void> {
  await filesBridge()?.ackOpen?.(id)
}

export function subscribeToDesktopOpen(callback: (payload: DesktopOpenLogPayload) => void): Unsubscribe {
  return filesBridge()?.onOpenLog?.(callback) ?? (() => {})
}
