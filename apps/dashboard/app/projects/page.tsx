import { ProjectsList } from "@/components/projects-list";

export default function ProjectsPage() {
  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Projects</h1>
        <p className="text-sm text-text-muted">
          Git repositories discovered under the configured workspace root.
        </p>
      </header>

      <ProjectsList />
    </div>
  );
}
