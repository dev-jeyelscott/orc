import {
  Client,
} from "@modelcontextprotocol/client";

import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/client/stdio";

import {
  MAX_KNOWLEDGE_EXCERPT_CHARS,
  MAX_KNOWLEDGE_METADATA_VALUE_CHARS,
  MAX_KNOWLEDGE_METADATA_VALUES,
  MAX_KNOWLEDGE_SEARCH_EVIDENCE_CHARS,
  MAX_KNOWLEDGE_SEARCH_EVIDENCE_ITEMS,
  MAX_KNOWLEDGE_SEARCH_RESULTS,
  MAX_KNOWLEDGE_TITLE_CHARS,
  knowledgeSearchEnvelopeSchema,
  knowledgeSearchRequestSchema,
  knowledgeSectionEnvelopeSchema,
  knowledgeSectionRequestSchema,
  type KnowledgeAuthority,
  type KnowledgeSearchEnvelope,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResult,
  type KnowledgeSectionEnvelope,
  type KnowledgeSectionRequest,
} from "@orc/shared";

import {
  z,
} from "zod";

import {
  env,
} from "../config/env.js";

import {
  logger,
} from "../logger.js";

const KNOWLEDGE_MCP_TIMEOUT_MS =
  5_000;

type AllowedKnowledgeMcpTool =
  | "search_knowledge"
  | "get_note_section";

type KnowledgeMcpCallOutcome =
  | {
      status:
        "ok";
      structuredContent:
        Record<
          string,
          unknown
        >;
    }
  | {
      status:
        "knowledge_unavailable";
    }
  | {
      status:
        "retrieval_error";
    };

const projectNameSchema =
  z
    .string()
    .trim()
    .min(1)
    .max(240)
    .refine(
      (
        value,
      ) =>
        !value.includes("/") &&
        !value.includes("\\") &&
        value !== "." &&
        value !== "..",
      "Project name is not valid for knowledge scope",
    );

const rawAuthoritySchema =
  z
    .object({
      tier:
        z.enum([
          "tier1",
          "tier2",
          "tier3",
        ]),
      class:
        z.enum([
          "curated",
          "historical",
          "source",
          "excluded",
        ]),
      access:
        z.enum([
          "default-searchable",
          "explicit-searchable",
          "source-searchable",
          "exact-read-only",
        ]),
    })
    .strict();

const rawSearchResultSchema =
  z
    .object({
      path:
        z.string(),
      title:
        z.string(),
      authority:
        rawAuthoritySchema,
      score:
        z.number(),
      metadata:
        z
          .object({
            project:
              z.array(
                z.string(),
              ),
            tags:
              z.array(
                z.string(),
              ),
            type:
              z.array(
                z.string(),
              ),
            status:
              z.array(
                z.string(),
              ),
          })
          .strict(),
      evidence:
        z.array(
          z
            .object({
              kind:
                z.enum([
                  "title",
                  "heading",
                  "alias",
                  "tag",
                  "frontmatter",
                  "body",
                  "path",
                ]),
              text:
                z.string(),
            })
            .strict(),
        ),
    })
    .strict();

const rawSearchPayloadSchema =
  z
    .object({
      results:
        z.array(
          rawSearchResultSchema,
        ),
    })
    .strict();

const rawSectionPayloadSchema =
  z
    .object({
      path:
        z.string(),
      title:
        z.string(),
      authority:
        rawAuthoritySchema,
      heading:
        z
          .string()
          .nullable(),
      content:
        z.string(),
      truncated:
        z.boolean(),
      charsReturned:
        z
          .number()
          .int()
          .nonnegative(),
      bytesReturned:
        z
          .number()
          .int()
          .nonnegative(),
    })
    .strict();

let activeClient:
  Client | null =
    null;

let connectionPromise:
  Promise<Client> | null =
    null;

/**
 * Builds the child environment from the MCP client's safe defaults plus only the
 * KNOWLEDGE_VAULT_* values owned by the standalone knowledge service.
 */
function createKnowledgeMcpEnvironment():
  Record<string, string> {
  const environment = {
    ...getDefaultEnvironment(),
  };

  for (
    const [
      name,
      value,
    ] of
    Object.entries(
      process.env,
    )
  ) {
    if (
      name.startsWith(
        "KNOWLEDGE_VAULT_",
      ) &&
      typeof value ===
        "string"
    ) {
      environment[
        name
      ] =
        value;
    }
  }

  return environment;
}

/**
 * Adds a hard consumer-side timeout around MCP connection and tool promises.
 */
