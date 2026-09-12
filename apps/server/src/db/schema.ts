import {
  sql,
} from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * Keep this schema-local compatibility default synchronized with seed-ids.ts.
 * Drizzle Kit evaluates schema.ts directly and cannot resolve NodeNext .js
 * source imports before TypeScript compilation.
 */
const RESOLUTION_TEAM_ID =
  "00000000-0000-4000-9000-000000000001";

export const harnessEnum =
  pgEnum(
    "harness",
    [
      "claude",
      "codex",
    ],
  );

export const sandboxModeEnum =
  pgEnum(
    "sandbox_mode",
    [
      "read-only",
      "workspace-write",
      "danger-full-access",
    ],
  );

export const taskSourceEnum =
  pgEnum(
    "task_source",
    [
      "manual",
      "notion",
    ],
  );

export const agentRouteOutcomeEnum =
  pgEnum(
    "agent_route_outcome",
    [
      "completed",
      "approved",
      "changes_requested",
      "blocked",
      "failed",
    ],
  );

export const terminalActionEnum =
  pgEnum(
    "terminal_action",
    [
      "complete_run",
      "fail_run",
      "block_run",
    ],
  );

export const runStatusEnum =
  pgEnum(
    "run_status",
    [
      "pending",
      "running",
      "completed",
      "failed",
      "blocked",
      "cancelled",
      "skipped",
    ],
  );

export const agentExecutionStatusEnum =
  pgEnum(
    "agent_execution_status",
    [
      "pending",
      "starting",
      "running",
      "completed",
      "failed",
      "blocked",
      "cancelled",
    ],
  );

export const agentResultStatusEnum =
  pgEnum(
    "agent_result_status",
    [
      "completed",
      "approved",
      "changes_requested",
      "blocked",
      "failed",
    ],
  );

const timestamps = {
  createdAt:
    timestamp(
      "created_at",
      {
        withTimezone:
          true,
      },
    )
      .notNull()
      .defaultNow(),
  updatedAt:
    timestamp(
      "updated_at",
      {
        withTimezone:
          true,
      },
    )
      .notNull()
      .defaultNow(),
};

/**
 * Stores reusable, generic runtime defaults. Agents do not reference this
 * table until the subsequent inheritance vertical slice is introduced.
 */
export const departments =
  pgTable(
    "departments",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      slug:
        text("slug")
          .notNull()
          .unique(),
      name:
        text("name")
          .notNull(),
      role:
        text("role")
          .notNull(),
      description:
        text("description")
          .notNull()
          .default(""),
      enabled:
        boolean("enabled")
          .notNull()
          .default(true),
      harness:
        harnessEnum("harness")
          .notNull(),
      defaultModel:
        text("default_model")
          .notNull(),
      defaultReasoning:
        text("default_reasoning")
          .notNull(),
      systemPrompt:
        text("system_prompt")
          .notNull(),
      canWrite:
        boolean("can_write")
          .notNull()
          .default(false),
      canRunCommands:
        boolean("can_run_commands")
          .notNull()
          .default(false),
      sandboxMode:
        sandboxModeEnum("sandbox_mode"),
      canCommit:
        boolean("can_commit")
          .notNull()
          .default(false),
      ...timestamps,
    },
  );

export const teams =
  pgTable(
    "teams",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      slug:
        text("slug")
          .notNull()
          .unique(),
      name:
        text("name")
          .notNull(),
      description:
        text(
          "description",
        )
          .notNull()
          .default(""),
      enabled:
        boolean(
          "enabled",
        )
          .notNull()
          .default(true),
      notionDataSourceId:
        text(
          "notion_data_source_id",
        ),
      autoModeEnabled:
        boolean(
          "auto_mode_enabled",
        )
          .notNull()
          .default(false),
      ...timestamps,
    },
    (table) => [
      unique(
        "teams_notion_data_source_id_unique",
      ).on(
        table.notionDataSourceId,
      ),
    ],
  );

/**
 * Project existence remains filesystem-backed. This table stores only optional
 * configuration for a currently discoverable canonical project path.
 */
