"use client"

import { useCallback, useSyncExternalStore } from "react"

/**
 * Viewport breakpoints.
 *
 * These strings are the single source of truth for "is this a phone layout".
 * `app/globals.css` uses the exact same queries, so the CSS that moves chrome
 * around and the JS that decides which chrome to render can never disagree.
 *
 * Deriving this in JS from `window.innerWidth` / `window.innerHeight` instead
 * is what caused the layout to desync on iOS: `innerHeight` tracks the *visual*
 * viewport, which shrinks as Safari's toolbars slide in, while a CSS
 * `max-height` media query is evaluated against the *large* viewport. On a
 * landscape iPhone the two straddle the 540px threshold, so JS would drop the
 * header while CSS still reserved room for it (or the reverse).
 */
export const MOBILE_QUERY = "(max-width: 1023px)"
export const MOBILE_LANDSCAPE_QUERY = "(max-width: 1023px) and (orientation: landscape)"
export const MOBILE_LANDSCAPE_TIGHT_QUERY =
  "(max-width: 1023px) and (orientation: landscape) and (max-height: 540px)"

function listen(query: string, onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {}
  const list = window.matchMedia(query)
  // Safari < 14 only has the deprecated addListener/removeListener pair.
  if (typeof list.addEventListener === "function") {
    list.addEventListener("change", onChange)
    return () => list.removeEventListener("change", onChange)
  }
  list.addListener(onChange)
  return () => list.removeListener(onChange)
}

/**
 * Subscribe to a media query.
 *
 * `serverValue` is what the static export renders with; the real value is
 * picked up on hydration, so it must match the markup Next.js pre-rendered.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  // These three have to be referentially stable: useSyncExternalStore tears down
  // and re-creates the subscription whenever `subscribe` changes identity.
  const subscribe = useCallback((onChange: () => void) => listen(query, onChange), [query])
  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return serverValue
    return window.matchMedia(query).matches
  }, [query, serverValue])
  const getServerSnapshot = useCallback(() => serverValue, [serverValue])
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** True on phone/small-tablet layouts. Mirrors the CSS `MOBILE_QUERY` block. */
export function useMobileViewport(serverValue = false): boolean {
  return useMediaQuery(MOBILE_QUERY, serverValue)
}

/**
 * True on a short landscape phone screen, where the plot takes over the
 * whole surface. Mirrors the CSS `MOBILE_LANDSCAPE_TIGHT_QUERY` block.
 */
export function useMobileLandscapeTight(serverValue = false): boolean {
  return useMediaQuery(MOBILE_LANDSCAPE_TIGHT_QUERY, serverValue)
}

/** Imperative check for event handlers that run outside of render. */
export function isMobileViewportNow(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches
}
