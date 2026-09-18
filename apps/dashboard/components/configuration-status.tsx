"use client";

import { useEffect, useState } from "react";
import type { ConfigurationStatusResponse } from "@orc/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getConfigurationStatus, syncConfiguration } from "@/lib/configuration";

type Display = "checking" | "valid" | "invalid" | "out_of_sync" | "unreachable";

/**
 * Displays `.orc/` configuration health. Department and Agent configuration
 * is file-authoritative as of Vertical Spec 2: `valid` means the canonical
 * tree parses and its PostgreSQL projection is current; `out_of_sync` means
 * a canonical file write succeeded but its projection sync failed.
 */
function ConfigurationStatus() {
  const [status, setStatus] = useState<ConfigurationStatusResponse | null>(null);
  const [display, setDisplay] = useState<Display>("checking");
  const [syncing, setSyncing] = useState(false);

  const refresh = () => {
    getConfigurationStatus()
      .then((result) => {
        setStatus(result);
        setDisplay(result.state === "syncing" ? "checking" : result.state);
      })
      .catch(() => {
        setDisplay("unreachable");
      });
  };

  useEffect(() => {
    let cancelled = false;

    getConfigurationStatus()
      .then((result) => {
        if (cancelled) return;
        setStatus(result);
        setDisplay(result.state === "syncing" ? "checking" : result.state);
      })
      .catch(() => {
        if (!cancelled) setDisplay("unreachable");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      await syncConfiguration();
    } catch {
      // Sync failure (e.g. invalid config) is reflected by the next status read below.
    } finally {
      setSyncing(false);
      refresh();
    }
  }

  const labels: Record<Display, string> = {
    checking: "Checking config",
    valid: "Config: Valid",
    invalid: `Config: Invalid${status ? ` (${status.errorCount})` : ""}`,
    out_of_sync: "Config: Out of sync",
    unreachable: "Config: Unreachable",
  };

  const variants = {
    checking: "neutral",
    valid: "success",
    invalid: "warning",
    out_of_sync: "warning",
    unreachable: "error",
  } as const;

  return (
    <div className="flex items-center gap-2">
      <Badge variant={variants[display]} title={status ? `.orc root: ${status.configRoot}` : undefined}>
        {labels[display]}
      </Badge>
      {(display === "out_of_sync" || display === "invalid") && (
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
          {syncing ? "Syncing..." : "Sync"}
        </Button>
      )}
    </div>
  );
}

export { ConfigurationStatus };