export const projectTeamAssignments =
  pgTable(
    "project_team_assignments",
    {
      projectPath: text("project_path").primaryKey(),
      teamId: uuid("team_id")
        .notNull()
        .references(() => teams.id, { onDelete: "restrict" }),
      notionDataSourceId: text("notion_data_source_id"),
      autoModeEnabled: boolean("auto_mode_enabled").notNull().default(false),
      ...timestamps,
    },
    (table) => [
      unique("project_team_assignments_notion_data_source_id_unique").on(
        table.notionDataSourceId,
      ),
      index("project_team_assignments_team_id_idx").on(table.teamId),
    ],
  );

export const agents =
  pgTable(
    "agents",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      teamId:
        uuid(
          "team_id",
        )
          .notNull()
          .default(
            RESOLUTION_TEAM_ID,
          )
          .references(
            () =>
              teams.id,
            {
              onDelete:
                "restrict",
            },
          ),
      departmentId:
        uuid(
          "department_id",
        )
          .notNull()
          .references(
            () =>
              departments.id,
            {
              onDelete:
                "restrict",
            },
          ),
      slug:
        text("slug")
          .notNull()
          .unique(),
      name:
        text("name")
          .notNull(),
      /**
       * Legacy Department-owned defaults, retained nullable for compatibility
       * and rollback safety. No longer written for new Agents and no longer
       * read as the source of runtime truth; effective configuration is
       * resolved from the owning Department plus these Agent-level overrides.
       */
      role:
        text("role"),
      description:
        text(
          "description",
        )
          .notNull()
          .default(""),
      /**
       * Legacy Team-owned workflow placement, retained nullable for
       * compatibility and rollback safety. `team_members` is now the
       * authoritative source of Team composition, layer, and execution
       * order; new Agents are created without workflow placement.
       */
      layer:
        integer(
          "layer",
        ),
      executionOrder:
        integer(
          "execution_order",
        ),
      harness:
        harnessEnum(
          "harness",
        ),
      model:
        text("model"),
      reasoning:
        text(
          "reasoning",
        ),
      systemPrompt:
        text(
          "system_prompt",
        ),
      enabled:
        boolean(
          "enabled",
        )
          .notNull()
          .default(true),
      canWrite:
        boolean(
          "can_write",
        )
          .notNull()
          .default(false),
      canRunCommands:
        boolean(
          "can_run_commands",
        )
          .notNull()
          .default(false),
      sandboxMode:
        sandboxModeEnum(
          "sandbox_mode",
        ),
      canCommit:
        boolean(
          "can_commit",
        )
          .notNull()
          .default(false),
      modelOverride:
        text(
          "model_override",
        ),
      reasoningOverride:
        text(
          "reasoning_override",
        ),
      additionalPrompt:
        text(
          "additional_prompt",
        )
          .notNull()
          .default(""),
      ...timestamps,
    },
    (table) => [
      unique(
        "agents_team_layer_execution_order_unique",
      ).on(
        table.teamId,
        table.layer,
        table.executionOrder,
      ),
      /**
       * Lets `team_members` declare a composite foreign key on
       * (agent_id, department_id) so the database guarantees a Team
       * member's stored Department always matches its selected Agent's
       * Department.
       */
      unique(
        "agents_id_department_id_unique",
      ).on(
        table.id,
        table.departmentId,
      ),
      check(
        "agents_layer_check",
        sql`${table.layer} >= 1`,
      ),
      check(
        "agents_execution_order_check",
        sql`${table.executionOrder} >= 1`,
      ),
    ],
  );

