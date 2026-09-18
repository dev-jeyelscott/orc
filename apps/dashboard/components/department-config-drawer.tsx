"use client";

import { SaveIcon, Trash2Icon, XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";

import type {
  CreateDepartment,
  Department,
  KnowledgeCategory,
  SandboxMode,
} from "@orc/shared";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  createDepartment,
  deleteDepartment,
  getDepartmentKnowledge,
  updateDepartment,
  updateDepartmentKnowledge,
} from "@/lib/departments";
import { getKnowledgeCategories } from "@/lib/knowledge";
import { harnessOptions } from "@/lib/harness-options";

const drawerStyle = {
  "--drawer-content-width": "min(46rem, 96vw)",
} as CSSProperties;

const blankDepartment: CreateDepartment = {
  slug: "",
  name: "",
  role: "",
  description: "",
  enabled: true,
  harness: "codex",
  defaultModel: "default",
  defaultReasoning: "high",
  systemPrompt: "",
  canWrite: false,
  canRunCommands: true,
  sandboxMode: "workspace-write",
  canCommit: false,
};

/**
 * Creates an editable Department draft from persisted configuration.
 */
function draftFrom(
  department: Department | null,
): CreateDepartment {
  if (!department) {
    return {
      ...blankDepartment,
    };
  }

  return {
    slug: department.slug,
    name: department.name,
    role: department.role,
    description: department.description,
    enabled: department.enabled,
    harness: department.harness,
    defaultModel: department.defaultModel,
    defaultReasoning: department.defaultReasoning,
    systemPrompt: department.systemPrompt,
    canWrite: department.canWrite,
    canRunCommands: department.canRunCommands,
    sandboxMode: department.sandboxMode,
    canCommit: department.canCommit,
  };
}

/**
 * Converts unknown save errors into a stable operator-facing message.
 */
function errorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : "Unable to save Department configuration";
}

type Props = {
  open: boolean;
  mode: "create" | "edit";
  department: Department | null;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
};

/**
 * Renders full generic Department defaults without exposing Team workflow controls.
 */
