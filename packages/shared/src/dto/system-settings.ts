import {
  z,
} from "zod";

export const systemSettingsSchema =
  z.object({
    autoModeEnabled:
      z.boolean(),
  });

export const updateSystemSettingsSchema =
  z.object({
    autoModeEnabled:
      z.boolean(),
  });

export const automationStatusStateSchema =
  z.enum([
    "off",
    "running",
    "waiting_approval",
    "cooldown",
    "ready",
  ]);

export const automationStatusSchema =
  z.object({
    state:
      automationStatusStateSchema,
    nextEligibleAt:
      z.string()
        .datetime()
        .nullable(),
  });

export const systemSettingsResponseSchema =
  z.object({
    settings:
      systemSettingsSchema,
  });

export const automationStatusResponseSchema =
  z.object({
    status:
      automationStatusSchema,
  });

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

export type SystemSettings =
  z.infer<
    typeof systemSettingsSchema
  >;

export type UpdateSystemSettings =
  z.infer<
    typeof updateSystemSettingsSchema
  >;

export type AutomationStatusState =
  z.infer<
    typeof automationStatusStateSchema
  >;

export type AutomationStatus =
  z.infer<
    typeof automationStatusSchema
  >;

export type SystemSettingsResponse =
  z.infer<
    typeof systemSettingsResponseSchema
  >;

export type AutomationStatusResponse =
  z.infer<
    typeof automationStatusResponseSchema
  >;

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
