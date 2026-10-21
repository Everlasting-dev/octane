"use client"

// Persistence for the Self check: on/off switches (Settings) and the tuned
// thresholds (Self check panel → Tune). Both live in localStorage and notify
// every open hook so the panel, plots and Settings stay in step.

import { useCallback, useEffect, useState } from "react"
import { EMPTY_CONFIG, type SelfCheckConfig } from "./self-check"

export interface SelfCheckPrefs {
  /** run the checks automatically when a log loads */
  enabled: boolean
  /** shade findings on the plots */
  markPlots: boolean
  /** lowest severity shown on plots and in the strip */
  minSeverity: "info" | "warn" | "critical"
}

export const DEFAULT_PREFS: SelfCheckPrefs = { enabled: true, markPlots: true, minSeverity: "warn" }

const PREFS_KEY = "octane:self-check-prefs:v1"
const CONFIG_KEY = "octane:self-check-config:v1"
const EVT = "octane:self-check-changed"

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: keep the in-memory value */
  }
  try {
    window.dispatchEvent(new Event(EVT))
  } catch {
    /* ignore */
  }
}

export const loadPrefs = () => read<SelfCheckPrefs>(PREFS_KEY, DEFAULT_PREFS)
export const loadConfig = () => read<SelfCheckConfig>(CONFIG_KEY, EMPTY_CONFIG)

function useStored<T>(load: () => T, key: string, fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(fallback)
  useEffect(() => {
    setValue(load())
    const h = () => setValue(load())
    window.addEventListener(EVT, h)
    return () => window.removeEventListener(EVT, h)
  }, [load])
  const save = useCallback(
    (next: T) => {
      setValue(next)
      write(key, next)
    },
    [key],
  )
  return [value, save]
}

export function useSelfCheckPrefs() {
  return useStored(loadPrefs, PREFS_KEY, DEFAULT_PREFS)
}

export function useSelfCheckConfig() {
  return useStored(loadConfig, CONFIG_KEY, EMPTY_CONFIG)
}
