import { DashboardOverview } from "@/components/dashboard-overview";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDashboard } from "@/lib/dashboard";

/**
 * Renders an explicit initial-load failure instead of fabricating dashboard values.
 */
function DashboardUnavailable() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Dashboard unavailable
        </CardTitle>
      </CardHeader>

      <CardContent>
        <p className="text-sm text-text-muted">
          The system summary could not be
          loaded. Confirm the backend is
          reachable, then refresh the page.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Loads dashboard data while converting transport or validation failures into an empty result.
 */
async function loadDashboardData() {
  try {
    return await getDashboard();
  } catch {
    return null;
  }
}

/**
 * Loads the initial production dashboard read model on the server.
 */
export default async function Home() {
  const initialData =
    await loadDashboardData();

  if (!initialData) {
    return <DashboardUnavailable />;
  }

  return (
    <DashboardOverview
      initialData={initialData}
    />
  );
}