export function DepartmentConfigDrawer({
  open,
  mode,
  department,
  onOpenChange,
  onRefresh,
}: Props) {
  const [draft, setDraft] =
    useState<CreateDepartment>(
      () =>
        draftFrom(
          mode === "edit"
            ? department
            : null,
        ),
    );

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState<string | null>(
      null,
    );

  const options =
    harnessOptions[
      draft.harness ??
        "codex"
    ];

  const [
    knowledgeCategories,
    setKnowledgeCategories,
  ] =
    useState<
      KnowledgeCategory[]
    >([]);

  const [
    primaryKnowledgeIds,
    setPrimaryKnowledgeIds,
  ] =
    useState<
      Set<string>
    >(new Set());

  /**
   * Loads recommendation-only Knowledge Category associations for an existing Department.
   */
  const loadKnowledge =
    useCallback(
      async () => {
        if (
          mode !==
            "edit" ||
          !department
        ) {
          return;
        }

        try {
          const [
            categories,
            associations,
          ] =
            await Promise.all(
              [
                getKnowledgeCategories(),
                getDepartmentKnowledge(
                  department.id,
                ),
              ],
            );

          setKnowledgeCategories(
            categories,
          );

          setPrimaryKnowledgeIds(
            new Set(
              associations.map(
                (
                  row,
                ) =>
                  row.knowledgeCategoryId,
              ),
            ),
          );
        } catch {
          // Primary Knowledge is recommendation-only metadata.
          // Failure here must not block Department configuration.
        }
      },
      [
        mode,
        department,
      ],
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
            void loadKnowledge();
          }
        },
      );

      return () => {
        disposed =
          true;
      };
    },
    [
      loadKnowledge,
    ],
  );

  /**
   * Adds or removes one primary Knowledge Category from the local draft selection.
   */
  function toggleKnowledgeCategory(
    categoryId: string,
    checked: boolean,
  ) {
    setPrimaryKnowledgeIds(
      (
        current,
      ) => {
        const next =
          new Set(
            current,
          );

        if (
          checked
        ) {
          next.add(
            categoryId,
          );
        } else {
          next.delete(
            categoryId,
          );
        }

        return next;
      },
    );
  }

  /**
   * Updates one Department draft field without mutating the existing object.
   */
  function update<
    K extends keyof CreateDepartment,
  >(
    key: K,
    value:
      CreateDepartment[K],
  ) {
    setDraft(
      (
        current,
      ) => ({
        ...current,
        [key]:
          value,
      }),
    );
  }

  /**
   * Changes the harness and resets model and reasoning to valid defaults for that harness.
   */
  function changeHarness(
    harness:
      | "claude"
      | "codex",
  ) {
    const next =
      harnessOptions[
        harness
      ];

    setDraft(
      (
        current,
      ) => ({
        ...current,
        harness,
        defaultModel:
          next.models[0],
        defaultReasoning:
          next.reasoning[0],
      }),
    );
  }

  /**
   * Persists the Department and its recommendation-only Knowledge associations.
   */
  async function submit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setSaving(true);
    setError(null);

    try {
      const saved =
        mode ===
        "create"
          ? await createDepartment(
              draft,
            )
          : await updateDepartment(
              department!.id,
              draft,
              department!.configRevision,
            );

      if (
        mode ===
        "edit"
      ) {
        await updateDepartmentKnowledge(
          saved.id,
          Array.from(
            primaryKnowledgeIds,
          ),
        );
      }

      await onRefresh();

      onOpenChange(
        false,
      );
    } catch (
      caught
    ) {
      setError(
        errorMessage(
          caught,
        ),
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  /**
   * Deletes the selected Department after explicit operator confirmation.
   */
  async function remove() {
    if (
      !department ||
      !window.confirm(
        `Permanently delete ${department.name}? Deletion will be rejected when Agents reference it.`,
      )
    ) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await deleteDepartment(
        department.id,
        department.configRevision,
      );

      await onRefresh();

      onOpenChange(
        false,
      );
    } catch (
      caught
    ) {
      setError(
        errorMessage(
          caught,
        ),
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={
        onOpenChange
      }
      modal={false}
      disablePointerDismissal
      swipeDirection="right"
    >
      <DrawerContent
        style={
          drawerStyle
        }
      >
        <form
          onSubmit={
            submit
          }
          className="flex min-h-0 flex-1 flex-col"
        >
          <DrawerHeader className="border-b border-divider p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DrawerTitle>
                  {mode ===
                  "create"
                    ? "Create Department"
                    : `Edit ${department?.name ?? "Department"}`}
                </DrawerTitle>

                <DrawerDescription>
                  Reusable defaults for future Agent inheritance. Agent execution is unchanged.
                </DrawerDescription>
              </div>

              <DrawerClose
                type="button"
                disabled={
                  saving
                }
                className={buttonVariants(
                  {
                    variant:
                      "ghost",
                    size:
                      "icon-sm",
                  },
                )}
                aria-label="Close Department configuration drawer"
              >
                <XIcon />
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid gap-5">
              <section className="grid gap-4 md:grid-cols-2">
                <Field label="Name">
                  <Input
                    value={
                      draft.name
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "name",
                        event
                          .target
                          .value,
                      )
                    }
                    required
                    maxLength={
                      160
                    }
                    disabled={
                      saving
                    }
                  />
                </Field>

                <Field label="Slug">
                  <Input
                    value={
                      draft.slug
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "slug",
                        event
                          .target
                          .value,
                      )
                    }
                    required
                    maxLength={
                      100
                    }
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    disabled={
                      saving
                    }
                  />
                </Field>

                <Field label="Role">
                  <Input
                    value={
                      draft.role
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "role",
                        event
                          .target
                          .value,
                      )
                    }
                    required
                    maxLength={
                      160
                    }
                    disabled={
                      saving
                    }
                  />
                </Field>

                <Field label="Enabled">
                  <Switch
                    checked={
                      draft.enabled ??
                      true
                    }
                    onCheckedChange={(
                      checked,
                    ) =>
                      update(
                        "enabled",
                        checked,
                      )
                    }
                    disabled={
                      saving
                    }
                    aria-label="Department enabled"
                  />

                  <span className="text-xs text-text-muted">
                    Disabled Departments stay editable but are unavailable to future inheritance.
                  </span>
                </Field>

                <Field
                  label="Description"
                  className="md:col-span-2"
                >
                  <Textarea
                    value={
                      draft.description ??
                      ""
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "description",
                        event
                          .target
                          .value,
                      )
                    }
                    maxLength={
                      2000
                    }
                    disabled={
                      saving
                    }
                  />
                </Field>
              </section>

              <section className="grid gap-4 border-t border-divider pt-5 md:grid-cols-3">
                <Field label="Harness">
                  <NativeSelect
                    value={
                      draft.harness
                    }
                    onChange={(
                      event,
                    ) =>
                      changeHarness(
                        event
                          .target
                          .value as
                          | "claude"
                          | "codex",
                      )
                    }
                    disabled={
                      saving
                    }
                  >
                    <NativeSelectOption value="codex">
                      Codex
                    </NativeSelectOption>

                    <NativeSelectOption value="claude">
                      Claude
                    </NativeSelectOption>
                  </NativeSelect>
                </Field>

                <Field label="Default model">
                  <NativeSelect
                    value={
                      draft.defaultModel
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "defaultModel",
                        event
                          .target
                          .value,
                      )
                    }
                    disabled={
                      saving
                    }
                  >
                    {options.models.map(
                      (
                        value,
                      ) => (
                        <NativeSelectOption
                          key={
                            value
                          }
                          value={
                            value
                          }
                        >
                          {
                            value
                          }
                        </NativeSelectOption>
                      ),
                    )}
                  </NativeSelect>
                </Field>

                <Field label="Default reasoning">
                  <NativeSelect
                    value={
                      draft.defaultReasoning
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "defaultReasoning",
                        event
                          .target
                          .value,
                      )
                    }
                    disabled={
                      saving
                    }
                  >
                    {options.reasoning.map(
                      (
                        value,
                      ) => (
                        <NativeSelectOption
                          key={
                            value
                          }
                          value={
                            value
                          }
                        >
                          {
                            value
                          }
                        </NativeSelectOption>
                      ),
                    )}
                  </NativeSelect>
                </Field>

                <Field
                  label="System prompt"
                  className="md:col-span-3"
                >
                  <Textarea
                    value={
                      draft.systemPrompt
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "systemPrompt",
                        event
                          .target
                          .value,
                      )
                    }
                    required
                    disabled={
                      saving
                    }
                    className="min-h-36 font-mono text-xs"
                  />
                </Field>
              </section>

              <section className="grid gap-4 border-t border-divider pt-5">
                <h3 className="font-medium text-text-primary">
                  Permissions
                </h3>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Toggle
                    label="Can write files"
                    checked={
                      draft.canWrite ??
                      false
                    }
                    onCheckedChange={(
                      checked,
                    ) =>
                      update(
                        "canWrite",
                        checked,
                      )
                    }
                    disabled={
                      saving
                    }
                  />

                  <Toggle
                    label="Can run commands"
                    checked={
                      draft.canRunCommands ??
                      false
                    }
                    onCheckedChange={(
                      checked,
                    ) =>
                      update(
                        "canRunCommands",
                        checked,
                      )
                    }
                    disabled={
                      saving
                    }
                  />

                  <Toggle
                    label="Can commit"
                    checked={
                      draft.canCommit ??
                      false
                    }
                    onCheckedChange={(
                      checked,
                    ) =>
                      update(
                        "canCommit",
                        checked,
                      )
                    }
                    disabled={
                      saving
                    }
                  />

                  <Field label="Sandbox mode">
                    <NativeSelect
                      value={
                        draft.sandboxMode ??
                        ""
                      }
                      onChange={(
                        event,
                      ) =>
                        update(
                          "sandboxMode",
                          (event
                            .target
                            .value ||
                            null) as
                            | SandboxMode
                            | null,
                        )
                      }
                      disabled={
                        saving
                      }
                    >
                      <NativeSelectOption value="">
                        No sandbox default
                      </NativeSelectOption>

                      <NativeSelectOption value="read-only">
                        Read only
                      </NativeSelectOption>

                      <NativeSelectOption value="workspace-write">
                        Workspace write
                      </NativeSelectOption>

                      <NativeSelectOption value="danger-full-access">
                        Full host access
                      </NativeSelectOption>
                    </NativeSelect>
                  </Field>
                </div>
              </section>

              {mode ===
              "edit" ? (
                <section className="grid gap-3 border-t border-divider pt-5">
                  <div>
                    <h3 className="font-medium text-text-primary">
                      Primary Knowledge
                    </h3>

                    <p className="text-xs text-text-muted">
                      Recommended Knowledge Categories for discoverability only. This never
                      restricts retrieval of other categories or injects context automatically.
                    </p>
                  </div>

                  {knowledgeCategories.length ===
                  0 ? (
                    <p className="text-sm text-text-muted">
                      No Knowledge Categories configured yet.
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {knowledgeCategories.map(
                        (
                          category,
                        ) => (
                          <label
                            key={
                              category.id
                            }
                            className="flex items-center justify-between gap-3 rounded-md border border-border-default p-3 text-sm"
                          >
                            <span className="flex flex-col">
                              <span className="font-medium text-text-secondary">
                                {
                                  category.name
                                }
                              </span>

                              {!category.enabled ? (
                                <span className="text-xs text-text-muted">
                                  Disabled
                                </span>
                              ) : null}
                            </span>

                            <Switch
                              checked={primaryKnowledgeIds.has(
                                category.id,
                              )}
                              onCheckedChange={(
                                checked,
                              ) =>
                                toggleKnowledgeCategory(
                                  category.id,
                                  checked,
                                )
                              }
                              disabled={
                                saving
                              }
                              aria-label={`Mark ${category.name} as primary knowledge`}
                            />
                          </label>
                        ),
                      )}
                    </div>
                  )}
                </section>
              ) : null}

              {error ? (
                <p
                  role="alert"
                  className="rounded-md border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error"
                >
                  {
                    error
                  }
                </p>
              ) : null}
            </div>
          </div>

          <DrawerFooter className="border-t border-divider p-4">
            <div className="flex items-center justify-between gap-3">
              {mode ===
              "edit" ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() =>
                    void remove()
                  }
                  disabled={
                    saving
                  }
                >
                  <Trash2Icon />
                  Delete
                </Button>
              ) : (
                <span />
              )}

              <Button
                type="submit"
                disabled={
                  saving
                }
              >
                <SaveIcon />

                {saving
                  ? "Saving..."
                  : "Save Department"}
              </Button>
            </div>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * Renders a consistently labelled Department form field.
 */
function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children:
    React.ReactNode;
  className?: string;
}) {
  return (
    <label
      className={`grid gap-1.5 text-sm ${className}`}
    >
      <span className="font-medium text-text-secondary">
        {label}
      </span>

      {children}
    </label>
  );
}

/**
 * Renders one boolean Department permission control.
 */
function Toggle({
  label,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onCheckedChange:
    (
      checked: boolean,
    ) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border-default p-3 text-sm">
      <span className="font-medium text-text-secondary">
        {label}
      </span>

      <Switch
        checked={
          checked
        }
        onCheckedChange={
          onCheckedChange
        }
        disabled={
          disabled
        }
      />
    </label>
  );
}
