"use client";

import type {
  AgentExecution,
  Harness,
  OrchestratorSettings,
  RunDetail,
} from "@orc/shared";
import {
  RotateCcwIcon,
  SaveIcon,
} from "lucide-react";
import {
  useState,
  type FormEvent,
} from "react";

import {
  ActiveAgentPanel,
  EventStreamPanel,
  ExecutionTimelinePanel,
  RunOverviewPanel,
} from "@/components/orchestrator-observability";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Textarea,
} from "@/components/ui/textarea";
import {
  changeOrchestratorHarness,
  harnessOptions,
  includePersistedOption,
} from "@/lib/harness-options";
import {
  formatStatusLabel,
  getLifecycleBadgeVariant,
} from "@/lib/task-presentation";
import { cn } from "@/lib/utils";

interface OrchestratorInspectorProps {
  runDetail: RunDetail | null;
  runError: string | null;
  activeExecution: AgentExecution | null;
  settings: OrchestratorSettings | null;
  settingsError: string | null;
  settingsSaving: boolean;
  onSaveSettings: (
    settings: OrchestratorSettings,
  ) => Promise<void>;
  onResetSettings: () => Promise<void>;
  now: number;
  className?: string;
}

/**
 * Returns whether an editable settings draft differs from the authoritative persisted settings.
 */
function settingsChanged(
  settings:
    OrchestratorSettings,
  draft:
    OrchestratorSettings,
): boolean {
  return (
    settings.harness !==
      draft.harness ||
    settings.model !==
      draft.model ||
    settings.reasoning !==
      draft.reasoning ||
    settings.systemPrompt !==
      draft.systemPrompt
  );
}

/**
 * Produces a stable remount key whenever authoritative persisted settings change.
 */
function settingsEditorKey(
  settings:
    OrchestratorSettings,
): string {
  return JSON.stringify(
    settings,
  );
}

/**
 * Renders the editable Orchestrator base configuration while keeping server-owned grounding rules non-editable.
 */
