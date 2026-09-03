import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

import "./globals.css";
import { cn } from "@/lib/utils";

const interSans = Inter({ subsets: ["latin"], variable: "--font-sans" });

const interHeading = Inter({ subsets: ["latin"], variable: "--font-heading" });

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "orc",
  description: "orc",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        interSans.variable,
        interHeading.variable,
        jetbrainsMono.variable,
        "font-sans"
      )}
    >
      <body className="antialiased">
        <ThemeProvider>
          <SidebarProvider>
            <AppSidebar />
            <main className="w-full">
              <SidebarTrigger />
              <div className="mx-auto flex max-w-[1600px] flex-col px-6 py-8">
                {children}
              </div>
            </main>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
