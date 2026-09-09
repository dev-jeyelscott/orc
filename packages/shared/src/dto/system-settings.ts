import {
  z,
} from "zod";

export const teamAutomationStatusStateSchema =
  z.enum([
    "off",
    "ready",
    "running",
    "waiting_approval",
    "cooldown",
    "unavailable",
  ]);

export const teamAutomationUnavailableReasonSchema =
  z.enum([
    "team_disabled",
    "missing_notion_data_source",
    "missing_notion_api_key",
    "no_enabled_agents",
  ])
    .nullable();

export const teamAutomationStatusSchema =
  z.object({
    teamId:
      z.string().uuid(),
    autoModeEnabled:
      z.boolean(),
    state:
      teamAutomationStatusStateSchema,
    nextEligibleAt:
      z.string()
        .datetime()
        .nullable(),
    blockedByActiveRun:
      z.boolean(),
    unavailableReason:
      teamAutomationUnavailableReasonSchema,
  });

export const teamAutomationStatusResponseSchema =
  z.object({
    teams:
      z.array(
        teamAutomationStatusSchema,
      ),
  });

export type TeamAutomationStatusState =
  z.infer<
    typeof teamAutomationStatusStateSchema
  >;

export type TeamAutomationUnavailableReason =
  z.infer<
    typeof teamAutomationUnavailableReasonSchema
  >;

export type TeamAutomationStatus =
  z.infer<
    typeof teamAutomationStatusSchema
  >;

export type TeamAutomationStatusResponse =
  z.infer<
    typeof teamAutomationStatusResponseSchema
  >;
