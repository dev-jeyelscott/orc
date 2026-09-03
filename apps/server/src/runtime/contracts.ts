import type { Harness } from "@orc/shared";

export type RuntimeCapabilities = {
  canWrite: boolean;
  canRunCommands: boolean;
  canCommit: boolean;
};

export type WorkerConfiguration = RuntimeCapabilities & {
  harness: Harness;
  model: string;
  reasoning: string;
  systemPrompt: string;
};

export type StartWorkerInput = {
  projectPath: string;
  agent: WorkerConfiguration;
  instruction: string;
};

export type SessionState = "starting" | "running" | "stopping" | "exited" | "failed";

export type UsageMetadata = Record<string, unknown>;

export type RuntimeDiagnostic = {
  code: "project_not_found" | "project_not_directory" | "cli_not_found" | "launch_failed" | "unsupported_configuration" | "unexpected_exit" | "usage_unavailable";
  message: string;
};

export type RuntimeEvent =
  | { type: "output"; sequence: number; data: string }
  | { type: "exit"; sequence: number; exitCode: number; signal?: number }
  | { type: "diagnostic"; sequence: number; diagnostic: RuntimeDiagnostic }
  | { type: "provider"; sequence: number; provider: string; event: Record<string, unknown> }
  | { type: "usage"; sequence: number; usage: UsageMetadata };

export type UnsequencedRuntimeEvent = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? Omit<Event, "sequence">
    : never
  : never;

export type SessionMetadata = {
  id: string;
  pid: number | null;
  state: SessionState;
  exitCode: number | null;
  signal: number | null;
  usage: UsageMetadata | null;
};

export type RuntimeSession = {
  readonly metadata: SessionMetadata;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  stop(): void;
};

export type PtyExitEvent = { exitCode: number; signal?: number };

export type PtyProcess = {
  pid: number;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: PtyExitEvent) => void): { dispose(): void };
  kill(signal?: string): void;
};

export type PtyFactory = {
  spawn(command: string, args: string[], options: { cwd: string; name: string; cols: number; rows: number }): PtyProcess;
};

export type HarnessInvocation = {
  command: string;
  args: string[];
  cwd: string;
};

export type HarnessAdapter = {
  readonly harness: Harness;
  createInvocation(input: StartWorkerInput, prompt: string): HarnessInvocation;
  translateOutput(data: string): UnsequencedRuntimeEvent[];
  // Extracts assistant-authored message text from a single provider event (the parsed JSON
  // object carried by a "provider" RuntimeEvent). Used by the agent execution service to
  // reconstruct the final message text and locate the structured <orc-result> completion
  // contract. Field names are harness-specific (see harnesses/claude.ts and harnesses/codex.ts)
  // and must stay out of generic runtime/workflow code.
  extractMessageText?(event: Record<string, unknown>): string | undefined;
};
