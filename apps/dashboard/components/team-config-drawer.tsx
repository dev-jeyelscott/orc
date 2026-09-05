"use client";

import {
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";

import type {
  CreateTeam,
  Team,
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
import {
  Input,
} from "@/components/ui/input";
import {
  Switch,
} from "@/components/ui/switch";
import {
  Textarea,
} from "@/components/ui/textarea";
import {
  createTeam,
  deleteTeam,
  updateTeam,
} from "@/lib/teams";

const drawerStyle = {
  "--drawer-content-width":
    "min(34rem, 94vw)",
} as CSSProperties;

const blankTeam: CreateTeam = {
  slug: "",
  name: "",
  description: "",
  enabled: true,
};

type TeamConfigDrawerProps = {
  open: boolean;
  mode:
    | "create"
    | "edit";
  team:
    Team | null;
  memberCount:
    number;
  onOpenChange:
    (open: boolean) => void;
  onRefresh:
    (
      preferredTeamId:
        string | null,
    ) => Promise<void>;
};

/**
 * Converts unknown Team mutation failures into concise operator-facing text.
 */
function errorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : "Unable to save Team configuration";
}

/**
 * Converts one persisted Team into the editable Team payload.
 */
function createDraft(
  team: Team | null,
): CreateTeam {
  if (!team) {
    return {
      ...blankTeam,
    };
  }

  return {
    slug:
      team.slug,
    name:
      team.name,
    description:
      team.description,
    enabled:
      team.enabled,
  };
}

/**
 * Renders Team creation, editing, enablement, and safe deletion controls.
 */
export function TeamConfigDrawer({
  open,
  mode,
  team,
  memberCount,
  onOpenChange,
  onRefresh,
}: TeamConfigDrawerProps) {
  const [
    draft,
    setDraft,
  ] =
    useState<CreateTeam>(
      () =>
        createDraft(
          mode === "edit"
            ? team
            : null,
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
    useState<string | null>(
      null,
    );

  /**
   * Updates one Team field in the local form draft.
   */
  function update<
    K extends keyof CreateTeam,
  >(
    key: K,
    value:
      CreateTeam[K],
  ) {
    setDraft(
      (current) => ({
        ...current,
        [key]:
          value,
      }),
    );
  }

  /**
   * Creates or updates the current Team configuration.
   */
  async function submit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      mode === "edit" &&
      team?.enabled &&
      !draft.enabled
    ) {
      const confirmed =
        window.confirm(
          `Disable ${team.name}? Pending work for this Team will not start while it is disabled. Existing active run snapshots are not changed.`,
        );

      if (!confirmed) {
        return;
      }
    }

    setSaving(
      true,
    );

    setError(
      null,
    );

    try {
      const saved =
        mode === "create"
          ? await createTeam(
              draft,
            )
          : await updateTeam(
              team!.id,
              draft,
            );

      await onRefresh(
        saved.id,
      );

      onOpenChange(
        false,
      );
    } catch (caught) {
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
   * Requests permanent Team deletion and surfaces server-side reference conflicts.
   */
  async function removeTeam() {
    if (!team) {
      return;
    }

    const confirmed =
      window.confirm(
        `Permanently delete ${team.name}? Deletion will be rejected if Agents, Tasks, Runs, or Conversations still reference this Team.`,
      );

    if (!confirmed) {
      return;
    }

    setSaving(
      true,
    );

    setError(
      null,
    );

    try {
      await deleteTeam(
        team.id,
      );

      await onRefresh(
        null,
      );

      onOpenChange(
        false,
      );
    } catch (caught) {
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
              <div className="min-w-0">
                <DrawerTitle>
                  {mode ===
                  "create"
                    ? "Create Team"
                    : `Edit ${team?.name ?? "Team"}`}
                </DrawerTitle>

                <DrawerDescription>
                  Teams define worker ownership and workflow selection boundaries.
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
                aria-label="Close Team configuration drawer"
              >
                <XIcon />
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid gap-5">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-text-secondary">
                  Name
                </span>

                <Input
                  value={
                    draft.name
                  }
                  onChange={(
                    event,
                  ) =>
                    update(
                      "name",
                      event.target
                        .value,
                    )
                  }
                  required
                  maxLength={160}
                  disabled={
                    saving
                  }
                  placeholder="Platform Team"
                />
              </label>

              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-text-secondary">
                  Slug
                </span>

                <Input
                  value={
                    draft.slug
                  }
                  onChange={(
                    event,
                  ) =>
                    update(
                      "slug",
                      event.target
                        .value,
                    )
                  }
                  required
                  maxLength={100}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  disabled={
                    saving
                  }
                  placeholder="platform"
                />

                <span className="text-xs text-text-muted">
                  Lowercase kebab-case.
                </span>
              </label>

              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-text-secondary">
                  Description
                </span>

                <Textarea
                  value={
                    draft.description
                  }
                  onChange={(
                    event,
                  ) =>
                    update(
                      "description",
                      event.target
                        .value,
                    )
                  }
                  maxLength={2000}
                  disabled={
                    saving
                  }
                  className="min-h-28 resize-y"
                  placeholder="Describe this Team's workflow responsibility."
                />
              </label>

              <div className="rounded-lg border border-divider bg-surface-interactive/40 p-3">
                <label className="flex items-center justify-between gap-4">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-text-secondary">
                      Enabled
                    </span>

                    <span className="block text-xs leading-relaxed text-text-muted">
                      Disabled Teams remain historical ownership boundaries but cannot start new workflow work.
                    </span>
                  </span>

                  <Switch
                    checked={
                      draft.enabled
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
                    aria-label="Team enabled"
                  />
                </label>
              </div>

              {mode ===
                "edit" &&
              team ? (
                <div className="rounded-lg border border-divider p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    Members
                  </p>

                  <p className="mt-1 text-sm text-text-secondary">
                    {memberCount}{" "}
                    {memberCount ===
                    1
                      ? "Agent"
                      : "Agents"}{" "}
                    currently reference this Team.
                  </p>
                </div>
              ) : null}

              {error ? (
                <p
                  role="alert"
                  className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error"
                >
                  {error}
                </p>
              ) : null}
            </div>
          </div>

          <DrawerFooter className="border-t border-divider p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {mode ===
                "edit" &&
              team ? (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={
                    saving
                  }
                  onClick={() =>
                    void removeTeam()
                  }
                >
                  <Trash2Icon />
                  Delete Team
                </Button>
              ) : null}
            </div>

            <div className="flex gap-2">
              <DrawerClose
                type="button"
                disabled={
                  saving
                }
                className={buttonVariants(
                  {
                    variant:
                      "outline",
                  },
                )}
              >
                Cancel
              </DrawerClose>

              <Button
                type="submit"
                disabled={
                  saving ||
                  !draft.name
                    .trim() ||
                  !draft.slug
                    .trim()
                }
              >
                {mode ===
                "create" ? (
                  <PlusIcon />
                ) : (
                  <SaveIcon />
                )}

                {saving
                  ? "Saving..."
                  : mode ===
                      "create"
                    ? "Create Team"
                    : "Save Changes"}
              </Button>
            </div>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
