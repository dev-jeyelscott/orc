"use client";

import { SaveIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import type { CreateKnowledgeCategory, KnowledgeCategory } from "@orc/shared";

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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  createKnowledgeCategory,
  deleteKnowledgeCategory,
  updateKnowledgeCategory,
} from "@/lib/knowledge";

const blankCategory: CreateKnowledgeCategory = {
  slug: "",
  name: "",
  description: "",
  vaultRootPath: "",
  enabled: true,
};

function draftFrom(category: KnowledgeCategory | null): CreateKnowledgeCategory {
  if (!category) return { ...blankCategory };
  return {
    slug: category.slug,
    name: category.name,
    description: category.description,
    vaultRootPath: category.vaultRootPath,
    enabled: category.enabled,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to save Knowledge Category configuration";
}

type Props = {
  open: boolean;
  mode: "create" | "edit";
  category: KnowledgeCategory | null;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
};

/** Renders create/edit configuration for one Knowledge Category. */
export function KnowledgeConfigDrawer({
  open,
  mode,
  category,
  onOpenChange,
  onRefresh,
}: Props) {
  const [draft, setDraft] = useState<CreateKnowledgeCategory>(() =>
    draftFrom(mode === "edit" ? category : null),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof CreateKnowledgeCategory>(
    key: K,
    value: CreateKnowledgeCategory[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        await createKnowledgeCategory(draft);
      } else {
        await updateKnowledgeCategory(category!.id, draft);
      }
      await onRefresh();
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !category ||
      !window.confirm(`Permanently delete ${category.name}?`)
    ) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await deleteKnowledgeCategory(category.id);
      await onRefresh();
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      modal={false}
      disablePointerDismissal
      swipeDirection="right"
    >
      <DrawerContent>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DrawerHeader className="border-b border-divider p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DrawerTitle>
                  {mode === "create"
                    ? "Create Knowledge Category"
                    : `Edit ${category?.name ?? "Knowledge Category"}`}
                </DrawerTitle>
                <DrawerDescription>
                  A durable knowledge domain mapped to one managed vault
                  directory. No vault files are written by this configuration.
                </DrawerDescription>
              </div>
              <DrawerClose
                type="button"
                disabled={saving}
                className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                aria-label="Close Knowledge Category configuration drawer"
              >
                <XIcon />
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid gap-4">
              <Field label="Name">
                <Input
                  value={draft.name}
                  onChange={(e) => update("name", e.target.value)}
                  required
                  maxLength={160}
                  disabled={saving}
                />
              </Field>

              <Field label="Slug">
                <Input
                  value={draft.slug}
                  onChange={(e) => update("slug", e.target.value)}
                  required
                  maxLength={100}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  disabled={saving}
                />
              </Field>

              <Field label="Vault root path">
                <Input
                  value={draft.vaultRootPath}
                  onChange={(e) => update("vaultRootPath", e.target.value)}
                  required
                  maxLength={1024}
                  placeholder="wiki/ui-ux"
                  disabled={saving}
                />
                <span className="text-xs text-text-muted">
                  Vault-relative directory containing this category&apos;s
                  Markdown files. Must not traverse outside the vault.
                </span>
              </Field>

              <Field label="Enabled">
                <Switch
                  checked={draft.enabled ?? true}
                  onCheckedChange={(checked) => update("enabled", checked)}
                  disabled={saving}
                  aria-label="Knowledge Category enabled"
                />
              </Field>

              <Field label="Description">
                <Textarea
                  value={draft.description ?? ""}
                  onChange={(e) => update("description", e.target.value)}
                  maxLength={2000}
                  disabled={saving}
                />
              </Field>

              {error ? (
                <p
                  role="alert"
                  className="rounded-md border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error"
                >
                  {error}
                </p>
              ) : null}
            </div>
          </div>

          <DrawerFooter className="border-t border-divider p-4">
            <div className="flex items-center justify-between gap-3">
              {mode === "edit" ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void remove()}
                  disabled={saving}
                >
                  <Trash2Icon />
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={saving}>
                <SaveIcon />
                {saving ? "Saving..." : "Save Knowledge Category"}
              </Button>
            </div>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium text-text-secondary">{label}</span>
      {children}
    </label>
  );
}
