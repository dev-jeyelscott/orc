import {
  TeamDetailWorkspace,
} from "@/components/team-detail-workspace";

/**
 * Renders the dedicated management workspace for one persisted Team.
 */
export default async function TeamPage({
  params,
}: {
  params:
    Promise<{
      teamId: string;
    }>;
}) {
  const {
    teamId,
  } = await params;

  return (
    <TeamDetailWorkspace
      teamId={teamId}
    />
  );
}
