import path from "node:path";

import {
  APIErrorCode,
  Client,
  ClientErrorCode,
  isNotionClientError,
} from "@notionhq/client";
import type {
  Project,
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
import {
  listProjects,
} from "./project-discovery.js";

type QueryDataSource =
  Client["dataSources"]["query"];

type RetrievePageMarkdown =
  Client["pages"]["retrieveMarkdown"];

type UpdatePage =
  Client["pages"]["update"];

export type NotionTaskSourceClient = {
  dataSources: {
    query:
      QueryDataSource;
  };
  pages: {
    retrieveMarkdown:
      RetrievePageMarkdown;
    update:
      UpdatePage;
  };
};

export const notionTaskStatusSchema =
  z.enum([
    "In Progress",
    "Done",
    "Blocked",
    "Failed",
  ]);

export type NotionTaskStatus =
  z.infer<
    typeof notionTaskStatusSchema
  >;

export type NotionTaskCandidate = {
  source:
    "notion";
  externalId:
    string;
  externalUrl:
    string | null;
  title:
    string;
  instruction:
    string;
  priority:
    number;
  project:
    Project;
};

type ProjectResolver = (
  repositoryName: string,
) => Promise<
  Project | null
>;

type RetryLogger = {
  warn: (
    bindings:
      Record<
        string,
        unknown
      >,
    message:
      string,
  ) => void;
};

export type NotionRetryOptions = {
  maxAttempts?:
    number;
  baseDelayMs?:
    number;
  maxDelayMs?:
    number;
  sleep?: (
    delayMs: number,
  ) => Promise<void>;
  random?:
    () => number;
};

export type NotionTaskSourceAdapterOptions = {
  client:
    NotionTaskSourceClient;
  dataSourceId:
    string;
  resolveProject:
    ProjectResolver;
  retry?:
    NotionRetryOptions;
  logger?:
    RetryLogger;
};

const richTextFragmentSchema =
  z.object({
    plain_text:
      z.string(),
  }).passthrough();

const projectPropertySchema =
  z.union([
    z.object({
      type:
        z.literal(
          "select",
        ),
      select:
        z.object({
          name:
            z.string(),
        })
          .passthrough()
          .nullable(),
    }).passthrough(),
    z.object({
      type:
        z.literal(
          "rich_text",
        ),
      rich_text:
        z.array(
          richTextFragmentSchema,
        ),
    }).passthrough(),
  ]);

const readyPageSchema =
  z.object({
    object:
      z.literal(
        "page",
      ),
    id:
      z.string()
        .min(1),
    url:
      z.string()
        .url()
        .nullable()
        .optional(),
    properties:
      z.object({
        Title:
          z.object({
            type:
              z.literal(
                "title",
              ),
            title:
              z.array(
                richTextFragmentSchema,
              ),
          }).passthrough(),
        Status:
          z.object({
            type:
              z.literal(
                "status",
              ),
            status:
              z.object({
                name:
                  z.string(),
              })
                .passthrough()
                .nullable(),
          }).passthrough(),
        Priority:
          z.object({
            type:
              z.literal(
                "number",
              ),
            number:
              z.number()
                .nullable(),
          }).passthrough(),
        Project:
          projectPropertySchema,
      }).passthrough(),
  }).passthrough();

const markdownResponseSchema =
  z.object({
    object:
      z.literal(
        "page_markdown",
      ),
    id:
      z.string()
        .min(1),
    markdown:
      z.string(),
    truncated:
      z.boolean(),
    unknown_block_ids:
      z.array(
        z.string(),
      ),
  }).passthrough();

const TRANSIENT_HTTP_STATUSES =
  new Set([
    429,
    500,
    502,
    503,
    504,
    529,
  ]);

const TRANSIENT_NOTION_CODES =
  new Set<string>([
    APIErrorCode.RateLimited,
    APIErrorCode.InternalServerError,
    APIErrorCode.ServiceOverload,
    APIErrorCode.ServiceUnavailable,
    APIErrorCode.GatewayTimeout,
    ClientErrorCode.RequestTimeout,
  ]);

const DEFAULT_MAX_ATTEMPTS =
  4;

const DEFAULT_BASE_DELAY_MS =
  250;

const DEFAULT_MAX_DELAY_MS =
  2_000;

export class NotionTaskSourceError extends Error {
  /**
   * Creates an adapter-specific error without exposing Notion credentials.
   */
  constructor(
    message: string,
  ) {
    super(message);
    this.name =
      "NotionTaskSourceError";
  }
}

/**
 * Concatenates Notion rich-text fragments without changing their source text.
 */
function textFromFragments(
  fragments: Array<{
    plain_text:
      string;
  }>,
): string {
  return fragments
    .map(
      (fragment) =>
        fragment.plain_text,
    )
    .join("");
}

/**
 * Reads the Project property from either a select or rich-text Notion field.
 */
function readProjectName(
  property:
    z.infer<
      typeof projectPropertySchema
    >,
): string {
  if (
    property.type ===
      "select"
  ) {
    if (
      !property.select
    ) {
      throw new NotionTaskSourceError(
        "Notion Project must contain a repository name.",
      );
    }

    return property
      .select
      .name;
  }

  return textFromFragments(
    property.rich_text,
  );
}

/**
 * Rejects paths and normalized aliases so Notion can provide only an exact repository name.
 */
function validateRepositoryName(
  value: string,
): string {
  if (
    !value ||
    value !==
      value.trim() ||
    value === "." ||
    value === ".." ||
    path.isAbsolute(
      value,
    ) ||
    value.includes(
      "/",
    ) ||
    value.includes(
      "\\",
    )
  ) {
    throw new NotionTaskSourceError(
      "Notion Project must be an exact repository name, not a filesystem path.",
    );
  }

  return value;
}

/**
 * Extracts a safe numeric HTTP status from an unknown Notion error.
 */
function notionErrorStatus(
  error: unknown,
): number | null {
  if (
    error === null ||
    typeof error !==
      "object" ||
    !(
      "status" in
      error
    )
  ) {
    return null;
  }

  const status =
    (
      error as {
        status?:
          unknown;
      }
    ).status;

  return typeof status ===
    "number"
    ? status
    : null;
}

/**
 * Extracts the SDK error code without relying on unchecked error casting.
 */
function notionErrorCode(
  error: unknown,
): string | null {
  if (
    isNotionClientError(
      error,
    )
  ) {
    return error.code;
  }

  if (
    error !== null &&
    typeof error ===
      "object" &&
    "code" in error &&
    typeof (
      error as {
        code?:
          unknown;
      }
    ).code ===
      "string"
  ) {
    return (
      error as {
        code:
          string;
      }
    ).code;
  }

  return null;
}

/**
 * Identifies rate limits, timeouts, and transient Notion service failures eligible for retry.
 */
function isTransientNotionError(
  error: unknown,
): boolean {
  const status =
    notionErrorStatus(
      error,
    );

  if (
    status !== null &&
    TRANSIENT_HTTP_STATUSES.has(
      status,
    )
  ) {
    return true;
  }

  const code =
    notionErrorCode(
      error,
    );

  return (
    code !== null &&
    TRANSIENT_NOTION_CODES.has(
      code,
    )
  );
}

/**
 * Sleeps for one retry delay without blocking the Node.js event loop.
 */
async function sleep(
  delayMs: number,
): Promise<void> {
  await new Promise<void>(
    (resolve) => {
      setTimeout(
        resolve,
        delayMs,
      );
    },
  );
}

/**
 * Calculates bounded full-jitter exponential backoff for one retry attempt.
 */
function retryDelayMs(
  retryNumber: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random:
    () => number,
): number {
  const ceiling =
    Math.min(
      maxDelayMs,
      baseDelayMs *
        2 **
          Math.max(
            0,
            retryNumber -
              1,
          ),
    );

  return Math.max(
    1,
    Math.floor(
      random() *
        ceiling,
    ),
  );
}

/**
 * Executes one Notion request with bounded retries for transient failures only.
 */
async function withNotionRetry<T>(
  operationName: string,
  operation:
    () => Promise<T>,
  options:
    NotionRetryOptions,
  retryLogger:
    RetryLogger,
): Promise<T> {
  const maxAttempts =
    options.maxAttempts ??
    DEFAULT_MAX_ATTEMPTS;

  const baseDelayMs =
    options.baseDelayMs ??
    DEFAULT_BASE_DELAY_MS;

  const maxDelayMs =
    options.maxDelayMs ??
    DEFAULT_MAX_DELAY_MS;

  const wait =
    options.sleep ??
    sleep;

  const random =
    options.random ??
    Math.random;

  for (
    let attempt = 1;
    attempt <=
      maxAttempts;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      const canRetry =
        attempt <
          maxAttempts &&
        isTransientNotionError(
          error,
        );

      if (
        !canRetry
      ) {
        throw error;
      }

      const delayMs =
        retryDelayMs(
          attempt,
          baseDelayMs,
          maxDelayMs,
          random,
        );

      retryLogger.warn(
        {
          operation:
            operationName,
          attempt,
          delayMs,
          status:
            notionErrorStatus(
              error,
            ),
          code:
            notionErrorCode(
              error,
            ),
        },
        "Retrying transient Notion request",
      );

      await wait(
        delayMs,
      );
    }
  }

  throw new NotionTaskSourceError(
    "Notion retry loop exhausted unexpectedly.",
  );
}

