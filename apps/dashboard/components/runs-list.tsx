"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Run } from "@orc/shared";
import { getRuns } from "@/lib/workflows";
import { Card, CardContent } from "@/components/ui/card";

export function RunsList() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { void getRuns().then(setRuns).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to load runs")); }, []);
  useEffect(() => { load(); const timer = setInterval(load, 2000); return () => clearInterval(timer); }, [load]);
  if (error) return <Card><CardContent className="py-8 text-status-error">{error}</CardContent></Card>;
  return <Card><CardContent className="flex flex-col gap-2 py-6">{runs.length ? runs.map((run) => <Link key={run.id} href={`/runs/${run.id}`} className="rounded-lg border p-3 hover:bg-muted"><span className="font-medium">{run.status}</span><span className="ml-2 text-sm text-text-muted">{run.projectPath} · {run.executionCount} execution(s)</span></Link>) : <p className="text-sm text-text-muted">No runs yet.</p>}</CardContent></Card>;
}