export const agentRoutes =
  pgTable(
    "agent_routes",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      sourceAgentId:
        uuid(
          "source_agent_id",
        )
          .notNull()
          .references(
            () =>
              agents.id,
            {
              onDelete:
                "cascade",
            },
          ),
      outcome:
        agentRouteOutcomeEnum(
          "outcome",
        ).notNull(),
      targetAgentId:
        uuid(
          "target_agent_id",
        ).references(
          () =>
            agents.id,
          {
            onDelete:
              "cascade",
          },
        ),
      terminalAction:
        terminalActionEnum(
          "terminal_action",
        ),
      enabled:
        boolean(
          "enabled",
        )
          .notNull()
          .default(true),
      ...timestamps,
    },
    (table) => [
      unique(
        "agent_routes_source_outcome_unique",
      ).on(
        table.sourceAgentId,
        table.outcome,
      ),
      check(
        "agent_routes_destination_check",
        sql`(${table.targetAgentId} is null) <> (${table.terminalAction} is null)`,
      ),
    ],
  );

/**
 * Authoritative Team composition and workflow-placement table. Replaces
 * Agent-owned `team_id`/`layer`/`execution_order` as the live source of
 * Team topology; those legacy Agent columns are retained only for
 * compatibility until Spec 5 removes them.
 */
export const teamMembers =
  pgTable(
    "team_members",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      teamId:
        uuid(
          "team_id",
        )
          .notNull()
          .references(
            () =>
              teams.id,
            {
              onDelete:
                "restrict",
            },
          ),
      departmentId:
        uuid(
          "department_id",
        )
          .notNull()
          .references(
            () =>
              departments.id,
            {
              onDelete:
                "restrict",
            },
          ),
      agentId:
        uuid(
          "agent_id",
        )
          .notNull()
          .unique()
          .references(
            () =>
              agents.id,
            {
              onDelete:
                "restrict",
            },
          ),
      layer:
        integer(
          "layer",
        ).notNull(),
      executionOrder:
        integer(
          "execution_order",
        ).notNull(),
      ...timestamps,
    },
    (table) => [
      unique(
        "team_members_team_department_unique",
      ).on(
        table.teamId,
        table.departmentId,
      ),
      unique(
        "team_members_team_layer_execution_order_unique",
      ).on(
        table.teamId,
        table.layer,
        table.executionOrder,
      ),
      check(
        "team_members_layer_check",
        sql`${table.layer} >= 1`,
      ),
      check(
        "team_members_execution_order_check",
        sql`${table.executionOrder} >= 1`,
      ),
      /**
       * Guarantees a Team member's stored Department always matches its
       * selected Agent's Department without duplicating this invariant in
       * application code.
       */
      foreignKey({
        name:
          "team_members_agent_department_fk",
        columns: [
          table.agentId,
          table.departmentId,
        ],
        foreignColumns: [
          agents.id,
          agents.departmentId,
        ],
      }),
    ],
  );

/**
 * Team-owned outcome routing. Source and target reference `team_members`
 * rows rather than Agent IDs directly, so routing survives Agent identity
 * while remaining scoped to one Team's composition.
 */
export const teamMemberRoutes =
  pgTable(
    "team_member_routes",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      sourceTeamMemberId:
        uuid(
          "source_team_member_id",
        )
          .notNull()
          .references(
            () =>
              teamMembers.id,
            {
              onDelete:
                "cascade",
            },
          ),
      outcome:
        agentRouteOutcomeEnum(
          "outcome",
        ).notNull(),
      targetTeamMemberId:
        uuid(
          "target_team_member_id",
        ).references(
          () =>
            teamMembers.id,
          {
            onDelete:
              "cascade",
          },
        ),
      terminalAction:
        terminalActionEnum(
          "terminal_action",
        ),
      enabled:
        boolean(
          "enabled",
        )
          .notNull()
          .default(true),
      ...timestamps,
    },
    (table) => [
      unique(
        "team_member_routes_source_outcome_unique",
      ).on(
        table.sourceTeamMemberId,
        table.outcome,
      ),
      check(
        "team_member_routes_destination_check",
        sql`(${table.targetTeamMemberId} is null) <> (${table.terminalAction} is null)`,
      ),
    ],
  );

