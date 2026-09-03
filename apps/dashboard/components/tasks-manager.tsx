"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project, Task } from "@orc/shared";
import { useRouter } from "next/navigation";

import { createTask, getTasks } from "@/lib/workflows";
import { getProjects } from "@/lib/projects";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function TasksManager() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [projectData, taskData] = await Promise.all([getProjects(), getTasks()]);
      setProjects(projectData.projects);
      setTasks(taskData);
      setProjectId((current) => current || projectData.projects[0]?.id || "");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load tasks"); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true); setMessage(null);
    try {
      const created = await createTask({ projectId, title, instruction });
      router.push(`/runs/${created.run.id}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to start task"); }
    finally { setSubmitting(false); }
  }

  return <div className="flex flex-col gap-6">
    <Card><CardHeader><CardTitle>Start task</CardTitle><CardDescription>Tasks start immediately and use the current enabled-agent workflow.</CardDescription></CardHeader><CardContent>
      <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
        <label className="grid gap-1 text-sm">Project<select required value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-9 rounded-lg border bg-transparent px-2"><option value="" disabled>Select a discovered repository</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Title<Input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="grid gap-1 text-sm">Instructions<Textarea required value={instruction} onChange={(event) => setInstruction(event.target.value)} className="min-h-36" /></label>
        {message && <p className="text-sm text-status-error">{message}</p>}
        <Button type="submit" disabled={submitting || !projectId}>{submitting ? "Starting…" : "Start task"}</Button>
      </form>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Task history</CardTitle></CardHeader><CardContent className="flex flex-col gap-2">{tasks.length ? tasks.map((task) => <div key={task.id} className="rounded-lg border p-3"><div className="font-medium">{task.title}</div><div className="text-sm text-text-muted">{task.status} · {task.projectPath}</div></div>) : <p className="text-sm text-text-muted">No tasks have been started.</p>}</CardContent></Card>
  </div>;
}
