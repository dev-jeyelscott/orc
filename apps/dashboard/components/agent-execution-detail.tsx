"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentExecution } from "@orc/shared";

import { getAgentExecution, getAgentExecutionMetrics } from "@/lib/agent-executions";
import { AgentDetailPanel } from "@/components/agent-detail-panel";
import { AgentExecutionTerminal } from "@/components/agent-execution-terminal";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

const statusVariant: Record<AgentExecution["status"], "running" | "success" | "error" | "neutral" | "warning"> = {
  pending: "neutral",
  starting: "warning",
  running: "running",
  completed: "success",
  failed: "error",
  blocked: "error",
  cancelled: "neutral",
};

export function AgentExecutionDetail({ executionId }: { executionId: string }) {
  const [execution, setExecution] = useState<AgentExecution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<{ cpuPercent: number | null; memoryBytes: number | null } | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    getAgentExecution(executionId)
      .then((result) => {
        if (cancelled) return;
        setExecution(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Unable to load agent execution");
      });
    return () => {
      cancelled = true;
    };
  }, [executionId]);

  useEffect(() => load(), [load]);
  useEffect(() => { if (!execution || !["starting", "running"].includes(execution.status)) return; const refresh = () => { void getAgentExecutionMetrics(execution.id).then(setMetrics); }; refresh(); const timer = setInterval(refresh, 2000); return () => clearInterval(timer); }, [execution]);

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-sm text-status-error">{error}</CardContent>
      </Card>
    );
  }

  if (!execution) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-10 text-sm text-text-muted">
          <Spinner className="size-4" /> Loading agent execution…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AgentDetailPanel
        title={execution.agentName}
        className="max-w-xl"
        fields={[
          { label: "Role", value: execution.agentRole },
          { label: "Harness", value: execution.harness },
          { label: "Model", value: execution.model },
          { label: "Reasoning", value: execution.reasoning },
          { label: "Layer / order", value: `${execution.layer} / ${execution.executionOrder}` },
          { label: "PID", value: execution.pid ? String(execution.pid) : "—" },
          { label: "Exit code", value: execution.exitCode !== null ? String(execution.exitCode) : "—" },
          { label: "Started", value: execution.startedAt ?? "—" },
          { label: "Completed", value: execution.completedAt ?? "—" },
          { label: "Failure reason", value: execution.failureReason ?? "—" },
          { label: "Token usage", value: execution.tokenUsage ? JSON.stringify(execution.tokenUsage) : "Unavailable" },
          { label: "Context usage", value: execution.contextUsage ? JSON.stringify(execution.contextUsage) : "Unavailable" },
          { label: "CPU", value: metrics?.cpuPercent === null || !metrics ? "Unavailable" : `${metrics.cpuPercent.toFixed(1)}%` },
          { label: "Memory", value: metrics?.memoryBytes === null || !metrics ? "Unavailable" : `${Math.round(metrics.memoryBytes / 1024 / 1024)} MB` },
        ]}
      />
      <div>
        <Badge variant={statusVariant[execution.status]}>{execution.status}</Badge>
      </div>
      <AgentExecutionTerminal executionId={execution.id} title={`${execution.agentName} terminal`} />
    </div>
  );
}