function withKnowledgeTimeout<T>(
  operation:
    Promise<T>,
): Promise<T> {
  return new Promise<T>(
    (
      resolve,
      reject,
    ) => {
      const timeout =
        setTimeout(
          () => {
            reject(
              new Error(
                "Knowledge MCP request timed out",
              ),
            );
          },
          KNOWLEDGE_MCP_TIMEOUT_MS,
        );

      void operation.then(
        (
          value,
        ) => {
          clearTimeout(
            timeout,
          );
          resolve(
            value,
          );
        },
        (
          error,
        ) => {
          clearTimeout(
            timeout,
          );
          reject(
            error,
          );
        },
      );
    },
  );
}

/**
 * Closes the currently active client and clears it before a future lazy reconnect.
 */
async function resetActiveClient():
  Promise<void> {
  const client =
    activeClient;

  activeClient =
    null;

  if (
    !client
  ) {
    return;
  }

  try {
    await client.close();
  } catch (
    error
  ) {
    logger.debug(
      {
        error,
      },
      "Knowledge MCP client close failed",
    );
  }
}

/**
 * Lazily connects the one optional stdio MCP client without making server startup
 * depend on knowledge availability.
 */
async function getKnowledgeMcpClient():
  Promise<Client> {
  if (
    activeClient
  ) {
    return activeClient;
  }

  if (
    connectionPromise
  ) {
    return connectionPromise;
  }

  const command =
    env
      .KNOWLEDGE_MCP_COMMAND;

  if (
    !command
  ) {
    throw new Error(
      "Knowledge MCP is not configured",
    );
  }

  const attempt =
    (
      async () => {
        const transport =
          new StdioClientTransport(
            {
              command,
              args: [],
              env:
                createKnowledgeMcpEnvironment(),
              stderr:
                "inherit",
            },
          );

        const client =
          new Client({
            name:
              "orc-knowledge-consumer",
            version:
              "1.0.0",
          });

        try {
          await withKnowledgeTimeout(
            client.connect(
              transport,
            ),
          );
        } catch (
          error
        ) {
          try {
            await client.close();
          } catch {
            // The transport may never have reached a state that can be closed cleanly.
          }

          throw error;
        }

        activeClient =
          client;

        return client;
      }
    )();

  connectionPromise =
    attempt;

  try {
    return await attempt;
  } finally {
    if (
      connectionPromise ===
      attempt
    ) {
      connectionPromise =
        null;
    }
  }
}

/**
 * Invokes only the two approved read-only MCP tools and normalizes transport and
 * retrieval failures before they reach the orchestrator.
 */
async function callKnowledgeMcpTool(
  name:
    AllowedKnowledgeMcpTool,
  args:
    Record<
      string,
      unknown
    >,
): Promise<KnowledgeMcpCallOutcome> {
  let client:
    Client;

  try {
    client =
      await getKnowledgeMcpClient();
  } catch (
    error
  ) {
    logger.debug(
      {
        error,
      },
      "Knowledge MCP unavailable",
    );

    return {
      status:
        "knowledge_unavailable",
    };
  }

  try {
    const result =
      await withKnowledgeTimeout(
        client.callTool({
          name,
          arguments:
            args,
        }),
      );

    if (
      result.isError ===
      true
    ) {
      return {
        status:
          "retrieval_error",
      };
    }

    if (
      !result
        .structuredContent ||
      typeof result
        .structuredContent !==
        "object"
    ) {
      return {
        status:
          "retrieval_error",
      };
    }

    return {
      status:
        "ok",
      structuredContent:
        result
          .structuredContent as
          Record<
            string,
            unknown
          >,
    };
  } catch (
    error
  ) {
    logger.debug(
      {
        error,
      },
      "Knowledge MCP call failed",
    );

    await resetActiveClient();

    return {
      status:
        "knowledge_unavailable",
    };
  }
}

/**
 * Truncates one external string to the bounded consumer size required by ORC.
 */
function truncateText(
  value: string,
  maxChars: number,
): string {
  return value
    .slice(
      0,
      maxChars,
    )
    .trim();
}

/**
 * Presents a bounded list of compact metadata values from the external MCP result.
 */
function presentMetadataValues(
  values:
    string[],
): string[] {
  return values
    .slice(
      0,
      MAX_KNOWLEDGE_METADATA_VALUES,
    )
    .map(
      (
        value,
      ) =>
        truncateText(
          value,
          MAX_KNOWLEDGE_METADATA_VALUE_CHARS,
        ),
    )
    .filter(
      Boolean,
    );
}

/**
 * Normalizes a path only for ORC-side Project/wiki authorization comparisons.
 */
