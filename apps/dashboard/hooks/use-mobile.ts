import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

const BELOW_XL_BREAKPOINT = 1280
const BELOW_XL_QUERY = `(max-width: ${BELOW_XL_BREAKPOINT - 1}px)`

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

/**
 * Subscribes React to the shared below-`xl` breakpoint used to collapse
 * secondary toolbar controls on narrower viewports.
 */
function subscribeToBelowXlBreakpoint(callback: () => void) {
  const mediaQuery = window.matchMedia(BELOW_XL_QUERY)

  mediaQuery.addEventListener("change", callback)

  return () => {
    mediaQuery.removeEventListener("change", callback)
  }
}

function getBelowXlSnapshot() {
  return window.matchMedia(BELOW_XL_QUERY).matches
}

/**
 * Reports whether the current viewport is below the dashboard's `xl` breakpoint.
 */
export function useIsBelowXl() {
  return React.useSyncExternalStore(
    subscribeToBelowXlBreakpoint,
    getBelowXlSnapshot,
    getServerMobileSnapshot,
  )
}
