import {
  redirect,
} from "next/navigation";

/**
 * Redirects the legacy standalone Agents route into the Team-owned management workspace.
 */
export default function AgentsPage() {
  redirect(
    "/teams",
  );
}
