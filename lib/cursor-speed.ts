"use client"

import { useEffect, useState } from "react"

// How fast the value cursor glides while an arrow key is held, as the number of
// seconds it takes to cross the visible time window. A tap always moves exactly
// one sample, whatever this is set to.
export const CURSOR_SPEEDS: { id: string; label: string; secondsPerScreen: number }[] = [
  { id: "crawl", label: "Crawl", secondsPerScreen: 40 },
  { id: "slow", label: "Slow", secondsPerScreen: 20 },
  { id: "medium", label: "Medium", secondsPerScreen: 10 },
  { id: "fast", label: "Fast", secondsPerScreen: 5 },
]
export const DEFAULT_CURSOR_SPEED = "slow"

const KEY = "octane:cursor-speed"
const EVT = "octane:cursor-speed-changed"

export function loadCursorSpeed(): string {
  if (typeof window === "undefined") return DEFAULT_CURSOR_SPEED
  try {
    const v = window.localStorage.getItem(KEY)
    return CURSOR_SPEEDS.some((s) => s.id === v) ? (v as string) : DEFAULT_CURSOR_SPEED
  } catch {
    return DEFAULT_CURSOR_SPEED
  }
}

export function saveCursorSpeed(id: string) {
  try {
    window.localStorage.setItem(KEY, id)
    window.dispatchEvent(new Event(EVT))
  } catch {
    /* ignore */
  }
}

export function secondsPerScreen(id: string): number {
  return (CURSOR_SPEEDS.find((s) => s.id === id) ?? CURSOR_SPEEDS[1]).secondsPerScreen
}

/** Reactive: seconds the glide takes to cross the visible window. */
export function useCursorSpeed(): number {
  const [id, setId] = useState(DEFAULT_CURSOR_SPEED)
  useEffect(() => {
    setId(loadCursorSpeed())
    const h = () => setId(loadCursorSpeed())
    window.addEventListener(EVT, h)
    return () => window.removeEventListener(EVT, h)
  }, [])
  return secondsPerScreen(id)
}
