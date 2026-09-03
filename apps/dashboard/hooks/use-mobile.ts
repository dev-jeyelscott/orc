import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/**
 * Subscribes React to browser viewport breakpoint changes.
 */
function subscribeToMobileBreakpoint(callback: () => void) {
  const mediaQuery = window.matchMedia(MOBILE_QUERY)

  mediaQuery.addEventListener("change", callback)

  return () => {
    mediaQuery.removeEventListener("change", callback)
  }
}

/**
 * Returns the current client-side mobile breakpoint state.
 */
function getMobileSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches
}

/**
 * Provides a deterministic server snapshot before browser hydration.
 */
function getServerMobileSnapshot() {
  return false
}

/**
 * Reports whether the current viewport is below the dashboard mobile breakpoint.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribeToMobileBreakpoint,
    getMobileSnapshot,
    getServerMobileSnapshot,
  )
}