/**
 * Resolves an exact repository name through filesystem-backed project discovery.
 */
async function resolveProjectByRepositoryName(
  repositoryName: string,
): Promise<Project | null> {
  const {
    projects,
  } =
    await listProjects(
      env.WORKSPACE_ROOT,
    );

  return (
    projects.find(
      (project) =>
        project.name ===
        repositoryName,
    ) ??
    null
  );
}

/**
 * Validates that all server-only Notion configuration required by the adapter is available.
 */
function requireNotionConfiguration(): {
  apiKey:
    string;
  dataSourceId:
    string;
  apiVersion:
    "2026-03-11";
} {
  if (
    !env.NOTION_API_KEY ||
    !env.NOTION_DATA_SOURCE_ID ||
    !env.NOTION_API_VERSION
  ) {
    throw new NotionTaskSourceError(
      "The Notion task source is not configured.",
    );
  }

  return {
    apiKey:
      env.NOTION_API_KEY,
    dataSourceId:
      env.NOTION_DATA_SOURCE_ID,
    apiVersion:
      env.NOTION_API_VERSION,
  };
}

export class NotionTaskSourceAdapter {
  /**
   * Creates a Notion task-source adapter with injectable dependencies for focused tests.
   */
  constructor(
    private readonly options:
      NotionTaskSourceAdapterOptions,
  ) {}

