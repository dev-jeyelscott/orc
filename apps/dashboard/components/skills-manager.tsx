"use client";

import {
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  Skill,
} from "@orc/shared";

import {
  SkillConfigDrawer,
} from "@/components/skill-config-drawer";
import {
  Badge,
} from "@/components/ui/badge";
import {
  Button,
} from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Input,
} from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Spinner,
} from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getSkills,
} from "@/lib/skills";
import {
  getVisibleSkills,
  SKILL_VIEW_MODES,
  type SkillStatusFilter,
  type SkillViewMode,
} from "@/lib/skill-collection";

const updatedAtFormatter =
  new Intl.DateTimeFormat(
    "en",
    {
      dateStyle:
        "medium",
      timeStyle:
        "short",
    },
  );

/**
 * Formats Skill update timestamps consistently across registry views.
 */
function formatUpdatedAt(
  value: string,
): string {
  return updatedAtFormatter.format(
    new Date(
      value,
    ),
  );
}

/**
 * Renders semantic enabled state using the existing status badge system.
 */
function SkillStatusBadge({
  skill,
}: {
  skill: Skill;
}) {
  return (
    <Badge
      variant={
        skill.enabled
          ? "success"
          : "disabled"
      }
    >
      <span
        aria-hidden="true"
        className={
          skill.enabled
            ? "size-1.5 rounded-full bg-status-success"
            : "size-1.5 rounded-full bg-status-disabled"
        }
      />

      {skill.enabled
        ? "Enabled"
        : "Disabled"}
    </Badge>
  );
}

/**
 * Renders the generic presentation-only Skill glyph used by all registry views.
 */
function SkillIcon() {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border-default bg-surface-interactive text-text-secondary"
    >
      <SparklesIcon className="size-4" />
    </span>
  );
}

/**
 * Browses and edits reusable Skills without introducing domain-specific behavior.
 */
