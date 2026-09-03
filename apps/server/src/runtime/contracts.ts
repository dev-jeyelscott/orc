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
  code:
    | "project_not_found"
    | "project_not_directory"
    | "cli_not_found"
    | "launch_failed"
    | "unsupported_configuration"
    | "unexpected_exit"
    | "usage_unavailable"
    | "instruction_failed";
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

  /** Subscribes to session events and replays events already emitted by the session. */
  subscribe(listener: (event: RuntimeEvent) => void): () => void;

  /**
   * Sends an additional instruction only when the active harness explicitly supports
   * translating runtime instructions into PTY input.
   */
  sendInstruction(instruction: string): boolean;

  /** Requests graceful process termination with the runtime-managed fallback behavior. */
  stop(): void;
};

export type PtyExitEvent = {
  exitCode: number;
  signal?: number;
};

export type PtyProcess = {
  pid: number;

  /** Registers a listener for raw PTY output. */
  onData(listener: (data: string) => void): { dispose(): void };

  /** Registers a listener for PTY process exit. */
  onExit(listener: (event: PtyExitEvent) => void): { dispose(): void };

  /** Writes raw input into the PTY when the spawned process supports stdin interaction. */
  write(data: string): void;

  /** Sends a termination signal to the PTY process. */
  kill(signal?: string): void;
};

export type PtySpawnOptions = {
  cwd: string;
  name: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
};

export type PtyFactory = {
  /** Spawns a PTY process using normalized runtime spawn options. */
  spawn(command: string, args: string[], options: PtySpawnOptions): PtyProcess;
};

export type HarnessInvocation = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type HarnessAdapter = {
  readonly harness: Harness;

  /** Builds the provider-specific CLI invocation without leaking provider details upstream. */
  createInvocation(
    input: StartWorkerInput,
    prompt: string,
    environment: NodeJS.ProcessEnv,
  ): HarnessInvocation;

  /** Converts provider output into normalized runtime events when structured data is available. */
  translateOutput(data: string): UnsequencedRuntimeEvent[];

  /**
   * Converts an additional runtime instruction into provider-specific PTY input.
   * Omit this hook when the current provider invocation is intentionally non-interactive.
   */
  formatInstructionInput?(instruction: string): string | null;

  /**
   * Extracts assistant-authored message text from a provider event.
   * Provider field names remain isolated inside the adapter.
   */
  extractMessageText?(event: Record<string, unknown>): string | undefined;
};
