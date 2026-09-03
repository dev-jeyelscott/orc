import { AgentExecutionDetail } from "@/components/agent-execution-detail";

export default async function AgentExecutionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Agent execution</h1>
        <p className="text-sm text-text-muted">Live terminal output and metadata for a single agent execution.</p>
      </header>
      <AgentExecutionDetail executionId={id} />
    </div>
  );
}
