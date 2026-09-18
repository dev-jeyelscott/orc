"use client";

import { useEffect, useState } from "react";
import type { ConfigurationStatusResponse } from "@orc/shared";

import { Badge } from "@/components/ui/badge";
import { getConfigurationStatus } from "@/lib/configuration";

type Display = "checking" | "valid" | "invalid" | "unreachable";

/**
 * Displays read-only `.orc/` configuration health. This is a status
 * indicator only -- `.orc/` is not yet the runtime authority for any
 * configuration, so this never implies files currently drive behavior.
 */
function ConfigurationStatus() {
  const [status, setStatus] = useState<ConfigurationStatusResponse | null>(null);
  const [display, setDisplay] = useState<Display>("checking");

  useEffect(() => {
    let cancelled = false;

    getConfigurationStatus()
      .then((result) => {
        if (cancelled) return;
        setStatus(result);
        setDisplay(result.state === "valid" ? "valid" : "invalid");
      })
      .catch(() => {
        if (!cancelled) setDisplay("unreachable");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const labels: Record<Display, string> = {
    checking: "Checking config",
    valid: "Config: Valid",
    invalid: `Config: Invalid${status ? ` (${status.errorCount})` : ""}`,
    unreachable: "Config: Unreachable",
  };

  const variants = {
    checking: "neutral",
    valid: "success",
    invalid: "warning",
    unreachable: "error",
  } as const;

  return (
    <Badge variant={variants[display]} title={status ? `.orc root: ${status.configRoot}` : undefined}>
      {labels[display]}
    </Badge>
  );
}

export { ConfigurationStatus };
