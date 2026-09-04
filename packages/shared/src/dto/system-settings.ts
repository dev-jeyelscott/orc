import { z } from "zod";

export const systemSettingsSchema =
  z.object({
    autoModeEnabled:
      z.boolean(),
  });

export const systemSettingsResponseSchema =
  z.object({
    settings:
      systemSettingsSchema,
  });

export type SystemSettings = z.infer<
  typeof systemSettingsSchema
>;

export type SystemSettingsResponse = z.infer<
  typeof systemSettingsResponseSchema
>;
