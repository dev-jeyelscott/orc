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