export const runs =
  pgTable(
    "runs",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      taskId:
        uuid(
          "task_id",
        ),
      teamId:
        uuid(
          "team_id",
        )
          .notNull()
          .default(
            RESOLUTION_TEAM_ID,
          )
          .references(
            () =>
              teams.id,
            {
              onDelete:
                "restrict",
            },
          ),
      projectPath:
        text(
          "project_path",
        ).notNull(),
      status:
        runStatusEnum(
          "status",
        )
          .notNull()
          .default(
            "pending",
          ),
      workflowSnapshot:
        jsonb(
          "workflow_snapshot",
        ),
      currentAgentId:
        uuid(
          "current_agent_id",
        ),
      executionCount:
        integer(
          "execution_count",
        )
          .notNull()
          .default(0),
      terminalReason:
        text(
          "terminal_reason",
        ),
      ...timestamps,
    },
  );

export const tasks =
  pgTable(
    "tasks",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      teamId:
        uuid(
          "team_id",
        )
          .notNull()
          .default(
            RESOLUTION_TEAM_ID,
          )
          .references(
            () =>
              teams.id,
            {
              onDelete:
                "restrict",
            },
          ),
      projectPath:
        text(
          "project_path",
        ).notNull(),
      title:
        text(
          "title",
        ).notNull(),
      instruction:
        text(
          "instruction",
        ).notNull(),
      status:
        runStatusEnum(
          "status",
        )
          .notNull()
          .default(
            "pending",
          ),
      source:
        taskSourceEnum(
          "source",
        )
          .notNull()
          .default(
            "manual",
          ),
      externalId:
        text(
          "external_id",
        ),
      externalUrl:
        text(
          "external_url",
        ),
      priority:
        integer(
          "priority",
        )
          .notNull()
          .default(0),
      ...timestamps,
    },
    (table) => [
      unique(
        "tasks_source_external_id_unique",
      ).on(
        table.source,
        table.externalId,
      ),
    ],
  );

export const projectDocuments =
  pgTable(
    "project_documents",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      teamId:
        uuid(
          "team_id",
        )
          .notNull()
          .references(
            () =>
              teams.id,
            {
              onDelete:
                "restrict",
            },
          ),
      projectPath:
        text(
          "project_path",
        ).notNull(),
      fileName:
        text(
          "file_name",
        ).notNull(),
      extension:
        text(
          "extension",
        ).notNull(),
      mediaType:
        text(
          "media_type",
        ).notNull(),
      content:
        text(
          "content",
        ).notNull(),
      contentHash:
        text(
          "content_hash",
        ).notNull(),
      contentBytes:
        integer(
          "content_bytes",
        ).notNull(),
      ...timestamps,
    },
    (table) => [
      index(
        "project_documents_team_id_project_path_idx",
      ).on(
        table.teamId,
        table.projectPath,
      ),
      check(
        "project_documents_file_type_check",
        sql`(
          (${table.extension} = '.md' and ${table.mediaType} = 'text/markdown')
          or
          (${table.extension} = '.txt' and ${table.mediaType} = 'text/plain')
        )`,
      ),
      check(
        "project_documents_content_hash_check",
        sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`,
      ),
      check(
        "project_documents_content_bytes_check",
        sql`${table.contentBytes} > 0`,
      ),
    ],
  );

export const projectDocumentChunks =
  pgTable(
    "project_document_chunks",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      projectDocumentId:
        uuid(
          "project_document_id",
        )
          .notNull()
          .references(
            () =>
              projectDocuments.id,
            {
              onDelete:
                "cascade",
            },
          ),
      sequence:
        integer(
          "sequence",
        ).notNull(),
      startOffset:
        integer(
          "start_offset",
        ).notNull(),
      endOffset:
        integer(
          "end_offset",
        ).notNull(),
      content:
        text(
          "content",
        ).notNull(),
      contentHash:
        text(
          "content_hash",
        ).notNull(),
      createdAt:
        timestamp(
          "created_at",
          {
            withTimezone:
              true,
          },
        )
          .notNull()
          .defaultNow(),
    },
    (table) => [
      unique(
        "project_document_chunks_document_sequence_unique",
      ).on(
        table.projectDocumentId,
        table.sequence,
      ),
      check(
        "project_document_chunks_sequence_check",
        sql`${table.sequence} >= 0`,
      ),
      check(
        "project_document_chunks_start_offset_check",
        sql`${table.startOffset} >= 0`,
      ),
      check(
        "project_document_chunks_end_offset_check",
        sql`${table.endOffset} > ${table.startOffset}`,
      ),
      check(
        "project_document_chunks_content_hash_check",
        sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`,
      ),
    ],
  );