function OrchestratorSettingsEditor({
  settings,
  error,
  saving,
  onSave,
  onReset,
}: {
  settings:
    OrchestratorSettings;
  error:
    string | null;
  saving:
    boolean;
  onSave: (
    settings: OrchestratorSettings,
  ) => Promise<void>;
  onReset:
    () => Promise<void>;
}) {
  const [
    draft,
    setDraft,
  ] = useState<
    OrchestratorSettings
  >(() => ({
    ...settings,
  }));

  const options =
    harnessOptions[
      draft.harness
    ];

  const modelOptions =
    includePersistedOption(
      options.models,
      draft.model,
    );

  const reasoningOptions =
    includePersistedOption(
      options.reasoning,
      draft.reasoning,
    );

  const dirty =
    settingsChanged(
      settings,
      draft,
    );

  const valid =
    draft.model.trim().length >
      0 &&
    draft.reasoning.trim().length >
      0 &&
    draft.systemPrompt.trim()
      .length > 0;

  /**
   * Updates one field in the local settings draft without mutating persisted settings.
   */
  function updateDraft<
    K extends keyof OrchestratorSettings,
  >(
    key:
      K,
    value:
      OrchestratorSettings[K],
  ): void {
    setDraft(
      (current) => ({
        ...current,
        [key]:
          value,
      }),
    );
  }

  /**
   * Changes harness and selects the canonical default model and low reasoning when supported.
   */
  function handleHarnessChange(
    harness:
      Harness,
  ): void {
    setDraft(
      (current) =>
        changeOrchestratorHarness(
          current,
          harness,
        ),
    );
  }

  /**
   * Restores the local form to the authoritative persisted settings.
   */
  function handleCancel(): void {
    setDraft({
      ...settings,
    });
  }

  /**
   * Persists the complete editable Orchestrator settings draft through the owner callback.
   */
  async function handleSubmit(
    event:
      FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (
      saving ||
      !dirty ||
      !valid
    ) {
      return;
    }

    await onSave(
      draft,
    );
  }

  /**
   * Restores the local draft and requests an explicitly confirmed server-owned reset.
   */
  async function handleReset(): Promise<void> {
    if (saving) {
      return;
    }

    const confirmed =
      window.confirm(
        "Reset Orchestrator settings to the current server defaults? This replaces harness, model, reasoning, and the editable base system prompt.",
      );

    if (!confirmed) {
      return;
    }

    setDraft({
      ...settings,
    });

    await onReset();
  }

  return (
    <form
      onSubmit={
        handleSubmit
      }
      className="space-y-4"
    >
      <div className="rounded-lg border border-border-default bg-surface-interactive p-3">
        <p className="text-[11px] leading-5 text-text-secondary">
          Only the base system prompt below is editable. Server-owned grounding, tool, and safety instructions are appended internally to every Orchestrator turn and are not editable here.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-status-error/30 bg-status-error/5 p-2 text-[11px] text-status-error"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 rounded-lg border border-border-default bg-surface-interactive p-3">
        <label className="grid gap-1.5 text-xs">
          <span className="font-medium text-text-secondary">
            Harness
          </span>

          <Select
            value={
              draft.harness
            }
            onValueChange={(
              value,
            ) => {
              if (value) {
                handleHarnessChange(
                  value as Harness,
                );
              }
            }}
          >
            <SelectTrigger
              className="w-full"
              disabled={
                saving
              }
            >
              <SelectValue />
            </SelectTrigger>

            <SelectContent align="start">
              <SelectItem value="codex">
                Codex
              </SelectItem>

              <SelectItem value="claude">
                Claude
              </SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label className="grid gap-1.5 text-xs">
          <span className="font-medium text-text-secondary">
            Model
          </span>

          <Select
            value={
              draft.model
            }
            onValueChange={(
              value,
            ) => {
              if (value) {
                updateDraft(
                  "model",
                  value,
                );
              }
            }}
          >
            <SelectTrigger
              className="w-full"
              disabled={
                saving
              }
            >
              <SelectValue />
            </SelectTrigger>

            <SelectContent align="start">
              {modelOptions.map(
                (
                  model,
                ) => (
                  <SelectItem
                    key={
                      model
                    }
                    value={
                      model
                    }
                  >
                    {model}
                    {!options.models.includes(
                      model,
                    )
                      ? " (persisted legacy)"
                      : ""}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </label>

        <label className="grid gap-1.5 text-xs">
          <span className="font-medium text-text-secondary">
            Reasoning
          </span>

          <Select
            value={
              draft.reasoning
            }
            onValueChange={(
              value,
            ) => {
              if (value) {
                updateDraft(
                  "reasoning",
                  value,
                );
              }
            }}
          >
            <SelectTrigger
              className="w-full"
              disabled={
                saving
              }
            >
              <SelectValue />
            </SelectTrigger>

            <SelectContent align="start">
              {reasoningOptions.map(
                (
                  reasoning,
                ) => (
                  <SelectItem
                    key={
                      reasoning
                    }
                    value={
                      reasoning
                    }
                  >
                    {reasoning}
                    {!options.reasoning.includes(
                      reasoning,
                    )
                      ? " (persisted legacy)"
                      : ""}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </label>

        <label className="grid gap-1.5 text-xs">
          <span className="font-medium text-text-secondary">
            Base System Prompt
          </span>

          <Textarea
            value={
              draft.systemPrompt
            }
            onChange={(
              event,
            ) =>
              updateDraft(
                "systemPrompt",
                event.target
                  .value,
              )
            }
            required
            maxLength={
              40_000
            }
            disabled={
              saving
            }
            className="min-h-52 resize-y font-mono text-xs leading-relaxed"
          />

          <span className="text-[10px] leading-4 text-text-muted">
            This is the editable base prompt only. Runtime grounding, tool constraints, and safety instructions are appended by the server.
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={
            saving
          }
          onClick={() => {
            void handleReset();
          }}
        >
          <RotateCcwIcon className="size-3.5" />
          Reset to Defaults
        </Button>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={
              saving ||
              !dirty
            }
            onClick={
              handleCancel
            }
          >
            Cancel
          </Button>

          <Button
            type="submit"
            disabled={
              saving ||
              !dirty ||
              !valid
            }
          >
            <SaveIcon className="size-3.5" />

            {saving
              ? "Saving..."
              : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * Renders the tabbed authoritative run inspector used by desktop and responsive layouts.
 */
export function OrchestratorInspector({
  runDetail,
  runError,
  activeExecution,
  settings,
  settingsError,
  settingsSaving,
  onSaveSettings,
  onResetSettings,
  now,
  className,
}: OrchestratorInspectorProps) {
  const run =
    runDetail?.run ?? null;

  return (
    <Card
      className={cn(
        "h-full min-h-0 gap-0 overflow-hidden p-0",
        className,
      )}
    >
      <div className="shrink-0 border-b border-divider px-4 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-heading text-sm font-semibold text-text-primary">
              Inspector
            </h2>

            <p className="mt-0.5 text-[11px] text-text-muted">
              Run summary and live state
            </p>
          </div>

          <div className="flex min-w-0 flex-col items-end gap-1">
            {run ? (
              <Badge
                variant={getLifecycleBadgeVariant(
                  run.status,
                )}
              >
                {formatStatusLabel(
                  run.status,
                )}
              </Badge>
            ) : null}

            <span
              className="max-w-44 truncate text-[10px] text-text-muted"
              title={
                activeExecution
                  ?.agentName
              }
            >
              {activeExecution
                ?.agentName ??
                "No active execution"}
            </span>
          </div>
        </div>
      </div>

      <Tabs
        defaultValue="overview"
        className="min-h-0 flex-1 gap-0"
      >
        <div className="shrink-0 overflow-x-auto border-b border-divider px-3">
          <TabsList
            variant="line"
            className="min-w-max"
          >
            <TabsTrigger value="overview">
              Overview
            </TabsTrigger>

            <TabsTrigger value="executions">
              Executions
            </TabsTrigger>

            <TabsTrigger value="agent">
              Agent
            </TabsTrigger>

            <TabsTrigger value="events">
              Events
            </TabsTrigger>

            <TabsTrigger value="settings">
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="overview"
          className="min-h-0 overflow-y-auto p-3 data-[hidden]:hidden"
        >
          <RunOverviewPanel
            detail={runDetail}
            error={runError}
            activeExecution={
              activeExecution
            }
          />
        </TabsContent>

        <TabsContent
          value="executions"
          className="min-h-0 overflow-y-auto p-3 data-[hidden]:hidden"
        >
          <ExecutionTimelinePanel
            detail={runDetail}
            now={now}
          />
        </TabsContent>

        <TabsContent
          value="agent"
          className="min-h-0 overflow-y-auto p-3 data-[hidden]:hidden"
        >
          <ActiveAgentPanel
            execution={
              activeExecution
            }
          />
        </TabsContent>

        <TabsContent
          value="events"
          className="min-h-0 overflow-y-auto p-3 data-[hidden]:hidden"
        >
          <EventStreamPanel
            detail={runDetail}
          />
        </TabsContent>

        <TabsContent
          value="settings"
          className="min-h-0 overflow-y-auto p-3 data-[hidden]:hidden"
        >
          {settings ? (
            <OrchestratorSettingsEditor
              key={
                settingsEditorKey(
                  settings,
                )
              }
              settings={
                settings
              }
              error={
                settingsError
              }
              saving={
                settingsSaving
              }
              onSave={
                onSaveSettings
              }
              onReset={
                onResetSettings
              }
            />
          ) : (
            <p
              role={
                settingsError
                  ? "alert"
                  : undefined
              }
              className={
                settingsError
                  ? "text-xs text-status-error"
                  : "text-xs text-text-muted"
              }
            >
              {settingsError ??
                "Loading settings..."}
            </p>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}
