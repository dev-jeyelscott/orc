"use client";

import { useState } from "react";

import type { Team } from "@orc/shared";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeamMembersManager } from "@/components/team-members-manager";
import { TeamWorkflowBuilder } from "@/components/team-workflow-builder";

/**
 * Team detail Agents/Workflow tab shell. Agents (Team composition) is
 * owned entirely by `TeamMembersManager` against the membership-only API;
 * Workflow topology is owned entirely by `TeamWorkflowBuilder` against the
 * Draft/Published graph API. This shell carries no save/dirty state of
 * its own -- each tab's mutation flow is independent.
 */
export function TeamWorkflowManager({ team }: { team: Team }) {
  const [activeTab, setActiveTab] = useState("agents");
  const [membershipVersion, setMembershipVersion] = useState(0);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList>
        <TabsTrigger value="agents">Agents</TabsTrigger>
        <TabsTrigger value="workflow">Workflow</TabsTrigger>
      </TabsList>

      <TabsContent value="agents" className="mt-3">
        <TeamMembersManager
          team={team}
          onMembershipChange={() => setMembershipVersion((version) => version + 1)}
        />
      </TabsContent>

      <TabsContent value="workflow" className="mt-3">
        <TeamWorkflowBuilder key={membershipVersion} team={team} />
      </TabsContent>
    </Tabs>
  );
}
