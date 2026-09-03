import { z } from "zod";

export const harnessSchema = z.enum(["claude", "codex"]);

export type Harness = z.infer<typeof harnessSchema>;
