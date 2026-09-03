import { RunDetail } from "@/components/run-detail";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div className="flex flex-col gap-8"><header><h1 className="font-heading text-2xl font-semibold text-text-primary">Workflow run</h1><p className="text-sm text-text-muted">Sequential worker progress and results.</p></header><RunDetail runId={id} /></div>;
}
