"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BotIcon,
  FolderKanbanIcon,
  LayoutDashboardIcon,
  ListTodoIcon,
  MessageSquareIcon,
  PlayIcon,
  UsersIcon,
} from "lucide-react";

import { HealthStatus } from "@/components/health-status";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const navigation = [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboardIcon,
  },
  {
    title: "Projects",
    url: "/projects",
    icon: FolderKanbanIcon,
  },
  {
    title: "Tasks",
    url: "/tasks",
    icon: ListTodoIcon,
  },
  {
    title: "Runs",
    url: "/runs",
    icon: PlayIcon,
  },
  {
    title: "Teams",
    url: "/teams",
    icon: UsersIcon,
  },
  {
    title: "Agents",
    url: "/agents",
    icon: BotIcon,
  },
  {
    title: "Orchestrator",
    url: "/orchestrator",
    icon: MessageSquareIcon,
  },
];

/**
 * Determines whether a navigation destination owns the current route.
 */
function isNavigationActive(
  pathname: string,
  url: string,
): boolean {
  if (url === "/") {
    return pathname === "/";
  }

  return (
    pathname === url ||
    pathname.startsWith(
      `${url}/`,
    )
  );
}

/**
 * Renders the compact application navigation using the existing shared sidebar primitive.
 */
export function AppSidebar() {
  const pathname =
    usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border p-3">
        <Link
          href="/"
          className="flex h-9 items-center gap-2 rounded-md px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-brand-accent/40 bg-brand-accent/10 text-brand-accent">
            <BotIcon className="size-5" />
          </div>

          <span className="truncate font-heading text-sm font-semibold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            Orchestrator
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="py-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {navigation.map(
                (item) => (
                  <SidebarMenuItem
                    key={
                      item.title
                    }
                  >
                    <SidebarMenuButton
                      isActive={isNavigationActive(
                        pathname,
                        item.url,
                      )}
                      tooltip={
                        item.title
                      }
                      render={
                        <Link
                          href={
                            item.url
                          }
                          aria-current={
                            isNavigationActive(
                              pathname,
                              item.url,
                            )
                              ? "page"
                              : undefined
                          }
                        >
                          <item.icon />
                          <span>
                            {item.title}
                          </span>
                        </Link>
                      }
                    />
                  </SidebarMenuItem>
                ),
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="group-data-[collapsible=icon]:hidden">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">
            System Health
          </p>

          <HealthStatus compact />
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
