import {
  sql,
} from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
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
      ...timestamps,
    },
  );

/**
 * Persisted Knowledge Category configuration. `vaultRootPath` is a normalized
 * vault-relative directory validated at the DTO boundary; the canonical Markdown
 * files themselves remain owned by the Git-backed Obsidian vault, not PostgreSQL.
 */
export const knowledgeCategories =
  pgTable(
    "knowledge_categories",
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
        text("description")
          .notNull()
          .default(""),
      vaultRootPath:
        text("vault_root_path")
          .notNull(),
      enabled:
        boolean("enabled")
          .notNull()
          .default(true),
      specialistAgentId: uuid("specialist_agent_id").references(() => agents.id, { onDelete: "restrict" }),
      ingestionSkillId: uuid("ingestion_skill_id").references(() => skills.id, { onDelete: "restrict" }),
      ...timestamps,
    },
  );

export const knowledgeIngestionBatchStatusEnum = pgEnum("knowledge_ingestion_batch_status", [
  "uploaded",
  "analyzing",
  "review_ready",
  "submitting",
  "committed",
  "failed",
]);

export const knowledgeProposalOperationEnum = pgEnum("knowledge_proposal_operation", [
  "CREATE",
  "UPDATE",
  "MERGE",
  "CONFLICT",
  "NO_CHANGE",
]);

export const knowledgeProposalConfidenceLevelEnum = pgEnum("knowledge_proposal_confidence_level", [
  "low",
  "medium",
  "high",
]);

export const knowledgeProposalReviewStatusEnum = pgEnum("knowledge_proposal_review_status", [
  "pending",
  "approved",
  "denied",
  "needs_changes",
]);

/** Generic reusable capabilities. Their meaning is configuration, never runtime role branches. */
export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  tags: jsonb("tags").notNull().default([]),
  domains: jsonb("domains").notNull().default([]),
  /** True only when the canonical `SKILL.md` currently has loadable runtime instructions. */
  hasInstructions: boolean("has_instructions").notNull().default(false),
  ...timestamps,
});

/** Many-to-many Agent capability assignments. Canonical assignment lives in `agent.yaml.skills`; this is its projection. */
export const agentSkills = pgTable("agent_skills", {
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  skillId: uuid("skill_id").notNull().references(() => skills.id, { onDelete: "restrict" }),
  ...timestamps,
}, (table) => [unique("agent_skills_agent_id_skill_id_unique").on(table.agentId, table.skillId), index("agent_skills_skill_id_idx").on(table.skillId)]);

/**
 * Content-addressed Skill instruction bodies. Deduplicated by SHA-256 so many
 * Runs/Agents freezing the same unchanged `SKILL.md` share one row.
 */
