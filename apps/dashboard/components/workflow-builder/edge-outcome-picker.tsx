"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { AgentRouteOutcome } from "@orc/shared";

import { OUTCOME_LABELS } from "@/lib/workflow-graph-draft";

/**
 * Shown immediately after a drag-to-connect from an Agent source, listing
 * only outcomes not already assigned from that source (roadmap section
 * 16 "Creating edges"). Confirmed as a modal rather than a floating
 * popover, since the connection has no stable DOM anchor to position a
 * popover against.
 */
export function EdgeOutcomePicker({
  open,
  availableOutcomes,
  onPick,
  onCancel,
}: {
  open: boolean;
  availableOutcomes: readonly AgentRouteOutcome[];
  onPick: (outcome: AgentRouteOutcome) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onCancel() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose an outcome</DialogTitle>
          <DialogDescription>
            Every Agent connection must carry exactly one outcome. Already-configured outcomes from
            this Agent are hidden.
          </DialogDescription>
        </DialogHeader>

        {availableOutcomes.length === 0 ? (
          <p className="text-sm text-text-muted">
            Every outcome from this Agent already has a connection. Delete one first to reroute it.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {availableOutcomes.map((outcome) => (
              <Button
                key={outcome}
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => onPick(outcome)}
              >
                {OUTCOME_LABELS[outcome]}
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
