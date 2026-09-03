"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { RunDetail as RunDetailData } from "@orc/shared";
import { cancelRun, getRun } from "@/lib/workflows";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const activeStatuses = new Set(["pending", "running"]);

export function RunDetail({ runId }: { runId: string }) {
  const [data, setData] = useState<RunDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const load = useCallback(() => { void getRun(runId).then((value) => { setData(value); setError(null); }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to load run")); }, [runId]);
  useEffect(() => { load(); const timer = setInterval(load, 2000); return () => clearInterval(timer); }, [load]);
  async function cancel() {
    if (!window.confirm("Cancel this active workflow?")) return;
    setCancelling(true);
    try { await cancelRun(runId); load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to cancel run"); } finally { setCancelling(false); }
  }
  if (error) return <Card><CardContent className="py-8 text-status-error">{error}</CardContent></Card>;
  if (!data) return <Card><CardContent className="py-8 text-text-muted">Loading run…</CardContent></Card>;
  const { run, task, executions } = data;
  return <div className="flex flex-col gap-6">
    <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>{task?.title ?? "Run"}</CardTitle><p className="mt-1 text-sm text-text-muted">{run.projectPath}</p></div><div className="flex items-center gap-3"><Badge variant={run.status === "completed" ? "success" : run.status === "running" ? "running" : run.status === "blocked" || run.status === "failed" ? "error" : "neutral"}>{run.status}</Badge>{activeStatuses.has(run.status) && <Button variant="destructive" onClick={() => void cancel()} disabled={cancelling}>{cancelling ? "Cancelling…" : "Cancel run"}</Button>}</div></CardHeader><CardContent className="flex flex-col gap-2 text-sm text-text-muted">{task && <p className="whitespace-pre-wrap">{task.instruction}</p>}<p>{run.terminalReason ?? `Execution ${run.executionCount} of 3`}</p></CardContent></Card>
    <Card><CardHeader><CardTitle>Executions</CardTitle></CardHeader><CardContent className="flex flex-col gap-2">{executions.length ? executions.map((execution) => <Link key={execution.id} href={`/agent-executions/${execution.id}`} className="rounded-lg border p-3 hover:bg-muted"><div className="font-medium">{execution.agentName} <span className="font-normal text-text-muted">· {execution.status}</span></div><div className="text-sm text-text-muted">{execution.resultStatus ?? execution.failureReason ?? "Awaiting result"}</div></Link>) : <p className="text-sm text-text-muted">Preparing the first worker…</p>}</CardContent></Card>
  </div>;
}