export const skillVersions = pgTable("skill_versions", {
  contentHash: text("content_hash").primaryKey(),
  content: text("content").notNull(),
  ...timestamps,
}, (table) => [check("skill_versions_content_hash_check", sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`)]);

/**
 * One Run's frozen Skill assignment for one Agent, captured at Run creation
 * from the canonical `.orc/skills` tree so later edits to a Skill (or its
 * Agent assignment) never alter an in-flight or historical Run. `search_skills`/
 * `load_skill` (roadmap Vertical Spec 3) read only from this table, scoped to
 * the executing Run + Agent -- never the live configuration graph.
 */
export const runAgentSkills = pgTable("run_agent_skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "restrict" }),
  skillSlug: text("skill_slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  tags: jsonb("tags").notNull().default([]),
  domains: jsonb("domains").notNull().default([]),
  contentHash: text("content_hash").notNull().references(() => skillVersions.contentHash, { onDelete: "restrict" }),
  ...timestamps,
}, (table) => [
  unique("run_agent_skills_run_id_agent_id_skill_slug_unique").on(table.runId, table.agentId, table.skillSlug),
  index("run_agent_skills_run_id_agent_id_idx").on(table.runId, table.agentId),
]);

/**
 * Department-declared primary Knowledge Categories. Recommendation/discovery metadata
 * only — never an access-control boundary and never wired into automatic Run context.
 */
export const departmentKnowledgeCategories = pgTable("department_knowledge_categories", {
  departmentId: uuid("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
  knowledgeCategoryId: uuid("knowledge_category_id").notNull().references(() => knowledgeCategories.id, { onDelete: "restrict" }),
  isPrimary: boolean("is_primary").notNull().default(true),
  ...timestamps,
}, (table) => [
  unique("department_knowledge_categories_department_id_knowledge_category_id_unique").on(
    table.departmentId,
    table.knowledgeCategoryId,
  ),
  index("department_knowledge_categories_knowledge_category_id_idx").on(table.knowledgeCategoryId),
]);

/**
 * One uploaded knowledge source produces one reviewable ingestion batch. Specialist,
 * skill, source hash, and base vault commit are snapshotted immutably once analysis
 * starts so later publishing (Slice 5) can detect a stale or concurrently edited vault.
 */
export const knowledgeIngestionBatches = pgTable("knowledge_ingestion_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  knowledgeCategoryId: uuid("knowledge_category_id").notNull().references(() => knowledgeCategories.id, { onDelete: "restrict" }),
  specialistAgentId: uuid("specialist_agent_id").references(() => agents.id, { onDelete: "restrict" }),
  ingestionSkillId: uuid("ingestion_skill_id").references(() => skills.id, { onDelete: "restrict" }),
  sourceFileName: text("source_file_name").notNull(),
  sourceMediaType: text("source_media_type").notNull(),
  sourceContent: text("source_content").notNull(),
  sourceContentHash: text("source_content_hash").notNull(),
  baseVaultCommitSha: text("base_vault_commit_sha"),
  status: knowledgeIngestionBatchStatusEnum("status").notNull().default("uploaded"),
  analysisExecutionId: uuid("analysis_execution_id").references(() => agentExecutions.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  committedAt: timestamp("committed_at", { withTimezone: true }),
  vaultCommitSha: text("vault_commit_sha"),
  failureReason: text("failure_reason"),
  ...timestamps,
}, (table) => [
  index("knowledge_ingestion_batches_category_id_idx").on(table.knowledgeCategoryId),
  check(
    "knowledge_ingestion_batches_source_content_hash_check",
    sql`${table.sourceContentHash} ~ '^[0-9a-f]{64}$'`,
  ),
  check(
    "knowledge_ingestion_batches_source_media_type_check",
    sql`${table.sourceMediaType} = 'text/markdown'`,
  ),
]);

/** One specialist-authored, independently reviewable recommendation belonging to one ingestion batch. */
export const knowledgeProposals = pgTable("knowledge_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id").notNull().references(() => knowledgeIngestionBatches.id, { onDelete: "cascade" }),
  operation: knowledgeProposalOperationEnum("operation").notNull(),
  targetPath: text("target_path").notNull(),
  targetHeading: text("target_heading"),
  confidenceScore: doublePrecision("confidence_score").notNull(),
  confidenceLevel: knowledgeProposalConfidenceLevelEnum("confidence_level").notNull(),
  title: text("title").notNull(),
  rationale: text("rationale").notNull(),
  evidence: jsonb("evidence").notNull().default([]),
  existingContentHash: text("existing_content_hash"),
  proposedContent: text("proposed_content").notNull(),
  proposedPatch: text("proposed_patch"),
  conflictDetails: text("conflict_details"),
  reviewStatus: knowledgeProposalReviewStatusEnum("review_status").notNull().default("pending"),
  reviewerNote: text("reviewer_note"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  index("knowledge_proposals_batch_id_idx").on(table.batchId),
  check(
    "knowledge_proposals_existing_content_hash_check",
    sql`${table.existingContentHash} is null or ${table.existingContentHash} ~ '^[0-9a-f]{64}$'`,
  ),
  check(
    "knowledge_proposals_confidence_score_check",
    sql`${table.confidenceScore} >= 0 and ${table.confidenceScore} <= 1`,
  ),
]);

/**
 * Project existence remains filesystem-backed. This table stores only optional
 * configuration for a currently discoverable canonical project path.
 */
export const projectTeamAssignments =
  pgTable(
    "project_team_assignments",
    {
      projectPath: text("project_path").primaryKey(),
      resolutionTeamId: uuid("resolution_team_id")
        .references(() => teams.id, { onDelete: "restrict" }),
      developmentTeamId: uuid("development_team_id")
        .references(() => teams.id, { onDelete: "restrict" }),
      notionDataSourceId: text("notion_data_source_id"),
      autoModeEnabled: boolean("auto_mode_enabled").notNull().default(false),
      autoModeTeamId: uuid("auto_mode_team_id").references(() => teams.id, { onDelete: "restrict" }),
      ...timestamps,
    },
    (table) => [
      unique("project_team_assignments_notion_data_source_id_unique").on(
        table.notionDataSourceId,
      ),
      index("project_team_assignments_resolution_team_id_idx").on(table.resolutionTeamId),
      index("project_team_assignments_development_team_id_idx").on(table.developmentTeamId),
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
      enabled:
        boolean(
          "enabled",
        )
          .notNull()
          .default(true),
      harnessOverride: harnessEnum("harness_override"),
      canWriteOverride: boolean("can_write_override"),
      canRunCommandsOverride: boolean("can_run_commands_override"),
      sandboxModeOverride: sandboxModeEnum("sandbox_mode_override"),
      canCommitOverride: boolean("can_commit_override"),
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
      /**
       * Set when an Agent is deleted but Run/workflow/knowledge history still
       * references it: the row stays for that history, hidden from
       * configuration views. Syncing a canonical file with the same slug
       * clears it again.
       */
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      ...timestamps,
    },
    (table) => [
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
    ],
  );

/**
 * Authoritative Team composition and workflow-placement table: the sole
 * source of Team topology (layer/execution order) and, via `agentId`, of an
 * Agent's current Team assignment.
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

export const workflowRevisionStateEnum =
  pgEnum(
    "workflow_revision_state",
    [
      "draft",
      "published",
    ],
  );

export const workflowNodeKindEnum =
  pgEnum(
    "workflow_node_kind",
    [
      "start",
      "agent",
      "terminal",
    ],
  );

/**
 * One mutable Draft revision plus zero or more immutable Published revisions
 * per Team. Team membership stays in `team_members`; this table (with
 * `workflow_nodes`/`workflow_edges`) is the sole source of workflow
 * topology. Additive only in this slice — no runtime code reads these
 * tables yet.
 */
export const workflowRevisions = pgTable("workflow_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
  state: workflowRevisionStateEnum("state").notNull(),
  version: integer("version"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  index("workflow_revisions_team_id_idx").on(table.teamId),
  uniqueIndex("workflow_revisions_team_draft_unique")
    .on(table.teamId)
    .where(sql`${table.state} = 'draft'`),
  unique("workflow_revisions_team_version_unique").on(table.teamId, table.version),
  check(
    "workflow_revisions_draft_fields_check",
    sql`${table.state} <> 'draft' or (${table.version} is null and ${table.publishedAt} is null)`,
  ),
  check(
    "workflow_revisions_published_fields_check",
    sql`${table.state} <> 'published' or (${table.version} >= 1 and ${table.publishedAt} is not null)`,
  ),
]);

/**
 * `unique(id, revisionId)` exists solely so `workflow_edges` can declare a
 * composite foreign key that enforces an edge's endpoints belong to the
 * same revision as the edge itself, at the database layer.
 */
export const workflowNodes = pgTable("workflow_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  revisionId: uuid("revision_id").notNull().references(() => workflowRevisions.id, { onDelete: "cascade" }),
  kind: workflowNodeKindEnum("kind").notNull(),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "restrict" }),
  terminalAction: terminalActionEnum("terminal_action"),
  positionX: integer("position_x").notNull(),
  positionY: integer("position_y").notNull(),
  ...timestamps,
}, (table) => [
  index("workflow_nodes_revision_id_idx").on(table.revisionId),
  unique("workflow_nodes_id_revision_id_unique").on(table.id, table.revisionId),
  uniqueIndex("workflow_nodes_revision_agent_unique")
    .on(table.revisionId, table.agentId)
    .where(sql`${table.agentId} is not null`),
  uniqueIndex("workflow_nodes_revision_terminal_action_unique")
    .on(table.revisionId, table.terminalAction)
    .where(sql`${table.terminalAction} is not null`),
  check(
    "workflow_nodes_kind_fields_check",
    sql`(${table.kind} = 'start' and ${table.agentId} is null and ${table.terminalAction} is null)
      or (${table.kind} = 'agent' and ${table.agentId} is not null and ${table.terminalAction} is null)
      or (${table.kind} = 'terminal' and ${table.agentId} is null and ${table.terminalAction} is not null)`,
  ),
]);

/**
 * Start edges carry `outcome = null`; Agent outcome edges require one of the
 * five fixed outcomes. Composite foreign keys against
 * `workflow_nodes(id, revision_id)` guarantee an edge can never reference a
 * node belonging to a different revision than the edge itself.
 */
export const workflowEdges = pgTable("workflow_edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  revisionId: uuid("revision_id").notNull().references(() => workflowRevisions.id, { onDelete: "cascade" }),
  sourceNodeId: uuid("source_node_id").notNull(),
  targetNodeId: uuid("target_node_id").notNull(),
  outcome: agentRouteOutcomeEnum("outcome"),
  ...timestamps,
}, (table) => [
  index("workflow_edges_revision_id_idx").on(table.revisionId),
  index("workflow_edges_source_node_id_idx").on(table.sourceNodeId),
  uniqueIndex("workflow_edges_source_outcome_unique")
    .on(table.sourceNodeId, table.outcome)
    .where(sql`${table.outcome} is not null`),
  uniqueIndex("workflow_edges_source_start_unique")
    .on(table.sourceNodeId)
    .where(sql`${table.outcome} is null`),
  foreignKey({
    name: "workflow_edges_source_node_revision_fk",
    columns: [table.sourceNodeId, table.revisionId],
    foreignColumns: [workflowNodes.id, workflowNodes.revisionId],
  }).onDelete("cascade"),
  foreignKey({
    name: "workflow_edges_target_node_revision_fk",
    columns: [table.targetNodeId, table.revisionId],
    foreignColumns: [workflowNodes.id, workflowNodes.revisionId],
  }).onDelete("cascade"),
]);

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
      /**
       * Nullable: only graph-based (Snapshot V2) Runs set these. The Run's
       * own immutable `workflowSnapshot` remains authoritative even after
       * the referenced revision is superseded by a later publish -- no
       * live join back to `workflow_revisions` is required or safe here.
       */
      workflowRevisionId:
        uuid(
          "workflow_revision_id",
        ).references(
          () =>
            workflowRevisions.id,
          {
            onDelete:
              "restrict",
          },
        ),
      currentWorkflowNodeId:
        uuid(
          "current_workflow_node_id",
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
