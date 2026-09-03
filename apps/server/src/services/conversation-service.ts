import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type {
  Conversation,
  ConversationMessage,
  OrchestratorSettings,
} from "@orc/shared";

import { env } from "../config/env.js";
import { db } from "../db/client.js";
import {
  conversationMessages,
  conversations,
  orchestratorSettings,
} from "../db/schema.js";
import {
  getHarnessAdapter,
  startHarnessSession,
} from "../runtime/index.js";
import { listProjects } from "./project-discovery.js";
import {
  cancelRun,
  createAndStartTask,
  getRunDetail,
  retryLastExecution,
} from "./workflow-service.js";

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start_task"),
    title: z.string().min(1).max(200),
    instruction: z.string().min(1).max(20_000),
  }),
  z.object({
    type: z.literal("get_status"),
    runId: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal("stop_run"),
    runId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("retry_run"),
    runId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("none"),
  }),
]);

const responseSchema = z.object({
  response: z.string().min(1),
  action: actionSchema,
});

const START = "<orc-supervisor>";
const END = "</orc-supervisor>";

const DEFAULT_ORCHESTRATOR_SETTINGS: OrchestratorSettings = {
  harness: "codex",
  model: "default",
  reasoning: "medium",
  systemPrompt: "You supervise engineering workflows.",
};

/** Serializes one persisted conversation into the shared API contract. */
function serializeConversation(
  row: typeof conversations.$inferSelect,
): Conversation {
  return {
    id: row.id,
    projectPath: row.projectPath,
    taskId: row.taskId ?? null,
    runId: row.runId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Serializes one persisted conversation message into the shared API contract. */
function serializeMessage(
  row: typeof conversationMessages.$inferSelect,
): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as "user" | "assistant",
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Returns the persisted supervisor configuration or the same fallback used during execution. */
export async function getOrchestratorSettings(): Promise<OrchestratorSettings> {
  const [settings] = await db
    .select()
    .from(orchestratorSettings)
    .limit(1);

  if (!settings) {
    return DEFAULT_ORCHESTRATOR_SETTINGS;
  }

  return {
    harness: settings.harness,
    model: settings.model,
    reasoning: settings.reasoning,
    systemPrompt: settings.systemPrompt,
  };
}

/** Returns the most recent project-scoped conversation or creates the first conversation. */
export async function getOrCreateConversation(
  projectPath: string,
): Promise<Conversation> {
  const [existing] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.projectPath, projectPath))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);

  if (existing) {
    return serializeConversation(existing);
  }

  const [created] = await db
    .insert(conversations)
    .values({ projectPath })
    .returning();

  return serializeConversation(created);
}

/** Loads one persisted conversation together with its chronological message history. */
export async function getConversation(id: string) {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));

  if (!conversation) {
    return null;
  }

  const messages = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, id))
    .orderBy(asc(conversationMessages.createdAt));

  return {
    conversation: serializeConversation(conversation),
    messages: messages.map(serializeMessage),
  };
}

/** Runs the supervisor harness against only the currently supplied authoritative system context. */
async function supervisorReply(
  projectPath: string,
  content: string,
  context: unknown,
) {
  const config = await getOrchestratorSettings();

  const prompt = `${config.systemPrompt}
You may only choose one action from the JSON contract.
Current persisted state: ${JSON.stringify(context)}
User: ${content}
Return exactly ${START}{"response":"...","action":{"type":"none"}}${END};
valid actions are start_task(title,instruction), get_status(runId?), stop_run(runId), retry_run(runId), none.`;

  return new Promise<z.infer<typeof responseSchema>>((resolve, reject) => {
    const session = startHarnessSession(
      {
        projectPath,
        agent: {
          ...config,
          canWrite: false,
          canRunCommands: false,
          canCommit: false,
        },
        instruction: content,
      },
      prompt,
    );

    let text = "";
    const adapter = getHarnessAdapter(config.harness);

    session.subscribe((event) => {
      if (event.type === "provider") {
        if (
          event.event.type === "error" &&
          typeof event.event.message === "string"
        ) {
          reject(new Error(event.event.message));
          return;
        }

        const value = adapter.extractMessageText?.(event.event);

        if (value) {
          text += value;
        }
      }

      if (
        event.type === "diagnostic" &&
        session.metadata.state === "failed"
      ) {
        reject(new Error(event.diagnostic.message));
      }

      if (event.type !== "exit") {
        return;
      }

      const start = text.lastIndexOf(START);
      const end = text.indexOf(END, start + START.length);

      if (start < 0 || end < 0) {
        reject(
          new Error(
            "Supervisor did not return a valid action response",
          ),
        );
        return;
      }

      try {
        const parsed = responseSchema.safeParse(
          JSON.parse(text.slice(start + START.length, end)),
        );

        if (!parsed.success) {
          reject(
            new Error(
              "Supervisor returned an invalid action response",
            ),
          );
          return;
        }

        resolve(parsed.data);
      } catch {
        reject(new Error("Supervisor returned malformed JSON"));
      }
    });
  });
}

/** Persists a user message, executes one supervisor action, and persists the grounded reply. */
export async function postConversationMessage(
  id: string,
  content: string,
) {
  const found = await getConversation(id);

  if (!found) {
    return null;
  }

  await db.insert(conversationMessages).values({
    conversationId: id,
    role: "user",
    content,
  });

  const context = found.conversation.runId
    ? await getRunDetail(found.conversation.runId)
    : {
        projectPath: found.conversation.projectPath,
      };

  const reply = await supervisorReply(
    found.conversation.projectPath,
    content,
    context,
  );

  let taskId: string | null = found.conversation.taskId;
  let runId: string | null = found.conversation.runId;

  if (reply.action.type === "start_task") {
    const project = (
      await listProjects(env.WORKSPACE_ROOT)
    ).projects.find(
      (item) =>
        item.path === found.conversation.projectPath,
    );

    if (!project) {
      throw new Error(
        "The selected project is no longer available",
      );
    }

    const created = await createAndStartTask({
      projectId: project.id,
      title: reply.action.title,
      instruction: reply.action.instruction,
    });

    taskId = created.task.id;
    runId = created.run.id;
  }

  if (reply.action.type === "stop_run") {
    await cancelRun(reply.action.runId);
  }

  if (reply.action.type === "retry_run") {
    await retryLastExecution(reply.action.runId);
  }

  if (reply.action.type === "get_status") {
    const requestedRunId =
      reply.action.runId ?? runId;

    if (requestedRunId) {
      const status =
        await getRunDetail(requestedRunId);

      if (status) {
        const currentExecution =
          status.executions
            .filter((execution) =>
              ["starting", "running"].includes(
                execution.status,
              ),
            )
            .at(-1);

        reply.response += `

Run status: ${status.run.status}; current agent: ${
          currentExecution?.agentName ?? "none"
        }.`;
      }
    } else {
      reply.response +=
        "\n\nNo run is currently linked to this conversation.";
    }
  }

  await db
    .update(conversations)
    .set({
      taskId,
      runId,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, id));

  const [message] = await db
    .insert(conversationMessages)
    .values({
      conversationId: id,
      role: "assistant",
      content: reply.response,
    })
    .returning();

  return {
    message: serializeMessage(message),
    taskId,
    runId,
  };
}
