import { OrchestratorChat } from "@/components/orchestrator-chat";
export default function OrchestratorPage() { return <div className="flex flex-col gap-8"><header><h1 className="font-heading text-2xl font-semibold text-text-primary">Orchestrator</h1><p className="text-sm text-text-muted">Delegate work and inspect the persisted conversation.</p></header><OrchestratorChat /></div>; }