export const taskDocuments =
  pgTable(
    "task_documents",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      taskId:
        uuid(
          "task_id",
        )
          .notNull()
          .references(
            () =>
              tasks.id,
            {
              onDelete:
                "cascade",
            },
          ),
      projectDocumentId:
        uuid(
          "project_document_id",
        )
          .notNull()
          .references(
            () =>
              projectDocuments.id,
            {
              onDelete:
                "restrict",
            },
          ),
      createdAt:
        timestamp(
          "created_at",
          {
            withTimezone:
              true,
          },
        )
          .notNull()
          .defaultNow(),
    },
    (table) => [
      unique(
        "task_documents_task_document_unique",
      ).on(
        table.taskId,
        table.projectDocumentId,
      ),
    ],
  );

export const agentExecutions =
  pgTable(
    "agent_executions",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      runId:
        uuid(
          "run_id",
        )
          .notNull()
          .references(
            () =>
              runs.id,
          ),
      agentId:
        uuid(
          "agent_id",
        ).references(
          () =>
            agents.id,
          {
            onDelete:
              "set null",
          },
        ),
      agentName:
        text(
          "agent_name",
        ).notNull(),
      agentRole:
        text(
          "agent_role",
        ).notNull(),
      layer:
        integer(
          "layer",
        ).notNull(),
      executionOrder:
        integer(
          "execution_order",
        ).notNull(),
      harness:
        harnessEnum(
          "harness",
        ).notNull(),
      model:
        text(
          "model",
        ).notNull(),
      reasoning:
        text(
          "reasoning",
        ).notNull(),
      status:
        agentExecutionStatusEnum(
          "status",
        )
          .notNull()
          .default(
            "pending",
          ),
      pid:
        integer(
          "pid",
        ),
      startedAt:
        timestamp(
          "started_at",
          {
            withTimezone:
              true,
          },
        ),
      completedAt:
        timestamp(
          "completed_at",
          {
            withTimezone:
              true,
          },
        ),
      exitCode:
        integer(
          "exit_code",
        ),
      resultStatus:
        agentResultStatusEnum(
          "result_status",
        ),
      resultPayload:
        jsonb(
          "result_payload",
        ),
      tokenUsage:
        jsonb(
          "token_usage",
        ),
      contextUsage:
        jsonb(
          "context_usage",
        ),
      commitHash:
        text(
          "commit_hash",
        ),
      failureReason:
        text(
          "failure_reason",
        ),
      repairAttempted:
        boolean(
          "repair_attempted",
        )
          .notNull()
          .default(false),
      ...timestamps,
    },
    (table) => [
      index(
        "agent_executions_run_id_idx",
      ).on(
        table.runId,
      ),
      index(
        "agent_executions_agent_id_idx",
      ).on(
        table.agentId,
      ),
    ],
  );

export const terminalChunks =
  pgTable(
    "terminal_chunks",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      agentExecutionId:
        uuid(
          "agent_execution_id",
        )
          .notNull()
          .references(
            () =>
              agentExecutions.id,
          ),
      sequence:
        integer(
          "sequence",
        ).notNull(),
      data:
        text(
          "data",
        ).notNull(),
      createdAt:
        timestamp(
          "created_at",
          {
            withTimezone:
              true,
          },
        )
          .notNull()
          .defaultNow(),
    },
    (table) => [
      unique(
        "terminal_chunks_execution_sequence_unique",
      ).on(
        table.agentExecutionId,
        table.sequence,
      ),
    ],
  );

