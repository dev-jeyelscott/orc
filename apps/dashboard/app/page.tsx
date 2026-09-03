import { AlertTriangleIcon, InboxIcon } from "lucide-react";

import { AgentDetailPanel } from "@/components/agent-detail-panel";
import { ContextUsage } from "@/components/context-usage";
import { FileTable } from "@/components/file-table";
import { HealthStatus } from "@/components/health-status";
import { MetricCard } from "@/components/metric-card";
import { TerminalPanel } from "@/components/terminal-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { Timeline } from "@/components/timeline";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkflowLayerItem } from "@/components/workflow-layer-item";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-heading text-lg font-semibold text-text-primary">
      {children}
    </h2>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col gap-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            Orchestrator
          </h1>
          <p className="text-sm text-text-muted">Design system showcase</p>
        </div>
        <div className="flex items-center gap-3">
          <HealthStatus />
          <ThemeToggle />
        </div>
      </header>

      <section className="flex flex-col gap-4">
        <SectionTitle>Components</SectionTitle>

        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="outline">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Delete</Button>
          <Button disabled>Disabled</Button>
        </div>

        <div className="flex max-w-sm flex-col gap-2">
          <Input placeholder="Type to search..." />
          <Input placeholder="Disabled input" disabled />
        </div>

        <Tabs defaultValue="activity" className="max-w-md">
          <TabsList>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          </TabsList>
          <TabsContent value="activity">Activity content</TabsContent>
          <TabsContent value="events">Events content</TabsContent>
          <TabsContent value="artifacts">Artifacts content</TabsContent>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="running">Running</Badge>
          <Badge variant="success">Completed</Badge>
          <Badge variant="warning">Waiting</Badge>
          <Badge variant="error">High</Badge>
          <Badge variant="neutral">Neutral</Badge>
          <Badge variant="disabled">Disabled</Badge>
        </div>

        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/projects">Projects</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/projects/shop-portal">shop-portal</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Tasks</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Card Title</CardTitle>
              <CardDescription>
                Brief description of the card content goes here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="link" className="h-auto p-0">
                Action
              </Button>
            </CardContent>
          </Card>

          <MetricCard
            label="Tokens Used"
            value="241k"
            delta={{ value: "+12.4% vs last run", direction: "up" }}
          />

          <Card>
            <CardHeader>
              <CardTitle>Context Usage</CardTitle>
            </CardHeader>
            <CardContent>
              <ContextUsage
                label="Current Context"
                percent={63}
                current="241k"
                total="360k"
              />
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle>Pattern Library</SectionTitle>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Workflow / Layer Item</CardTitle>
            </CardHeader>
            <CardContent>
              <WorkflowLayerItem layer={1} role="Architect" harness="Codex" status="completed" />
              <WorkflowLayerItem layer={2} role="Frontend Engineer" harness="Codex" status="completed" />
              <WorkflowLayerItem layer={3} role="Backend Engineer" harness="Claude" status="running" />
              <WorkflowLayerItem
                layer={4}
                role="Documenter"
                harness="Codex"
                status="waiting"
                isLast
              />
            </CardContent>
          </Card>

          <TerminalPanel
            title="Backend Engineer Terminal"
            lines={[
              { type: "command", text: "pnpm test --filter=checkout" },
              { type: "pass", text: "src/api/checkout.ts" },
              { type: "pass", text: "src/services/retry-policy.test.ts" },
              { type: "status", text: "Running integration checks..." },
              { type: "status", text: "✓ All checks passed" },
              { type: "prompt", text: "" },
            ]}
          />

          <Card>
            <CardHeader>
              <CardTitle>Table / List Row</CardTitle>
            </CardHeader>
            <CardContent>
              <FileTable
                files={[
                  { name: "plan.json", size: "2.1 KB", updated: "20m ago" },
                  { name: "handoff.json", size: "3.4 KB", updated: "15m ago" },
                  { name: "retry-policy.ts", size: "2.6 KB", updated: "7m ago", status: "TS" },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline / Activity Entry</CardTitle>
            </CardHeader>
            <CardContent>
              <Timeline
                entries={[
                  { timestamp: "18m ago", description: "Architect completed", status: "success" },
                  { timestamp: "15m ago", description: "Frontend Engineer changes implementation", status: "success" },
                  { timestamp: "7m ago", description: "pnpm test running", status: "progress" },
                  { timestamp: "Now", description: "pnpm test running", status: "pending" },
                ]}
              />
            </CardContent>
          </Card>

          <AgentDetailPanel
            title="Backend Engineer"
            fields={[
              { label: "Role", value: "Backend Engineer" },
              { label: "Layer", value: "Layer 2" },
              { label: "Harness", value: "Claude" },
              { label: "Model", value: "Opus" },
              { label: "Reasoning", value: "High" },
              { label: "PID", value: "74231" },
              { label: "CPU", value: "23.4%" },
              { label: "Memory", value: "512 MB" },
            ]}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle>Component States</SectionTitle>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InboxIcon />
              </EmptyMedia>
              <EmptyTitle>No data available</EmptyTitle>
              <EmptyDescription>Start a run to see results here.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm">Run Now</Button>
            </EmptyContent>
          </Empty>

          <Empty className="border">
            <Spinner className="size-6" />
            <EmptyTitle>Loading...</EmptyTitle>
          </Empty>

          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center">
            <span className="text-sm font-medium text-text-primary">Disabled State</span>
            <Input placeholder="Disabled input" disabled className="max-w-40" />
          </div>

          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="bg-status-error/10 text-status-error">
                <AlertTriangleIcon />
              </EmptyMedia>
              <EmptyTitle>Failed to load data</EmptyTitle>
              <EmptyDescription>Please try again.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" variant="destructive">
                Retry
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      </section>
    </div>
  );
}
