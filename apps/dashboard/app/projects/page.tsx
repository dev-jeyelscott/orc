import { ProjectsList } from "@/components/projects-list"

/**
 * Renders the Projects page heading and filesystem-backed repository browser.
 */
export default function ProjectsPage() {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold text-text-primary">
          Projects
        </h1>
        <p className="text-sm text-text-muted">
          Git repositories discovered under the configured workspace root.
        </p>
      </header>

      <ProjectsList />
    </div>
  )
}
