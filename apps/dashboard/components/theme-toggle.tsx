"use client"

import { useSyncExternalStore } from "react"
import { MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"

/**
 * Registers a stable no-op subscription for the client hydration snapshot.
 */
function subscribeToHydration() {
  return () => {}
}

/**
 * Reports that the component is running in the hydrated browser tree.
 */
function getClientHydrationSnapshot() {
  return true
}

/**
 * Reports the deterministic pre-hydration state used during server rendering.
 */
function getServerHydrationSnapshot() {
  return false
}

/**
 * Toggles between the shared light and dark application themes without hydration mismatches.
 */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  )

  if (!mounted) {
    return (
      <Button variant="outline" size="sm" className="rounded-4xl" disabled>
        <MoonIcon />
        Dark Mode
      </Button>
    )
  }

  const isDark = resolvedTheme === "dark"

  return (
    <Button
      variant="outline"
      size="sm"
      className="rounded-4xl"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <MoonIcon /> : <SunIcon />}
      {isDark ? "Dark Mode" : "Light Mode"}
    </Button>
  )
}

export { ThemeToggle }
