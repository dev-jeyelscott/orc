"use client";

import { useEffect, useState } from "react";
import type { HealthResponse } from "@orc/shared";

import { Badge } from "@/components/ui/badge";
import { getHealth } from "@/lib/health";

type Status =
  | "checking"
  | "ok"
  | "degraded"
  | "unreachable";

interface HealthStatusProps {
  health?: HealthResponse;
  compact?: boolean;
}

/**
 * Converts the health DTO into the component's display status.
 */
function statusFromHealth(
  health: HealthResponse,
): Exclude<Status, "checking" | "unreachable"> {
  return health.status;
}

/**
 * Displays application health from supplied data or the existing health endpoint.
 */
function HealthStatus({
  health,
  compact = false,
}: HealthStatusProps) {
  const [status, setStatus] =
    useState<Status>("checking");

  useEffect(() => {
    if (health) {
      return;
    }

    let cancelled = false;

    getHealth()
      .then((result) => {
        if (!cancelled) {
          setStatus(statusFromHealth(result));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("unreachable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [health]);

  const effectiveStatus = health
    ? statusFromHealth(health)
    : status;

  const labels = compact
    ? {
        checking: "Checking",
        ok: "Operational",
        degraded: "Degraded",
        unreachable: "Unreachable",
      }
    : {
        checking: "Checking backend...",
        ok: "Backend: ok",
        degraded: "Backend: degraded",
        unreachable: "Backend: unreachable",
      };

  const variants = {
    checking: "neutral",
    ok: "success",
    degraded: "warning",
    unreachable: "error",
  } as const;

  return (
    <Badge variant={variants[effectiveStatus]}>
      {labels[effectiveStatus]}
    </Badge>
  );
}

export { HealthStatus };
