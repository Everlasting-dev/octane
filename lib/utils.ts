import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Give keyboard focus back to the page (e.g. after clicking a graph), so arrow
 * keys and shortcuts work instead of being eaten by a dropdown or text box.
 */
export function releaseFocus() {
  if (typeof document === "undefined") return
  const el = document.activeElement as HTMLElement | null
  if (el && el !== document.body && typeof el.blur === "function") el.blur()
}