export const orchestratorSettings =
  pgTable(
    "orchestrator_settings",
    {
      id:
        integer(
          "id",
        )
          .primaryKey()
          .default(1),
      harness:
        harnessEnum(
          "harness",
        )
          .notNull()
          .default(
            "codex",
          ),
      model:
        text(
          "model",
        )
          .notNull()
          .default(
            "default",
          ),
      reasoning:
        text(
          "reasoning",
        )
          .notNull()
          .default(
            "low",
          ),
      systemPrompt:
        text(
          "system_prompt",
        )
          .notNull()
          .default(
            "You supervise engineering workflows. Use only supplied state and be concise.",
          ),
      ...timestamps,
    },
    (table) => [
      check(
        "orchestrator_settings_singleton_check",
        sql`${table.id} = 1`,
      ),
    ],
  );

export const systemSettings =
  pgTable(
    "system_settings",
    {
      id:
        integer(
          "id",
        )
          .primaryKey()
          .default(1),
      autoModeEnabled:
        boolean(
          "auto_mode_enabled",
        )
          .notNull()
          .default(false),
      ...timestamps,
    },
    (table) => [
      check(
        "system_settings_singleton_check",
        sql`${table.id} = 1`,
      ),
    ],
  );

export const conversations =
  pgTable(
    "conversations",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      teamId:
        uuid(
          "team_id",
        )
          .notNull()
          .default(
            RESOLUTION_TEAM_ID,
          )
          .references(
            () =>
              teams.id,
            {
              onDelete:
                "restrict",
            },
          ),
      projectPath:
        text(
          "project_path",
        ).notNull(),
      taskId:
        uuid(
          "task_id",
        ),
      runId:
        uuid(
          "run_id",
        ),
      ...timestamps,
    },
  );

export const conversationMessages =
  pgTable(
    "conversation_messages",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      conversationId:
        uuid(
          "conversation_id",
        )
          .notNull()
          .references(
            () =>
              conversations.id,
          ),
      role:
        text(
          "role",
        ).notNull(),
      content:
        text(
          "content",
        ).notNull(),
      createdAt:
        timestamp(
          "created_at",
          {
            withTimezone:
              true,
          },
        )
          .notNull()
          .defaultNow(),
    },
    (table) => [
      check(
        "conversation_messages_role_check",
        sql`${table.role} in ('user', 'assistant')`,
      ),
    ],
  );

export const conversationMessageDocuments =
  pgTable(
    "conversation_message_documents",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      conversationMessageId:
        uuid(
          "conversation_message_id",
        )
          .notNull()
          .references(
            () =>
              conversationMessages.id,
            {
              onDelete:
                "cascade",
            },
          ),
      projectDocumentId:
        uuid(
          "project_document_id",
        )
          .notNull()
          .references(
            () =>
              projectDocuments.id,
            {
              onDelete:
                "restrict",
            },
          ),
      createdAt:
        timestamp(
          "created_at",
          {
            withTimezone:
              true,
          },
        )
          .notNull()
          .defaultNow(),
    },
    (table) => [
      unique(
        "conversation_message_documents_message_document_unique",
      ).on(
        table.conversationMessageId,
        table.projectDocumentId,
      ),
    ],
  );

export const domainEvents =
  pgTable(
    "domain_events",
    {
      id:
        uuid("id")
          .primaryKey()
          .defaultRandom(),
      type:
        text(
          "type",
        ).notNull(),
      projectPath:
        text(
          "project_path",
        ).notNull(),
      taskId:
        uuid(
          "task_id",
        ),
      runId:
        uuid(
          "run_id",
        ),
      agentExecutionId:
        uuid(
          "agent_execution_id",
        ),
      data:
        jsonb(
          "data",
        )
          .notNull()
          .default({}),
      createdAt:
        timestamp(
          "created_at",
          {
            withTimezone:
              true,
          },
        )
          .notNull()
          .defaultNow(),
    },
    (table) => [
      index(
        "domain_events_run_id_created_at_idx",
      ).on(
        table.runId,
        table.createdAt,
      ),
    ],
  );
