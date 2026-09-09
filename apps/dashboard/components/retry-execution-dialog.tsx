"use client";

import type {
  Harness,
  RetryRun,
} from "@orc/shared";
import {
  useState,
} from "react";

import {
  Button,
} from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Label,
} from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  harnessOptions,
  includePersistedOption,
} from "@/lib/harness-options";
import {
  retryConfigurationForHarness,
  retryExecutionOverride,
  type RetryExecutionConfiguration,
} from "@/lib/retry-execution";

interface RetryExecutionDialogProps {
  open: boolean;
  configuration: RetryExecutionConfiguration;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: (override: RetryRun) => Promise<void>;
}

/**
 * Lets an operator change the harness configuration for exactly one retry.
 */
export function RetryExecutionDialog({
  open,
  configuration,
  submitting,
  onOpenChange,
  onRetry,
}: RetryExecutionDialogProps) {
  const [
    draft,
    setDraft,
  ] = useState<RetryExecutionConfiguration>(configuration);

  const options =
    harnessOptions[draft.harness];

  async function submit(): Promise<void> {
    await onRetry(
      retryExecutionOverride(configuration, draft),
    );
  }

  function changeHarness(harness: Harness): void {
    setDraft(
      retryConfigurationForHarness(draft, harness),
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retry execution</DialogTitle>
          <DialogDescription>
            Override the harness settings for this retry only. The workflow configuration remains unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="retry-harness">Harness</Label>
            <Select
              value={draft.harness}
              onValueChange={(value) =>
                changeHarness(value as Harness)}
              disabled={submitting}
            >
              <SelectTrigger id="retry-harness" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="codex">Codex</SelectItem>
                <SelectItem value="claude">Claude</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="retry-model">Model</Label>
            <Select
              value={draft.model}
              onValueChange={(model) =>
                setDraft((current) => ({
                  ...current,
                  model: model ?? current.model,
                }))}
              disabled={submitting}
            >
              <SelectTrigger id="retry-model" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {includePersistedOption(options.models, draft.model).map((model) => (
                  <SelectItem key={model} value={model}>{model}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="retry-reasoning">Reasoning</Label>
            <Select
              value={draft.reasoning}
              onValueChange={(reasoning) =>
                setDraft((current) => ({
                  ...current,
                  reasoning: reasoning ?? current.reasoning,
                }))}
              disabled={submitting}
            >
              <SelectTrigger id="retry-reasoning" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {includePersistedOption(options.reasoning, draft.reasoning).map((reasoning) => (
                  <SelectItem key={reasoning} value={reasoning}>{reasoning}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
          >
            {submitting ? "Retrying..." : "Retry execution"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
