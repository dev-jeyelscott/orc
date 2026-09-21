"use client"

import { Settings2Icon } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import type { Project, Team } from "@orc/shared"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { getTeams } from "@/lib/teams"
import { deleteProjectTeamAssignment, updateProjectTeamAssignment } from "@/lib/projects"

export function ProjectAssignmentEditor({ project, onChanged }: { project: Project; onChanged: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false)
  const [teams, setTeams] = useState<Team[]>([])
  const [resolutionTeamId, setResolutionTeamId] = useState("")
  const [developmentTeamId, setDevelopmentTeamId] = useState("")
  const [autoModeTeamId, setAutoModeTeamId] = useState("")
  const [notionDataSourceId, setNotionDataSourceId] = useState("")
  const [autoModeEnabled, setAutoModeEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    void getTeams().then(setTeams).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to load Teams"))
  }, [open])

  function openEditor() {
    setResolutionTeamId(project.assignment?.resolutionTeamId ?? "")
    setDevelopmentTeamId(project.assignment?.developmentTeamId ?? "")
    setAutoModeTeamId(project.assignment?.autoModeTeamId ?? "")
    setNotionDataSourceId(project.assignment?.notionDataSourceId ?? "")
    setAutoModeEnabled(project.assignment?.autoModeEnabled ?? false)
    setError(null)
    setOpen(true)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!resolutionTeamId && !developmentTeamId) { setError("Select at least one Team or use Unassign."); return }
    if (resolutionTeamId && resolutionTeamId === developmentTeamId) { setError("Resolution and Development Teams must differ"); return }
    if (autoModeEnabled && !autoModeTeamId) { setError("Select an Auto Mode Team"); return }
    if (autoModeEnabled && !notionDataSourceId.trim()) { setError("A Notion data source ID is required when Auto Mode is enabled"); return }
    setSaving(true); setError(null)
    try {
      await updateProjectTeamAssignment(project.id, { resolutionTeamId: resolutionTeamId || null, developmentTeamId: developmentTeamId || null, notionDataSourceId: notionDataSourceId.trim() || null, autoModeEnabled, autoModeTeamId: autoModeTeamId || null })
      await onChanged(); setOpen(false)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save Project assignment") } finally { setSaving(false) }
  }

  async function unassign() {
    setSaving(true); setError(null)
    try { await deleteProjectTeamAssignment(project.id); await onChanged(); setOpen(false) } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to unassign Project") } finally { setSaving(false) }
  }

  return <>
    <Button type="button" size="xs" variant="outline" onClick={openEditor}><Settings2Icon /> Configure</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader><DialogTitle>Project assignment</DialogTitle><DialogDescription>Choose the Team and automation source for {project.name}. Reassignment affects future work only; historical Tasks and Runs keep their original Team.</DialogDescription></DialogHeader>
          <label className="grid gap-1.5 text-sm"><span>Resolution Team</span><Select value={resolutionTeamId || null} onValueChange={(value) => setResolutionTeamId(value ?? "")}><SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger><SelectContent>{teams.map((team) => <SelectItem key={team.id} value={team.id} disabled={!team.enabled}>{team.name}{!team.enabled ? " (disabled)" : ""}</SelectItem>)}</SelectContent></Select></label>
          <label className="grid gap-1.5 text-sm"><span>Development Team</span><Select value={developmentTeamId || null} onValueChange={(value) => setDevelopmentTeamId(value ?? "")}><SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger><SelectContent>{teams.map((team) => <SelectItem key={team.id} value={team.id} disabled={!team.enabled}>{team.name}{!team.enabled ? " (disabled)" : ""}</SelectItem>)}</SelectContent></Select></label>
          <label className="grid gap-1.5 text-sm"><span>Notion Data Source ID</span><Input value={notionDataSourceId} onChange={(event) => setNotionDataSourceId(event.target.value)} maxLength={255} placeholder="Optional unless Auto Mode is on" /></label>
          <label className="flex items-center justify-between gap-3 text-sm"><span><span className="block font-medium">Auto Mode</span><span className="text-xs text-text-muted">Only this Project will poll the selected source.</span></span><Switch checked={autoModeEnabled} onCheckedChange={setAutoModeEnabled} /></label>
          <label className="grid gap-1.5 text-sm"><span>Auto Mode Team</span><Select value={autoModeTeamId || null} onValueChange={(value) => setAutoModeTeamId(value ?? "")} disabled={!autoModeEnabled}><SelectTrigger><SelectValue placeholder="Select an assigned Team" /></SelectTrigger><SelectContent>{teams.filter((team) => team.id === resolutionTeamId || team.id === developmentTeamId).map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent></Select></label>
          {error ? <p role="alert" className="text-sm text-status-error">{error}</p> : null}
          <DialogFooter><Button type="button" variant="outline" disabled={saving || !project.assignment} onClick={() => void unassign()}>Unassign</Button><Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save assignment"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>
}
