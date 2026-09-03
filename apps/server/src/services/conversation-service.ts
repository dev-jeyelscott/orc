import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Conversation, ConversationMessage } from "@orc/shared";
import { db } from "../db/client.js";
import { conversationMessages, conversations, orchestratorSettings } from "../db/schema.js";
import { getHarnessAdapter, startHarnessSession } from "../runtime/index.js";
import { cancelRun, createAndStartTask, getRunDetail, retryLastExecution } from "./workflow-service.js";
import { listProjects } from "./project-discovery.js";
import { env } from "../config/env.js";

const actionSchema = z.discriminatedUnion("type", [z.object({ type: z.literal("start_task"), title: z.string().min(1).max(200), instruction: z.string().min(1).max(20_000) }), z.object({ type: z.literal("get_status"), runId: z.string().uuid().optional() }), z.object({ type: z.literal("stop_run"), runId: z.string().uuid() }), z.object({ type: z.literal("retry_run"), runId: z.string().uuid() }), z.object({ type: z.literal("none") })]);
const responseSchema = z.object({ response: z.string().min(1), action: actionSchema });
const START = "<orc-supervisor>"; const END = "</orc-supervisor>";
function serializeConversation(row: typeof conversations.$inferSelect): Conversation { return { ...row, taskId: row.taskId ?? null, runId: row.runId ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
function serializeMessage(row: typeof conversationMessages.$inferSelect): ConversationMessage { return { ...row, role: row.role as "user" | "assistant", createdAt: row.createdAt.toISOString() }; }
export async function getOrCreateConversation(projectPath: string): Promise<Conversation> { const [existing] = await db.select().from(conversations).where(eq(conversations.projectPath, projectPath)).orderBy(desc(conversations.updatedAt)).limit(1); if (existing) return serializeConversation(existing); const [created] = await db.insert(conversations).values({ projectPath }).returning(); return serializeConversation(created); }
export async function getConversation(id: string) { const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id)); if (!conversation) return null; const messages = await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, id)).orderBy(asc(conversationMessages.createdAt)); return { conversation: serializeConversation(conversation), messages: messages.map(serializeMessage) }; }
async function supervisorReply(projectPath: string, content: string, context: unknown) {
  const [settings] = await db.select().from(orchestratorSettings).limit(1);
  const config = settings ?? { harness: "codex" as const, model: "default", reasoning: "medium", systemPrompt: "You supervise engineering workflows." };
  const prompt = `${config.systemPrompt}\nYou may only choose one action from the JSON contract. Current persisted state: ${JSON.stringify(context)}\nUser: ${content}\nReturn exactly ${START}{"response":"...","action":{"type":"none"}}${END}; valid actions are start_task(title,instruction), get_status(runId?), stop_run(runId), retry_run(runId), none.`;
  return new Promise<z.infer<typeof responseSchema>>((resolve, reject) => {
    const session = startHarnessSession({ projectPath, agent: { ...config, canWrite: false, canRunCommands: false, canCommit: false }, instruction: content }, prompt);
    let text = "";
    const adapter = getHarnessAdapter(config.harness);
    session.subscribe((event) => { if (event.type === "provider") { if (event.event.type === "error" && typeof event.event.message === "string") { reject(new Error(event.event.message)); return; } const value = adapter.extractMessageText?.(event.event); if (value) text += value; } if (event.type === "diagnostic" && session.metadata.state === "failed") reject(new Error(event.diagnostic.message)); if (event.type === "exit") { const start = text.lastIndexOf(START); const end = text.indexOf(END, start + START.length); if (start < 0 || end < 0) { reject(new Error("Supervisor did not return a valid action response")); return; } try { const parsed = responseSchema.safeParse(JSON.parse(text.slice(start + START.length, end))); if (parsed.success) resolve(parsed.data); else reject(new Error("Supervisor returned an invalid action response")); } catch { reject(new Error("Supervisor returned malformed JSON")); } } });
  });
}
export async function postConversationMessage(id: string, content: string) {
  const found = await getConversation(id); if (!found) return null;
  await db.insert(conversationMessages).values({ conversationId: id, role: "user", content });
  const context = found.conversation.runId ? await getRunDetail(found.conversation.runId) : { projectPath: found.conversation.projectPath };
  const reply = await supervisorReply(found.conversation.projectPath, content, context);
  let taskId: string | null = null; let runId: string | null = found.conversation.runId;
  if (reply.action.type === "start_task") { const project = (await listProjects(env.WORKSPACE_ROOT)).projects.find((item) => item.path === found.conversation.projectPath); if (!project) throw new Error("The selected project is no longer available"); const created = await createAndStartTask({ projectId: project.id, title: reply.action.title, instruction: reply.action.instruction }); taskId = created.task.id; runId = created.run.id; }
  if (reply.action.type === "stop_run") await cancelRun(reply.action.runId);
  if (reply.action.type === "retry_run") await retryLastExecution(reply.action.runId);
  if (reply.action.type === "get_status") { const status = await getRunDetail(reply.action.runId ?? runId ?? ""); if (status) reply.response += `\n\nRun status: ${status.run.status}; current agent: ${status.run.currentAgentId ?? "none"}.`; }
  await db.update(conversations).set({ taskId, runId, updatedAt: new Date() }).where(eq(conversations.id, id));
  const [message] = await db.insert(conversationMessages).values({ conversationId: id, role: "assistant", content: reply.response }).returning();
  return { message: serializeMessage(message), taskId, runId };
}