function normalizeScopePath(
  value: string,
): string {
  return value
    .replaceAll(
      "\\",
      "/",
    )
    .normalize(
      "NFKC",
    )
    .toLowerCase();
}

/**
 * Returns true only when a retrieved path is inside the current Project knowledge
 * namespace or the shared wiki namespace requested by the caller.
 */
function isAllowedKnowledgePath(
  projectName:
    string,
  area:
    "project"
    | "wiki",
  value:
    string,
): boolean {
  const normalized =
    normalizeScopePath(
      value,
    );

  if (
    area ===
    "wiki"
  ) {
    return (
      normalized ===
        "wiki" ||
      normalized.startsWith(
        "wiki/",
      )
    );
  }

  const projectPrefix =
    `projects/${normalizeScopePath(
      projectName,
    )}/`;

  return normalized.startsWith(
    projectPrefix,
  );
}

/**
 * Maps one raw standalone MCP search result into ORC's smaller typed envelope.
 */
function presentSearchResult(
  value:
    z.infer<
      typeof rawSearchResultSchema
    >,
): KnowledgeSearchResult {
  return {
    path:
      value.path,
    title:
      truncateText(
        value.title,
        MAX_KNOWLEDGE_TITLE_CHARS,
      ),
    authority:
      value.authority as
        KnowledgeAuthority,
    score:
      value.score,
    metadata: {
      project:
        presentMetadataValues(
          value.metadata
            .project,
        ),
      tags:
        presentMetadataValues(
          value.metadata
            .tags,
        ),
      type:
        presentMetadataValues(
          value.metadata
            .type,
        ),
      status:
        presentMetadataValues(
          value.metadata
            .status,
        ),
    },
    evidence:
      value.evidence
        .slice(
          0,
          MAX_KNOWLEDGE_SEARCH_EVIDENCE_ITEMS,
        )
        .map(
          (
            evidence,
          ) => ({
            kind:
              evidence.kind,
            text:
              truncateText(
                evidence.text,
                MAX_KNOWLEDGE_SEARCH_EVIDENCE_CHARS,
              ),
          }),
  };
}

/**
 * Returns the standard nonfatal search envelope when durable knowledge is unavailable.
 */
function unavailableSearchEnvelope():
  KnowledgeSearchEnvelope {
  return {
    source:
      "vault",
    kind:
      "durable_knowledge",
    runtimeAuthoritative:
      false,
    status:
      "knowledge_unavailable",
    results: [],
    message:
      "Durable knowledge is currently unavailable.",
  };
}

/**
 * Returns the standard bounded search error envelope for a valid MCP connection whose
 * retrieval response could not be used.
 */
function retrievalErrorSearchEnvelope():
  KnowledgeSearchEnvelope {
  return {
    source:
      "vault",
    kind:
      "durable_knowledge",
    runtimeAuthoritative:
      false,
    status:
      "retrieval_error",
    results: [],
    message:
      "Durable knowledge retrieval failed.",
  };
}

/**
 * Returns the standard nonfatal section envelope when durable knowledge is unavailable.
 */
function unavailableSectionEnvelope():
  KnowledgeSectionEnvelope {
  return {
    source:
      "vault",
    kind:
      "durable_knowledge",
    runtimeAuthoritative:
      false,
    status:
      "knowledge_unavailable",
    section:
      null,
    message:
      "Durable knowledge is currently unavailable.",
  };
}

/**
 * Returns the standard bounded section error envelope for an unusable retrieval response.
 */
function retrievalErrorSectionEnvelope():
  KnowledgeSectionEnvelope {
  return {
    source:
      "vault",
    kind:
      "durable_knowledge",
    runtimeAuthoritative:
      false,
    status:
      "retrieval_error",
    section:
      null,
    message:
      "Durable knowledge retrieval failed.",
  };
}

/**
 * Performs a narrow Project or wiki knowledge search while preserving the MCP's
 * default Tier 1 behavior unless the caller explicitly requests tier2.
 */
export async function searchKnowledge(
  input:
    KnowledgeSearchRequest & {
      projectName:
        string;
    },
): Promise<KnowledgeSearchEnvelope> {
  const projectName =
    projectNameSchema.parse(
      input.projectName,
    );

  const request =
    knowledgeSearchRequestSchema.parse({
      query:
        input.query,
      area:
        input.area,
      scope:
        input.scope,
      limit:
        input.limit,
    });

  const outcome =
    await callKnowledgeMcpTool(
      "search_knowledge",
      request.area ===
        "project"
        ? {
            query:
              request.query,
            project:
              projectName,
            scope:
              request.scope,
            limit:
              request.limit,
          }
        : {
            query:
              request.query,
            folder:
              "wiki",
            scope:
              request.scope,
            limit:
              request.limit,
          },
    );

  if (
    outcome.status ===
    "knowledge_unavailable"
  ) {
    return unavailableSearchEnvelope();
  }

  if (
    outcome.status ===
    "retrieval_error"
  ) {
    return retrievalErrorSearchEnvelope();
  }

  const parsed =
    rawSearchPayloadSchema.safeParse(
      outcome
        .structuredContent,
    );

  if (
    !parsed.success
  ) {
    return retrievalErrorSearchEnvelope();
  }

  const results =
    parsed.data.results
      .filter(
        (
          result,
        ) =>
          isAllowedKnowledgePath(
            projectName,
            request.area,
            result.path,
          ),
      )
      .slice(
        0,
        Math.min(
          request.limit,
          MAX_KNOWLEDGE_SEARCH_RESULTS,
        ),
      )
      .map(
        presentSearchResult,
      );

  const envelope = {
    source:
      "vault",
    kind:
      "durable_knowledge",
    runtimeAuthoritative:
      false,
    status:
      "ok",
    results,
  } as const;

  const validated =
    knowledgeSearchEnvelopeSchema.safeParse(
      envelope,
    );

  return validated.success
    ? validated.data
    : retrievalErrorSearchEnvelope();
}

/**
 * Reads one exact bounded Project/wiki section and returns it as server-owned durable
 * context that can later be selected for a Run.
 */
export async function getKnowledgeSection(
  input:
    KnowledgeSectionRequest & {
      projectName:
        string;
    },
): Promise<KnowledgeSectionEnvelope> {
  const projectName =
    projectNameSchema.parse(
      input.projectName,
    );

  const request =
    knowledgeSectionRequestSchema.parse({
      path:
        input.path,
      heading:
        input.heading,
      maxChars:
        input.maxChars,
    });

  const area =
    normalizeScopePath(
      request.path,
    ).startsWith(
      "wiki/",
    )
      ? "wiki"
      : "project";

  if (
    !isAllowedKnowledgePath(
      projectName,
      area,
      request.path,
    )
  ) {
    return retrievalErrorSectionEnvelope();
  }

  const outcome =
    await callKnowledgeMcpTool(
      "get_note_section",
      {
        path:
          request.path,
        ...(
          request.heading
            ? {
                heading:
                  request.heading,
              }
            : {}
        ),
        maxChars:
          request.maxChars,
      },
    );

  if (
    outcome.status ===
    "knowledge_unavailable"
  ) {
    return unavailableSectionEnvelope();
  }

  if (
    outcome.status ===
    "retrieval_error"
  ) {
    return retrievalErrorSectionEnvelope();
  }

  const parsed =
    rawSectionPayloadSchema.safeParse(
      outcome
        .structuredContent,
    );

  if (
    !parsed.success ||
    !isAllowedKnowledgePath(
      projectName,
      area,
      parsed.data.path,
    )
  ) {
    return retrievalErrorSectionEnvelope();
  }

  const excerpt =
    parsed.data.content
      .slice(
        0,
        Math.min(
          request.maxChars,
          MAX_KNOWLEDGE_EXCERPT_CHARS,
        ),
      );

  const envelope = {
    source:
      "vault",
    kind:
      "durable_knowledge",
    runtimeAuthoritative:
      false,
    status:
      "ok",
    section: {
      ref: {
        source:
          "vault",
        path:
          parsed.data.path,
        ...(
          parsed.data.heading
            ? {
                heading:
                  parsed.data.heading,
              }
            : {}
        ),
        ...(
          excerpt.trim()
            ? {
                excerpt,
              }
            : {}
        ),
      },
      title:
        truncateText(
          parsed.data.title,
          MAX_KNOWLEDGE_TITLE_CHARS,
        ),
      authority:
        parsed.data
          .authority,
      truncated:
        parsed.data
          .truncated ||
        parsed.data.content
          .length >
          excerpt.length,
      charsReturned:
        excerpt.length,
      bytesReturned:
        Buffer.byteLength(
          excerpt,
          "utf8",
        ),
    },
  } as const;

  const validated =
    knowledgeSectionEnvelopeSchema.safeParse(
      envelope,
    );

  return validated.success
    ? validated.data
    : retrievalErrorSectionEnvelope();
}

/**
 * Closes the optional lazy knowledge process during normal server shutdown.
 */
export async function closeKnowledgeMcpClient():
  Promise<void> {
  if (
    connectionPromise
  ) {
    try {
      await connectionPromise;
    } catch {
      // A failed in-flight connection already has no reusable client.
    }
  }

  await resetActiveClient();
}
