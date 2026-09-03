import { Bot, FolderKanban, LayoutDashboard, ListTodo, Play } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

const topItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Projects", url: "/projects", icon: FolderKanban },
];

const taskItems = [
  { title: "Runs", url: "/runs", icon: Play },
  { title: "Agents", url: "/agents", icon: Bot },
];

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {topItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    render={
                      <a href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </a>
                    }
                  />
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={
                    <a href="/tasks">
                      <ListTodo />
                      <span>Tasks</span>
                    </a>
                  }
                />
                <SidebarMenuSub>
                  {taskItems.map((item) => (
                    <SidebarMenuSubItem key={item.title}>
                      <SidebarMenuSubButton
                        render={
                          <a href={item.url}>
                            <item.icon />
                            <span>{item.title}</span>
                          </a>
                        }
                      />
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
