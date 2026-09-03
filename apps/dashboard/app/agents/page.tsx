import { AgentsManager } from "@/components/agents-manager";

export default function AgentsPage() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Agents</h1>
        <p className="text-sm text-text-muted">Configure the workers and outcome routes used by future runs.</p>
      </header>
      <AgentsManager />
    </div>
  );
}
