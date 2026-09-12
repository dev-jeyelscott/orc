import type {
  Harness,
} from "@orc/shared";
import type {
  SandboxMode,
} from "@orc/shared";

export type EffectiveAgentConfig = {
  role: string;
  harness: Harness;
  model: string;
  reasoning: string;
  systemPrompt: string;
  canWrite: boolean;
  canRunCommands: boolean;
  sandboxMode: SandboxMode | null;
  canCommit: boolean;
  enabled: boolean;
};

export type EffectiveAgentInput = {
  enabled: boolean;
  harnessOverride?: Harness | null;
  canWriteOverride?: boolean | null;
  canRunCommandsOverride?: boolean | null;
  sandboxModeOverride?: SandboxMode | null;
  canCommitOverride?: boolean | null;
  modelOverride: string | null;
  reasoningOverride: string | null;
  additionalPrompt: string;
};

export type EffectiveDepartmentInput = {
  role: string;
  harness: Harness;
  defaultModel: string;
  defaultReasoning: string;
  systemPrompt: string;
  canWrite: boolean;
  canRunCommands: boolean;
  sandboxMode?: SandboxMode | null;
  canCommit: boolean;
  enabled: boolean;
};

/**
 * Resolves the one deterministic effective runtime configuration for an Agent
 * from its owning Department plus approved Agent-level overrides. Department
 * remains authoritative for role and base prompt; approved runtime fields
 * independently inherit unless an explicit override is present.
 *
 * This resolver is the single source of truth for effective configuration:
 * runtime snapshot construction and API/dashboard presentation both call it
 * rather than duplicating this logic. It intentionally never persists a copy
 * of the resolved values, so a Department edit changes future Runs without a
 * sync job.
 */
export function resolveEffectiveAgentConfig(
  agent: EffectiveAgentInput,
  department: EffectiveDepartmentInput,
): EffectiveAgentConfig {
  return {
    role: department.role,
    harness: agent.harnessOverride ?? department.harness,
    model: agent.modelOverride ?? department.defaultModel,
    reasoning: agent.reasoningOverride ?? department.defaultReasoning,
    systemPrompt: agent.additionalPrompt
      ? `${department.systemPrompt}\n\n${agent.additionalPrompt}`
      : department.systemPrompt,
    canWrite: agent.canWriteOverride ?? department.canWrite,
    canRunCommands: agent.canRunCommandsOverride ?? department.canRunCommands,
    sandboxMode: agent.sandboxModeOverride ?? department.sandboxMode ?? null,
    canCommit: agent.canCommitOverride ?? department.canCommit,
    enabled: department.enabled && agent.enabled,
  };
}
