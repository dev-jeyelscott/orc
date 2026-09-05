import type {
  Metadata,
} from "next";
import {
  Inter,
  JetBrains_Mono,
} from "next/font/google";

import {
  AppSidebar,
} from "@/components/app-sidebar";
import {
  IdleRunMonitor,
} from "@/components/idle-run-monitor";
import {
  ThemeProvider,
} from "@/components/theme-provider";
import {
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  cn,
} from "@/lib/utils";

import "@xyflow/react/dist/style.css";
import "./globals.css";

const interSans =
  Inter({
    subsets: [
      "latin",
    ],
    variable:
      "--font-sans",
  });

const interHeading =
  Inter({
    subsets: [
      "latin",
    ],
    variable:
      "--font-heading",
  });

const jetbrainsMono =
  JetBrains_Mono({
    subsets: [
      "latin",
    ],
    variable:
      "--font-mono",
  });

export const metadata:
  Metadata = {
  title:
    "Orchestrator",
  description:
    "AI agent orchestration system",
};

/**
 * Provides the shared theme, persistent idle-run monitor, typography, responsive sidebar, and application content shell.
 */
export default function Layout({
  children,
}: {
  children:
    React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        interSans.variable,
        interHeading.variable,
        jetbrainsMono.variable,
        "font-sans",
      )}
    >
      <body
        className="antialiased"
        suppressHydrationWarning
      >
        <ThemeProvider>
          <SidebarProvider>
            <AppSidebar />

            <IdleRunMonitor />

            <main className="min-w-0 flex-1">
              <div className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b bg-bg-app/95 px-3 backdrop-blur md:hidden">
                <SidebarTrigger />

                <span className="font-heading text-sm font-semibold text-text-primary">
                  Orchestrator
                </span>
              </div>

              <div className="mx-auto flex w-full max-w-[1800px] min-w-0 flex-col px-4 py-5 sm:px-5 lg:px-6 lg:py-6">
                {
                  children
                }
              </div>
            </main>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
