"use client";

import { Button } from "@sightline/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@sightline/ui/components/dialog";
import { cn } from "@sightline/ui/lib/utils";
import { Menu } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Logo } from "@/components/brand/logo";
import { StatusPill } from "@/components/clay/clay";
import { useLiveLecture } from "@/providers/live-lecture-provider";

import { WorkspaceBackdrop } from "./backdrop";
import { SidebarContent } from "./sidebar";

const COLLAPSED_KEY = "sightline.sidebar-collapsed";

/** Desktop sidebar: full, or an icon rail. Remembered per browser. */
function useCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {}
  }, []);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });
  return { collapsed, toggle };
}

/**
 * Workspace frame: a floating clay sidebar on wide screens (collapsible to an icon rail); a top bar with a drawer
 * below `lg`. The running lecture stays visible either way.
 */
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { collapsed, toggle } = useCollapsed();
  const lecture = useLiveLecture();
  const pathname = usePathname();
  const lectureHref = `/lecture/${lecture.activeId}` as Route;

  return (
    <div
      className={cn(
        "relative isolate min-h-svh bg-background lg:grid lg:transition-[grid-template-columns] lg:duration-300 motion-reduce:transition-none",
        collapsed ? "lg:grid-cols-[6rem_minmax(0,1fr)]" : "lg:grid-cols-[18rem_minmax(0,1fr)]",
      )}
    >
      <WorkspaceBackdrop />
      <a
        href="#main"
        className="sr-only z-50 rounded-xl bg-primary px-4 py-2 font-bold text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside id="workspace-sidebar" aria-label="Sidebar" className="sticky top-0 hidden h-svh p-3 lg:block">
        <div className="h-full overflow-x-hidden overflow-y-auto rounded-[2rem] clay">
          <SidebarContent collapsed={collapsed} onToggle={toggle} />
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/90 px-3 py-2.5 backdrop-blur-md lg:hidden">
        <Button variant="clay-soft" size="icon-lg" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}>
          <Menu />
        </Button>
        <Link href="/dashboard" className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo />
        </Link>
        {lecture.activeId && pathname !== lectureHref && (
          <Link href={lectureHref} className="ml-auto rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <StatusPill kind="live">Return to lecture</StatusPill>
          </Link>
        )}
      </header>

      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent side="left" aria-label="Navigation">
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <SidebarContent onNavigate={() => setDrawerOpen(false)} />
        </DialogContent>
      </Dialog>

      <main id="main" className="min-w-0 px-4 py-6 sm:px-6 lg:py-8 lg:pr-10 lg:pl-6">
        {children}
      </main>
    </div>
  );
}
