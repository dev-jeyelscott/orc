import {
  asc,
  desc,
  eq,
} from "drizzle-orm";

import {
  orchestratorTurnSchema,
  type Conversation,
  type ConversationMessage,
  type OrchestratorSettings,
  type OrchestratorToolCall,
  type OrchestratorTurn,
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
import {
  executeOrchestratorTool,
} from "./orchestrator-tool-service.js";
import {
  getProjectByPath,
} from "./project-discovery.js";

const SUPERVISOR_BLOCK_START =
  "<orc-supervisor>";
const SUPERVISOR_BLOCK_END =
  "</orc-supervisor>";
const MAX_ORCHESTRATOR_TOOL_ROUNDS =
  6;

const DEFAULT_ORCHESTRATOR_SETTINGS: OrchestratorSettings =
  {
    harness:
      "codex",
    model:
      "default",
    reasoning:
      "low",
    systemPrompt:
      "You supervise engineering workflows. Use only supplied system state and never invent execution progress.",
  };

type ToolHistoryItem = {
  tool:
    OrchestratorToolCall;
  result: unknown;
};

type SupervisorContext = {
  conversation: {
    id: string;
    projectPath:
      string;
    taskId:
      | string
      | null;
    runId:
      | string
      | null;
  };
  toolResults:
    ToolHistoryItem[];
};

export class ConversationServiceError extends Error {
  /**
   * Creates a conversation service error carrying its HTTP status.
   */
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

/**
 * Serializes a conversation database row into the shared API contract.
 */
function serializeConversation(
  row:
    typeof conversations.$inferSelect,
): Conversation {
  return {
    id:
      row.id,
    projectPath:
      row.projectPath,
    taskId:
      row.taskId ?? null,
    runId:
      row.runId ?? null,
    createdAt:
      row.createdAt.toISOString(),
    updatedAt:
      row.updatedAt.toISOString(),
  };
}

/**
 * Serializes a conversation message database row into the shared API contract.
 */
function serializeMessage(
  row:
    typeof conversationMessages.$inferSelect,
): ConversationMessage {
  return {
    id:
      row.id,
    conversationId:
      row.conversationId,
    role:
      row.role as
        | "user"
        | "assistant",
    content:
      row.content,
    createdAt:
      row.createdAt.toISOString(),
  };
}

/**
 * Serializes the persisted singleton orchestrator configuration.
 */
function serializeSettings(
  row:
    typeof orchestratorSettings.$inferSelect,
): OrchestratorSettings {
  return {
    harness:
      row.harness,
    model:
      row.model,
    reasoning:
      row.reasoning,
    systemPrompt:
      row.systemPrompt,
  };
}

/**
 * Resolves and canonicalizes one project path through filesystem-backed discovery.
 */
async function requireProject(
  projectPath: string,
) {
  const project =
    await getProjectByPath(
      env.WORKSPACE_ROOT,
      projectPath,
    );

  if (!project) {
    throw new ConversationServiceError(
      "The selected project is no longer available",
      404,
    );
  }

  return project;
}

/**
 * Ensures the singleton orchestrator settings row exists and returns its persisted value.
 */
export async function getOrchestratorSettings(): Promise<OrchestratorSettings> {
  await db
    .insert(
      orchestratorSettings,
    )
    .values({
      id: 1,
      ...DEFAULT_ORCHESTRATOR_SETTINGS,
    })
    .onConflictDoNothing({
      target:
        orchestratorSettings.id,
    });

  const [settings] =
    await db
      .select()
      .from(
        orchestratorSettings,
      )
      .where(
        eq(
          orchestratorSettings.id,
          1,
        ),
      );

  if (!settings) {
    throw new ConversationServiceError(
      "Orchestrator settings are unavailable",
      500,
    );
  }

  return serializeSettings(
    settings,
  );
}

/**
 * Updates the singleton orchestrator configuration without creating a worker-agent record.
 */
export async function updateOrchestratorSettings(
  input:
    OrchestratorSettings,
): Promise<OrchestratorSettings> {
  const [settings] =
    await db
      .insert(
        orchestratorSettings,
      )
      .values({
        id: 1,
        ...input,
        updatedAt:
          new Date(),
      })
      .onConflictDoUpdate({
        target:
          orchestratorSettings.id,
        set: {
          ...input,
          updatedAt:
            new Date(),
        },
      })
      .returning();

  return serializeSettings(
    settings,
  );
}

/**
 * Restores the singleton Orchestrator configuration through the existing settings upsert.
 */
export async function resetOrchestratorSettings(): Promise<OrchestratorSettings> {
  return updateOrchestratorSettings(
    DEFAULT_ORCHESTRATOR_SETTINGS,
  );
}

/**
 * Creates a new persisted conversation for a currently discovered project.
 */
export async function createConversation(
  projectPath: string,
): Promise<Conversation> {
  const project =
    await requireProject(
      projectPath,
    );

  const [created] =
    await db
      .insert(
        conversations,
      )
      .values({
        projectPath:
          project.path,
      })
      .returning();

  return serializeConversation(
    created,
  );
}

/**
 * Lists persisted conversations for one currently discovered project newest first.
 */
export async function listConversations(
  projectPath: string,
): Promise<
  Conversation[]
> {
  const project =
    await requireProject(
      projectPath,
    );

  return (
    await db
      .select()
      .from(
        conversations,
      )
      .where(
        eq(
          conversations.projectPath,
          project.path,
        ),
      )
      .orderBy(
        desc(
          conversations.updatedAt,
        ),
      )
  ).map(
    serializeConversation,
  );
}

/**
 * Loads a persisted conversation with its ordered message history.
 */
export async function getConversation(
  id: string,
): Promise<{
  conversation:
    Conversation;
  messages:
    ConversationMessage[];
} | null> {
  const [conversation] =
    await db
      .select()
      .from(
        conversations,
      )
      .where(
        eq(
          conversations.id,
          id,
        ),
      );

  if (!conversation) {
    return null;
  }

  const messages =
    await db
      .select()
      .from(
        conversationMessages,
      )
      .where(
        eq(
          conversationMessages.conversationId,
          id,
        ),
      )
      .orderBy(
        asc(
          conversationMessages.createdAt,
        ),
      );

  return {
    conversation:
      serializeConversation(
        conversation,
      ),
    messages:
      messages.map(
        serializeMessage,
      ),
  };
}

/**
 * Parses the exact supervisor envelope from provider-authored assistant text.
 */
function parseSupervisorTurn(
  text: string,
): OrchestratorTurn {
  const start =
    text.lastIndexOf(
      SUPERVISOR_BLOCK_START,
    );

  const end =
    text.indexOf(
      SUPERVISOR_BLOCK_END,
      start +
        SUPERVISOR_BLOCK_START.length,
    );

  if (
    start < 0 ||
    end < 0
  ) {
    throw new ConversationServiceError(
      "Supervisor did not return a valid tool response",
      502,
    );
  }

  const raw =
    text.slice(
      start +
        SUPERVISOR_BLOCK_START.length,
      end,
    );

  let parsedJson:
    unknown;

  try {
    parsedJson =
      JSON.parse(raw);
  } catch {
    throw new ConversationServiceError(
      "Supervisor returned malformed JSON",
      502,
    );
  }

  const parsed =
    orchestratorTurnSchema.safeParse(
      parsedJson,
    );

  if (!parsed.success) {
    throw new ConversationServiceError(
      "Supervisor returned an invalid tool response",
      502,
    );
  }

  return parsed.data;
}

/**
 * Runs one non-interactive supervisor turn using persisted orchestrator configuration.
 */
async function runSupervisorTurn(
  projectPath: string,
  content: string,
  context:
    SupervisorContext,
): Promise<OrchestratorTurn> {
  const config =
    await getOrchestratorSettings();

  const prompt = `${config.systemPrompt}

You are the conversational supervisor for this application.

Hard rules:
- Do not inspect or report runtime state from memory or inference.
- Do not claim that an agent is editing, testing, waiting, blocked, failed, or complete unless a backend tool result in this turn proves it.
- Use structured agent execution results for result and handoff summaries.
- Never use terminal text as authoritative workflow state.
- If toolResults is empty, you MUST return a tool_call. You may not return final.
- Use only these tools: get_project, get_task, create_task, start_run, get_run, get_agent_execution, get_recent_events, send_instruction, stop_run, retry_execution.
- Return exactly one JSON object inside ${SUPERVISOR_BLOCK_START} and ${SUPERVISOR_BLOCK_END}.
- To request a tool, return {"type":"tool_call","tool":{"name":"get_run","arguments":{}}}.
- After sufficient backend tool results are available, return {"type":"final","response":"..."}.
- Do not include text outside the supervisor envelope.

Persisted conversation references:
${JSON.stringify(context.conversation)}

Backend tool results from this turn:
${JSON.stringify(context.toolResults)}

User message:
${content}`;

  return new Promise<
    OrchestratorTurn
  >(
    (
      resolve,
      reject,
    ) => {
      const session =
        startHarnessSession(
          {
            projectPath,
            agent: {
              ...config,
              canWrite:
                false,
              canRunCommands:
                false,
              canCommit:
                false,
            },
            instruction:
              content,
          },
          prompt,
        );

      const adapter =
        getHarnessAdapter(
          config.harness,
        );

      let text = "";
      let settled =
        false;

      /**
       * Resolves or rejects the supervisor promise only once.
       */
      const finish = (
        callback:
          () => void,
      ): void => {
        if (settled) {
          return;
        }

        settled = true;
        callback();
      };

      session.subscribe(
        (event) => {
          if (
            event.type ===
            "provider"
          ) {
            if (
              event.event.type ===
                "error" &&
              typeof event.event
                .message ===
                "string"
            ) {
              finish(
                () =>
                  reject(
                    new ConversationServiceError(
                      event.event
                        .message as string,
                      502,
                    ),
                  ),
              );
              return;
            }

            const value =
              adapter.extractMessageText?.(
                event.event,
              );

            if (value) {
              text += value;
            }
          }

          if (
            event.type ===
              "diagnostic" &&
            session.metadata
              .state ===
              "failed"
          ) {
            finish(
              () =>
                reject(
                  new ConversationServiceError(
                    event.diagnostic
                      .message,
                    502,
                  ),
                ),
            );
            return;
          }

          if (
            event.type ===
            "exit"
          ) {
            finish(
              () => {
                try {
                  resolve(
                    parseSupervisorTurn(
                      text,
                    ),
                  );
                } catch (
                  error
                ) {
                  reject(
                    error,
                  );
                }
              },
            );
          }
        },
      );
    },
  );
}

/**
 * Preloads authoritative project, task, and run state into the supervisor context
 * to avoid unnecessary tool-call round trips for simple messages.
 */
async function preloadSupervisorContext(
  conversation:
    Conversation,
  toolResults:
    ToolHistoryItem[],
): Promise<void> {
  const preloadCalls: OrchestratorToolCall[] =
    [
      {
        name: "get_project",
        arguments: {},
      },
    ];

  if (
    conversation.taskId
  ) {
    preloadCalls.push({
      name: "get_task",
      arguments: {},
    });
  }

  if (
    conversation.runId
  ) {
    preloadCalls.push({
      name: "get_run",
      arguments: {},
    });
  }

  for (
    const tool of preloadCalls
  ) {
    try {
      const execution =
        await executeOrchestratorTool(
          conversation,
          tool,
        );

      toolResults.push({
        tool,
        result:
          execution.result,
      });
    } catch {
      // Preloading is a latency optimization only; the bounded tool loop can still
      // request this state itself if a stale task/run reference makes it unavailable.
    }
  }
}

/**
 * Persists current task/run references after a successful orchestrator control action.
 */
async function persistConversationReferences(
  id: string,
  taskId:
    | string
    | null,
  runId:
    | string
    | null,
  projectPath:
    string,
): Promise<void> {
  await db
    .update(
      conversations,
    )
    .set({
      projectPath,
      taskId,
      runId,
      updatedAt:
        new Date(),
    })
    .where(
      eq(
        conversations.id,
        id,
      ),
    );
}

/**
 * Persists a user message, executes a bounded grounded tool loop, and stores the final supervisor response.
 */
export async function postConversationMessage(
  id: string,
  content: string,
) {
  const found =
    await getConversation(
      id,
    );

  if (!found) {
    return null;
  }

  const initialProject =
    await requireProject(
      found.conversation
        .projectPath,
    );

  let taskId =
    found.conversation
      .taskId;

  let runId =
    found.conversation
      .runId;

  let projectPath =
    initialProject.path;

  await db
    .insert(
      conversationMessages,
    )
    .values({
      conversationId:
        id,
      role:
        "user",
      content,
    });

  await persistConversationReferences(
    id,
    taskId,
    runId,
    projectPath,
  );

  const toolResults:
    ToolHistoryItem[] =
    [];

  const initialConversation: Conversation =
    {
      ...found.conversation,
      projectPath,
      taskId,
      runId,
    };

  await preloadSupervisorContext(
    initialConversation,
    toolResults,
  );

  for (
    let round = 0;
    round <
    MAX_ORCHESTRATOR_TOOL_ROUNDS;
    round += 1
  ) {
    const project =
      await requireProject(
        projectPath,
      );

    projectPath =
      project.path;

    const conversationContext: Conversation =
      {
        ...found.conversation,
        projectPath,
        taskId,
        runId,
      };

    const turn =
      await runSupervisorTurn(
        projectPath,
        content,
        {
          conversation: {
            id,
            projectPath,
            taskId,
            runId,
          },
          toolResults,
        },
      );

    if (
      turn.type ===
      "final"
    ) {
      if (
        toolResults.length ===
        0
      ) {
        throw new ConversationServiceError(
          "Supervisor attempted to answer without querying system state",
          502,
        );
      }

      const [message] =
        await db
          .insert(
            conversationMessages,
          )
          .values({
            conversationId:
              id,
            role:
              "assistant",
            content:
              turn.response,
          })
          .returning();

      await persistConversationReferences(
        id,
        taskId,
        runId,
        projectPath,
      );

      return {
        message:
          serializeMessage(
            message,
          ),
        taskId,
        runId,
      };
    }

    const execution =
      await executeOrchestratorTool(
        conversationContext,
        turn.tool,
      );

    if (
      execution.references
    ) {
      if (
        execution.references
          .taskId !==
        undefined
      ) {
        taskId =
          execution.references
            .taskId;
      }

      if (
        execution.references
          .runId !==
        undefined
      ) {
        runId =
          execution.references
            .runId;
      }

      await persistConversationReferences(
        id,
        taskId,
        runId,
        projectPath,
      );
    }

    toolResults.push({
      tool:
        turn.tool,
      result:
        execution.result,
    });
  }

  throw new ConversationServiceError(
    `Supervisor exceeded the ${MAX_ORCHESTRATOR_TOOL_ROUNDS}-round tool limit`,
    502,
  );
}
