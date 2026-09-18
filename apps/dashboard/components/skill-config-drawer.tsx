"use client";

import {
  SaveIcon,
  XIcon,
} from "lucide-react";
import {
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  CreateSkill,
  Skill,
} from "@orc/shared";

import {
  Button,
  buttonVariants,
} from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  createSkill,
  updateSkill,
} from "@/lib/skills";

const drawerStyle = {
  "--drawer-content-width":
    "min(32rem, 96vw)",
} as CSSProperties;

/**
 * Creates a mutable form draft from an existing Skill or empty create state.
 */
function draftFrom(
  skill: Skill | null,
): CreateSkill {
  return {
    name:
      skill?.name ?? "",
    slug:
      skill?.slug ?? "",
    description:
      skill?.description ?? "",
    enabled:
      skill?.enabled ?? true,
    tags:
      skill?.tags ?? [],
    domains:
      skill?.domains ?? [],
  };
}

/** Parses a comma-separated tag/domain input field into a trimmed, non-empty list. */
function parseTagList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Renders one consistently labelled Skill form field.
 */
function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium text-text-secondary">
        {label}
      </span>

      {children}
    </label>
  );
}

/**
 * Creates or edits one reusable generic Skill without changing Agent assignments.
 */
export function SkillConfigDrawer({
  skill,
  onOpenChange,
  onRefresh,
}: {
  skill: Skill | null;
  onOpenChange:
    (open: boolean) => void;
  onRefresh:
    () => Promise<void>;
}) {
  const [
    draft,
    setDraft,
  ] =
    useState<CreateSkill>(
      () =>
        draftFrom(
          skill,
        ),
    );

  const [
    saving,
    setSaving,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState<
      string | null
    >(null);

  /**
   * Updates one bounded Skill draft field.
   */
  function update<
    K extends keyof CreateSkill,
  >(
    key: K,
    value:
      CreateSkill[K],
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
   * Persists the current Skill draft through the existing CRUD boundary.
   */
  async function submit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setSaving(true);
    setError(null);

    try {
      if (skill) {
        await updateSkill(
          skill.id,
          draft,
        );
      } else {
        await createSkill(
          draft,
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
        caught instanceof
          Error
          ? caught.message
          : "Unable to save Skill",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  return (
    <Drawer
      open
      modal={false}
      disablePointerDismissal
      swipeDirection="right"
      onOpenChange={(
        open,
      ) => {
        if (
          !saving
        ) {
          onOpenChange(
            open,
          );
        }
      }}
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
                  {skill
                    ? "Edit Skill"
                    : "Create Skill"}
                </DrawerTitle>

                <DrawerDescription>
                  Configure this reusable capability.
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
                aria-label="Close Skill configuration"
              >
                <XIcon />
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid gap-5">
              <Field label="Name">
                <Input
                  autoFocus
                  required
                  maxLength={
                    160
                  }
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
                  disabled={
                    saving
                  }
                />

                <span className="text-xs text-text-muted">
                  A clear, descriptive name for this Skill.
                </span>
              </Field>

              <Field label="Slug">
                <Input
                  required
                  maxLength={
                    100
                  }
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
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
                  disabled={
                    saving
                  }
                />

                <span className="text-xs text-text-muted">
                  Used for identification. Lowercase kebab-case only.
                </span>
              </Field>

              <Field label="Description">
                <Textarea
                  maxLength={
                    2000
                  }
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
                  disabled={
                    saving
                  }
                  className="min-h-28"
                />

                <span className="flex justify-between gap-3 text-xs text-text-muted">
                  <span>
                    Describe what this Skill does and when to use it.
                  </span>

                  <span>
                    {
                      (
                        draft.description ??
                        ""
                      ).length
                    }
                    /2000
                  </span>
                </span>
              </Field>

              <Field label="Tags">
                <Input
                  value={draft.tags.join(", ")}
                  onChange={(event) => update("tags", parseTagList(event.target.value))}
                  disabled={saving}
                  placeholder="database, migrations, schema"
                />

                <span className="text-xs text-text-muted">
                  Comma-separated. Used to help Agents discover this Skill.
                </span>
              </Field>

              <Field label="Domains">
                <Input
                  value={draft.domains.join(", ")}
                  onChange={(event) => update("domains", parseTagList(event.target.value))}
                  disabled={saving}
                  placeholder="backend, database"
                />

                <span className="text-xs text-text-muted">
                  Comma-separated broad capability areas.
                </span>
              </Field>

              <div className="grid gap-2 border-t border-divider pt-4">
                <span className="text-sm font-medium text-text-secondary">
                  Enabled
                </span>

                <div className="flex items-center gap-3">
                  <Switch
                    checked={
                      draft.enabled
                    }
                    onCheckedChange={(
                      enabled,
                    ) =>
                      update(
                        "enabled",
                        enabled,
                      )
                    }
                    disabled={
                      saving
                    }
                    aria-label="Skill enabled"
                  />

                  <span className="text-xs text-text-muted">
                    This Skill can be assigned to and used by Agents.
                  </span>
                </div>
              </div>

              {error ? (
                <p
                  role="alert"
                  className="rounded-md border border-status-error/30 p-3 text-sm text-status-error"
                >
                  {
                    error
                  }
                </p>
              ) : null}
            </div>
          </div>

          <DrawerFooter className="border-t border-divider p-4">
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={
                  saving
                }
                onClick={() =>
                  onOpenChange(
                    false,
                  )
                }
              >
                Cancel
              </Button>

              <Button
                type="submit"
                disabled={
                  saving
                }
              >
                <SaveIcon />

                {saving
                  ? "Saving..."
                  : "Save Skill"}
              </Button>
            </div>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
