import { z } from "zod";

export const taskSourceSchema = z.enum([
  "manual",
  "notion",
]);

export type TaskSource = z.infer<
  typeof taskSourceSchema
>;