export function SkillsManager() {
  const [
    skills,
    setSkills,
  ] =
    useState<
      Skill[]
    >([]);

  const [
    loadState,
    setLoadState,
  ] =
    useState<
      | "loading"
      | "loaded"
      | "error"
    >(
      "loading",
    );

  const [
    error,
    setError,
  ] =
    useState<
      string | null
    >(null);

  const [
    refreshing,
    setRefreshing,
  ] =
    useState(false);

  const [
    query,
    setQuery,
  ] =
    useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState<SkillStatusFilter>(
      "all",
    );

  const [
    view,
    setView,
  ] =
    useState<SkillViewMode>(
      "table",
    );

  const [
    editor,
    setEditor,
  ] =
    useState<{
      skill:
        Skill | null;
    } | null>(
      null,
    );

  /**
   * Loads the server-owned, name-sorted Skill registry.
   */
  const load =
    useCallback(
      async () => {
        try {
          const nextSkills =
            await getSkills();

          setSkills(
            nextSkills,
          );

          setLoadState(
            "loaded",
          );

          setError(
            null,
          );
        } catch (
          caught
        ) {
          setError(
            caught instanceof
              Error
              ? caught.message
              : "Unable to load Skills",
          );

          setLoadState(
            "error",
          );
        } finally {
          setRefreshing(
            false,
          );
        }
      },
      [],
    );

  useEffect(
    () => {
      let disposed =
        false;

      queueMicrotask(
        () => {
          if (
            !disposed
          ) {
            void load();
          }
        },
      );

      return () => {
        disposed =
          true;
      };
    },
    [
      load,
    ],
  );

  const visibleSkills =
    useMemo(
      () =>
        getVisibleSkills(
          skills,
          query,
          statusFilter,
        ),
      [
        skills,
        query,
        statusFilter,
      ],
    );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">
            Skills
          </h1>

          <p className="mt-1 text-sm text-text-muted">
            Reusable capabilities assigned to Agents.
          </p>
        </div>

        <Button
          onClick={() =>
            setEditor(
              {
                skill:
                  null,
              },
            )
          }
          disabled={
            loadState !==
            "loaded"
          }
        >
          <PlusIcon />
          Create Skill
        </Button>
      </header>

      <section
        aria-label="Skills browser"
        className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-elevated"
      >
        <div className="flex flex-wrap gap-3 border-b border-divider p-3">
          <Input
            className="min-w-52 flex-1"
            type="search"
            aria-label="Search Skills"
            placeholder="Search Skills..."
            value={
              query
            }
            onChange={(
              event,
            ) =>
              setQuery(
                event
                  .target
                  .value,
              )
            }
          />

          <NativeSelect
            value={
              statusFilter
            }
            onChange={(
              event,
            ) =>
              setStatusFilter(
                event
                  .target
                  .value as
                  SkillStatusFilter,
              )
            }
            aria-label="Filter Skills by status"
          >
            <NativeSelectOption value="all">
              All statuses
            </NativeSelectOption>

            <NativeSelectOption value="enabled">
              Enabled
            </NativeSelectOption>

            <NativeSelectOption value="disabled">
              Disabled
            </NativeSelectOption>
          </NativeSelect>

          <Button
            variant="outline"
            disabled={
              refreshing ||
              loadState ===
                "loading"
            }
            onClick={() => {
              setRefreshing(
                true,
              );

              void load();
            }}
          >
            <RefreshCwIcon
              className={
                refreshing
                  ? "animate-spin motion-reduce:animate-none"
                  : ""
              }
            />

            Refresh
          </Button>

          <div
            role="group"
            aria-label="Skill view"
            className="flex flex-wrap gap-1"
          >
            {SKILL_VIEW_MODES.map(
              (
                mode,
              ) => (
                <Button
                  key={
                    mode
                  }
                  type="button"
                  size="sm"
                  variant={
                    view ===
                    mode
                      ? "secondary"
                      : "ghost"
                  }
                  aria-pressed={
                    view ===
                    mode
                  }
                  onClick={() =>
                    setView(
                      mode,
                    )
                  }
                >
                  {mode ===
                  "details"
                    ? "Detailed"
                    : mode
                        .charAt(
                          0,
                        )
                        .toUpperCase() +
                      mode.slice(
                        1,
                      )}
                </Button>
              ),
            )}
          </div>
        </div>

        {loadState ===
        "loading" ? (
          <Empty className="min-h-64">
            <Spinner />

            <EmptyTitle>
              Loading Skills...
            </EmptyTitle>
          </Empty>
        ) : loadState ===
          "error" ? (
          <Empty className="min-h-64">
            <EmptyTitle>
              Failed to load Skills
            </EmptyTitle>

            <EmptyDescription>
              {error}
            </EmptyDescription>

            <Button
              onClick={() => {
                setLoadState(
                  "loading",
                );

                void load();
              }}
            >
              Retry
            </Button>
          </Empty>
        ) : visibleSkills.length ===
          0 ? (
          <Empty className="min-h-64">
            <EmptyTitle>
              {skills.length
                ? "No matching Skills"
                : "No Skills yet"}
            </EmptyTitle>

            <EmptyDescription>
              {skills.length
                ? "Try another search or status filter."
                : "Create a reusable capability that can be assigned to Agents."}
            </EmptyDescription>
          </Empty>
        ) : view ===
          "table" ? (
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>
                  Skill
                </TableHead>

                <TableHead>
                  Description
                </TableHead>

                <TableHead>
                  Status
                </TableHead>

                <TableHead>
                  Updated
                </TableHead>

                <TableHead>
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {visibleSkills.map(
                (
                  skill,
                ) => (
                  <TableRow
                    key={
                      skill.id
                    }
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <SkillIcon />

                        <div className="min-w-0">
                          <div className="font-medium">
                            {
                              skill.name
                            }
                          </div>

                          <div className="font-mono text-xs text-text-muted">
                            {
                              skill.slug
                            }
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <p className="max-w-[34rem] truncate text-text-secondary">
                        {skill.description ||
                          "No description"}
                      </p>
                    </TableCell>

                    <TableCell>
                      <SkillStatusBadge
                        skill={
                          skill
                        }
                      />
                    </TableCell>

                    <TableCell className="text-xs text-text-muted">
                      {formatUpdatedAt(
                        skill.updatedAt,
                      )}
                    </TableCell>

                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${skill.name}`}
                        onClick={() =>
                          setEditor(
                            {
                              skill,
                            },
                          )
                        }
                      >
                        <PencilIcon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        ) : (
          <div
            className={
              view ===
              "grid"
                ? "grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3"
                : "divide-y divide-divider"
            }
          >
            {visibleSkills.map(
              (
                skill,
              ) => (
                <article
                  key={
                    skill.id
                  }
                  className={
                    view ===
                    "grid"
                      ? "min-w-0 rounded-md border border-border-default p-4"
                      : "p-4"
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <SkillIcon />

                      <div className="min-w-0">
                        <h2 className="truncate font-medium">
                          {
                            skill.name
                          }
                        </h2>

                        <p className="truncate font-mono text-xs text-text-muted">
                          {
                            skill.slug
                          }
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <SkillStatusBadge
                        skill={
                          skill
                        }
                      />

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${skill.name}`}
                        onClick={() =>
                          setEditor(
                            {
                              skill,
                            },
                          )
                        }
                      >
                        <PencilIcon />
                      </Button>
                    </div>
                  </div>

                  <p className="mt-3 text-sm text-text-secondary">
                    {skill.description ||
                      "No description"}
                  </p>

                  {view !==
                  "list" ? (
                    <p className="mt-3 text-xs text-text-muted">
                      Updated{" "}
                      {formatUpdatedAt(
                        skill.updatedAt,
                      )}
                    </p>
                  ) : null}

                  {view ===
                  "details" ? (
                    <dl className="mt-3 grid gap-2 border-t border-divider pt-3 text-xs">
                      <div>
                        <dt className="text-text-muted">
                          Identifier
                        </dt>

                        <dd className="font-mono text-text-secondary">
                          {
                            skill.slug
                          }
                        </dd>
                      </div>

                      <div>
                        <dt className="text-text-muted">
                          Availability
                        </dt>

                        <dd className="text-text-secondary">
                          {skill.enabled
                            ? "Available to Agents"
                            : "Unavailable to Agents"}
                        </dd>
                      </div>
                    </dl>
                  ) : null}
                </article>
              ),
            )}
          </div>
        )}

        {loadState ===
        "loaded" ? (
          <footer className="border-t border-divider px-4 py-3 text-xs text-text-muted">
            Showing{" "}
            {
              visibleSkills.length
            }{" "}
            of{" "}
            {
              skills.length
            }{" "}
            Skills
          </footer>
        ) : null}
      </section>

      {editor ? (
        <SkillConfigDrawer
          key={
            editor.skill
              ?.id ??
            "create"
          }
          skill={
            editor.skill
          }
          onOpenChange={(
            open,
          ) => {
            if (
              !open
            ) {
              setEditor(
                null,
              );
            }
          }}
          onRefresh={
            load
          }
        />
      ) : null}
    </div>
  );
}
