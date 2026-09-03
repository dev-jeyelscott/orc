"use client"

import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { getHealth } from "@/lib/health"

type Status = "checking" | "ok" | "degraded" | "unreachable"

function HealthStatus() {
  const [status, setStatus] = useState<Status>("checking")

  useEffect(() => {
    let cancelled = false

    getHealth()
      .then((result) => {
        if (!cancelled) setStatus(result.status)
      })
      .catch(() => {
        if (!cancelled) setStatus("unreachable")
      })

    return () => {
      cancelled = true
    }
  }, [])

  const label = {
    checking: "Checking backend…",
    ok: "Backend: ok",
    degraded: "Backend: degraded",
    unreachable: "Backend: unreachable",
  }[status]

  const variant = {
    checking: "neutral",
    ok: "success",
    degraded: "warning",
    unreachable: "error",
  }[status] as "neutral" | "success" | "warning" | "error"

  return <Badge variant={variant}>{label}</Badge>
}

export { HealthStatus }
