"use client";

import Link from "next/link";
import { SaveIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import type { Agent, CreateAgent, Department, Team, EffectiveAgentConfig, Harness, SandboxMode } from "@orc/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { createAgent, deleteAgent, updateAgent, previewAgent } from "@/lib/agents";

import { Textarea } from "@/components/ui/textarea";
import { harnessOptions } from "@/lib/harness-options";

const drawerStyle = { "--drawer-content-width": "min(46rem, 96vw)" } as CSSProperties;

function draftFrom(agent: Agent | null, departments: Department[]): CreateAgent {
  return { harnessOverride: agent?.harnessOverride ?? null, modelOverride: agent?.modelOverride ?? null, reasoningOverride: agent?.reasoningOverride ?? null, canWriteOverride: agent?.canWriteOverride ?? null, canRunCommandsOverride: agent?.canRunCommandsOverride ?? null, sandboxModeOverride: agent?.sandboxModeOverride ?? null, canCommitOverride: agent?.canCommitOverride ?? null, departmentId: agent?.departmentId ?? departments[0]?.id ?? "", name: agent?.name ?? "", slug: agent?.slug ?? "", enabled: agent?.enabled ?? true, additionalPrompt: agent?.additionalPrompt ?? "" };
}

/** Edits Agent identity independently of Team membership. */
export function AgentConfigDrawer({ agent, departments, teams, onOpenChange, onRefresh }: {
  agent: Agent | null; departments: Department[]; teams: Team[];
  onOpenChange: (open: boolean) => void; onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => draftFrom(agent, departments));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const assigned = agent?.currentTeamId != null;
  const department = departments.find((item) => item.id === draft.departmentId);
  const [preview, setPreview] = useState<EffectiveAgentConfig | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(true);
  useEffect(() => {
    let disposed = false;
    const timer = setTimeout(() => {
      setPreviewing(true); setPreviewError(null);
      void previewAgent(draft).then((result) => {
        if (!disposed) { setPreview(result); setPreviewing(false); }
      }).catch((caught: unknown) => {
        if (!disposed) { setPreview(null); setPreviewing(false); setPreviewError(caught instanceof Error ? caught.message : "Preview unavailable"); }
      });
    }, 200);
    return () => { disposed = true; clearTimeout(timer); };
  }, [draft]);
  const effectiveHarness = draft.harnessOverride ?? department?.harness ?? "codex";
  const options = harnessOptions[effectiveHarness];
  const team = teams.find((item) => item.id === agent?.currentTeamId);
  function update<K extends keyof CreateAgent>(key: K, value: CreateAgent[K]) { setPreviewing(true); setDraft((current) => ({ ...current, [key]: value })); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      if (agent) await updateAgent(agent.id, draft); else await createAgent(draft);
      await onRefresh(); onOpenChange(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save Agent"); }
    finally { setSaving(false); }
  }
  async function remove() {
    if (!agent || assigned || !window.confirm(`Permanently delete ${agent.name}?`)) return;
    setSaving(true); setError(null);
    try { await deleteAgent(agent.id); await onRefresh(); onOpenChange(false); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to delete Agent"); }
    finally { setSaving(false); }
  }
  return <Drawer open onOpenChange={(open) => { if (!saving) onOpenChange(open); }} modal={false} disablePointerDismissal swipeDirection="right">
    <DrawerContent style={drawerStyle}><form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DrawerHeader className="border-b border-divider p-4"><div className="flex items-start justify-between gap-4"><div><DrawerTitle>{agent ? `Edit ${agent.name}` : "Create Agent"}</DrawerTitle><DrawerDescription>Reusable specialization within a Department. New Agents start unassigned.</DrawerDescription></div><DrawerClose type="button" disabled={saving} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label="Close Agent configuration"><XIcon /></DrawerClose></div></DrawerHeader>
      <div className="flex-1 overflow-y-auto p-4"><div className="grid gap-5">
        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Name"><Input value={draft.name} onChange={(e) => update("name", e.target.value)} required maxLength={160} disabled={saving} /></Field>
          <Field label="Slug"><Input value={draft.slug} onChange={(e) => update("slug", e.target.value)} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={100} disabled={saving} /></Field>
          <Field label="Department"><NativeSelect value={draft.departmentId} onChange={(e) => update("departmentId", e.target.value)} required disabled={saving || assigned}>{departments.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect></Field>
          <Field label="Enabled"><Switch checked={draft.enabled} onCheckedChange={(value) => update("enabled", value)} disabled={saving} aria-label="Agent enabled" /></Field>
        </section>
        <p className="text-sm text-text-muted">Current Team: {team?.name ?? (agent?.currentTeamId ? "Assigned Team" : "Unassigned")}. <Link href="/teams" className="underline">Manage Teams</Link></p>
        {assigned ? <p className="text-sm text-text-muted">Remove this Agent from its Team before changing Department or deleting it. <Link href={`/teams/${agent.currentTeamId}`} className="underline">Open Team workflow</Link></p> : null}
        {department ? <section className="grid gap-3 border-t border-divider pt-4"><h3 className="font-medium">Department defaults</h3><dl className="grid grid-cols-2 gap-3 text-sm">{Object.entries({ Role: department.role, Harness: department.harness, Model: department.defaultModel, Reasoning: department.defaultReasoning, "Can write": department.canWrite, "Can run commands": department.canRunCommands, "Can commit": department.canCommit, Sandbox: department.sandboxMode ?? "Unavailable" }).map(([label, value]) => <div key={label}><dt className="text-text-muted">{label}</dt><dd className="break-words">{String(value)}</dd></div>)}</dl><h4 className="text-sm font-medium">Department base prompt</h4><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-surface-interactive p-3 text-xs">{department.systemPrompt}</pre>{!department.enabled ? <p className="text-sm text-status-warning">This Department is disabled; this Agent will be unavailable for future Runs.</p> : null}</section> : null}
        {department ? <>
          <section className="grid gap-4 border-t border-divider pt-4"><h3 className="font-medium">Runtime overrides</h3>
            <OverrideSelect label="Harness" value={draft.harnessOverride} inherited={department.harness} options={["codex", "claude"]} disabled={saving} onChange={(value) => update("harnessOverride", value as Harness | null)} />
            <OverrideSelect label="Model" value={draft.modelOverride} inherited={department.defaultModel} options={options.models} disabled={saving} onChange={(value) => update("modelOverride", value)} />
            <OverrideSelect label="Reasoning" value={draft.reasoningOverride} inherited={department.defaultReasoning} options={options.reasoning} disabled={saving} onChange={(value) => update("reasoningOverride", value)} />
            <p className="text-xs text-text-muted">Choices follow the effective harness. Existing explicit values are preserved when switching harness; review their compatibility before saving.</p>
          </section>
          <section className="grid gap-4 border-t border-divider pt-4"><h3 className="font-medium">Permission overrides</h3>
            {([['canWriteOverride', 'Can write files', department.canWrite], ['canRunCommandsOverride', 'Can run commands', department.canRunCommands], ['canCommitOverride', 'Can commit', department.canCommit]] as const).map(([key, label, inherited]) => <Field key={key} label={label}><NativeSelect value={draft[key] == null ? "inherit" : String(draft[key])} onChange={(e) => update(key, e.target.value === "inherit" ? null : e.target.value === "true")} disabled={saving}><NativeSelectOption value="inherit">Inherit: {inherited ? "Allowed" : "Denied"}</NativeSelectOption><NativeSelectOption value="true">Override: Allowed</NativeSelectOption><NativeSelectOption value="false">Override: Denied</NativeSelectOption></NativeSelect><span className="text-xs text-text-muted">Department default: {inherited ? "Allowed" : "Denied"}</span></Field>)}
            <OverrideSelect label="Sandbox mode" value={draft.sandboxModeOverride} inherited={department.sandboxMode ?? null} options={["read-only", "workspace-write", "danger-full-access"]} disabled={saving} onChange={(value) => update("sandboxModeOverride", value as SandboxMode | null)} />
          </section>
          <section className="grid gap-3 border-t border-divider pt-4"><Field label="Agent Additional Prompt"><Textarea value={draft.additionalPrompt} onChange={(e) => update("additionalPrompt", e.target.value)} maxLength={4000} disabled={saving} className="min-h-28" /><span className="text-xs text-text-muted">Reusable Agent specialization appended to the Department base prompt. Project-specific requirements belong in Project, Task, document, and knowledge context.</span></Field></section>
          <section className="grid gap-3 border-t border-divider pt-4" aria-label="Effective configuration preview" aria-busy={previewing}><h3 className="font-medium">Future Run configuration</h3>
            {previewing ? <p role="status" className="text-sm text-text-muted">Updating preview...</p> : previewError ? <p role="alert" className="text-sm text-status-error">{previewError}</p> : preview ? <><dl className="grid grid-cols-2 gap-3 text-sm">{Object.entries(preview).filter(([key]) => key !== "systemPrompt").map(([key, value]) => <div key={key}><dt className="text-text-muted">{key}</dt><dd className="break-words">{value == null ? "No sandbox default" : String(value)}</dd></div>)}</dl><h4 className="text-sm font-medium">Composed effective prompt</h4><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-surface-interactive p-3 text-xs">{preview.systemPrompt}</pre></> : null}
          </section>
        </> : null}
        {error ? <p role="alert" className="rounded-md border border-status-error/30 p-3 text-sm text-status-error">{error}</p> : null}
      </div></div>
      <DrawerFooter className="border-t border-divider p-4"><div className="flex justify-between gap-3">{agent ? <Button type="button" variant="destructive" onClick={() => void remove()} disabled={saving || assigned}><Trash2Icon />Delete</Button> : <span />}<Button type="submit" disabled={saving || !department}><SaveIcon />{saving ? "Saving..." : "Save Agent"}</Button></div></DrawerFooter>
    </form></DrawerContent>
  </Drawer>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-1.5 text-sm"><span className="font-medium text-text-secondary">{label}</span>{children}</label>; }

/** Keeps explicit values visible even if an older configuration is outside the current catalog. */
function OverrideSelect({ label, value, inherited, options, disabled, onChange }: { label: string; value: string | null | undefined; inherited: string | null; options: string[]; disabled: boolean; onChange: (value: string | null) => void }) {
  const choices = value && !options.includes(value) ? [value, ...options] : options;
  return <Field label={label}><NativeSelect value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} disabled={disabled}><NativeSelectOption value="">Inherit: {inherited ?? "No sandbox default"}</NativeSelectOption>{choices.map((choice) => <NativeSelectOption key={choice} value={choice}>Override: {choice}</NativeSelectOption>)}</NativeSelect><span className="text-xs text-text-muted">Department default: {inherited ?? "No sandbox default"} · {value == null ? "Inherited" : "Overridden"}</span></Field>;
}