  /**
   * Queries at most one Ready task, validates its properties, reads raw markdown, and resolves its trusted local project.
   */
  async getNextReadyTask(): Promise<
    NotionTaskCandidate | null
  > {
    const response =
      await withNotionRetry(
        "query_ready_task",
        () =>
          this.options.client.dataSources.query({
            data_source_id:
              this.options.dataSourceId,
            filter: {
              property:
                "Status",
              status: {
                equals:
                  "Ready",
              },
            },
            sorts: [
              {
                property:
                  "Priority",
                direction:
                  "descending",
              },
              {
                timestamp:
                  "created_time",
                direction:
                  "ascending",
              },
            ],
            page_size:
              1,
            result_type:
              "page",
          }),
        this.options.retry ??
          {},
        this.options.logger ??
          logger,
      );

    const first =
      response.results[0];

    if (
      !first
    ) {
      return null;
    }

    const parsedPage =
      readyPageSchema.safeParse(
        first,
      );

    if (
      !parsedPage.success
    ) {
      throw new NotionTaskSourceError(
        "The Ready Notion page does not match the required Title, Status, Priority, and Project contract.",
      );
    }

    const page =
      parsedPage.data;

    const title =
      textFromFragments(
        page.properties
          .Title
          .title,
      ).trim();

    if (
      !title
    ) {
      throw new NotionTaskSourceError(
        "Notion Title must not be empty.",
      );
    }

    if (
      page.properties
        .Status
        .status
        ?.name !==
      "Ready"
    ) {
      throw new NotionTaskSourceError(
        "Notion Status must be exactly Ready.",
      );
    }

    const priority =
      page.properties
        .Priority
        .number;

    if (
      priority === null ||
      !Number.isInteger(
        priority,
      )
    ) {
      throw new NotionTaskSourceError(
        "Notion Priority must be an integer.",
      );
    }

    let repositoryName:
      string;

    try {
      repositoryName =
        validateRepositoryName(
          readProjectName(
            page.properties
              .Project,
          ),
        );
    } catch (error) {
      if (
        error instanceof
        NotionTaskSourceError
      ) {
        logger.warn(
          {
            pageId:
              page.id,
            message:
              error.message,
          },
          "Skipping invalid Notion task",
        );

        return null;
      }

      throw error;
    }

    const project =
      await this.options.resolveProject(
        repositoryName,
      );

    if (
      !project ||
      project.name !==
        repositoryName
    ) {
      throw new NotionTaskSourceError(
        `No discovered repository exactly matches Notion Project "${repositoryName}".`,
      );
    }

    const markdownResponse =
      await withNotionRetry(
        "retrieve_page_markdown",
        () =>
          this.options.client.pages.retrieveMarkdown({
            page_id:
              page.id,
          }),
        this.options.retry ??
          {},
        this.options.logger ??
          logger,
      );

    const parsedMarkdown =
      markdownResponseSchema.safeParse(
        markdownResponse,
      );

    if (
      !parsedMarkdown.success
    ) {
      throw new NotionTaskSourceError(
        "Notion returned an invalid page-markdown response.",
      );
    }

    if (
      parsedMarkdown.data
        .truncated
    ) {
      throw new NotionTaskSourceError(
        "The Notion task body was truncated and cannot be persisted safely as the complete instruction.",
      );
    }

    if (
      !parsedMarkdown.data
        .markdown
        .trim()
    ) {
      throw new NotionTaskSourceError(
        "The Notion page body must not be empty.",
      );
    }

    return {
      source:
        "notion",
      externalId:
        page.id,
      externalUrl:
        page.url ??
        null,
      title,
      instruction:
        parsedMarkdown.data
          .markdown,
      priority,
      project,
    };
  }

  /**
   * Updates the external Notion Status property to one supported workflow-facing state.
   */
  async updateStatus(
    pageId: string,
    status:
      NotionTaskStatus,
  ): Promise<void> {
    const validatedStatus =
      notionTaskStatusSchema.parse(
        status,
      );

    await withNotionRetry(
      "update_task_status",
      () =>
        this.options.client.pages.update({
          page_id:
            pageId,
          properties: {
            Status: {
              status: {
                name:
                  validatedStatus,
              },
            },
          },
        }),
      this.options.retry ??
        {},
      this.options.logger ??
        logger,
    );
  }
}

/**
 * Builds the production Notion adapter using validated server-only environment configuration.
 */
export function createNotionTaskSourceAdapter(): NotionTaskSourceAdapter {
  const configuration =
    requireNotionConfiguration();

  const client =
    new Client({
      auth:
        configuration.apiKey,
      notionVersion:
        configuration.apiVersion,
      retry:
        false,
    });

  return new NotionTaskSourceAdapter({
    client,
    dataSourceId:
      configuration.dataSourceId,
    resolveProject:
      resolveProjectByRepositoryName,
  });
}
