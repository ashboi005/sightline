"use client";

import { Button } from "@sightline/ui/components/button";
import { cn } from "@sightline/ui/lib/utils";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo, LogoMark } from "@/components/brand/logo";
import type { Tone } from "@/components/clay/clay";
import { useLiveLecture } from "@/providers/live-lecture-provider";

import { SceneCameraCard } from "./scene-camera-card";
import { AccountFooter } from "./account-footer";
import { ActiveLectureCard } from "./active-lecture-card";
import { EnvironmentBadge } from "./environment-badge";
import { NAV, isActive } from "./nav";
import { RailTip } from "./rail-tip";

/** Each destination keeps its tone: tinted icon at rest, tinted row on hover, tone clay when it's the current page. */
const navTone: Record<Tone, { active: string; hover: string; ink: string }> = {
  plain: { active: "clay-sm", hover: "hover:bg-foreground/5", ink: "text-foreground" },
  marigold: {
    active: "bg-[color-mix(in_oklch,var(--marigold)_26%,var(--card))] shadow-[var(--clay-shadow-sm)]",
    hover: "hover:bg-marigold/12",
    ink: "text-marigold-ink",
  },
  sage: { active: "clay-sage", hover: "hover:bg-sage/70", ink: "text-sage-ink" },
  lilac: { active: "clay-lilac", hover: "hover:bg-lilac/70", ink: "text-lilac-ink" },
};

/**
 * The sidebar's contents, shared by the desktop sidebar and the mobile drawer. `collapsed` shows icons only;
 * `onToggle` adds the collapse/expand control (desktop only).
 */
export function SidebarContent({
  collapsed = false,
  onToggle,
  onNavigate,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const lecture = useLiveLecture();

  return (
    <div className={cn("flex h-full flex-col gap-5", collapsed ? "items-center px-2.5 py-4" : "p-4")}>
      <div className={cn("flex w-full shrink-0 items-center gap-2", collapsed ? "flex-col" : "justify-between")}>
        <Link
          href="/dashboard"
          onClick={onNavigate}
          aria-label={collapsed ? "Sightline dashboard" : undefined}
          className="rounded-xl px-1.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {collapsed ? <LogoMark /> : <Logo />}
        </Link>
        {onToggle && (
          <RailTip label="Expand sidebar" show={collapsed}>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              aria-controls="workspace-sidebar"
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
          </RailTip>
        )}
      </div>

      <nav aria-label="Workspace" className={cn("min-h-0 overflow-y-auto", collapsed ? "w-full" : "-mx-1")}>
        <ul className="space-y-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const live = item.href === "/lecture" && Boolean(lecture.activeId);
            // While a lecture runs, "Live lecture" goes straight to it.
            const href = (live ? `/lecture/${lecture.activeId}` : item.href) as Route;
            const tone = navTone[item.tone];
            return (
              <li key={item.href} className={cn(collapsed && "flex justify-center")}>
                <RailTip label={live ? `${item.label} (live now)` : item.label} show={collapsed}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? (live ? `${item.label}, live now` : item.label) : undefined}
                    className={cn(
                      "group relative flex min-h-12 items-center gap-3 rounded-[1.1rem] text-[0.95rem] outline-none transition-[background,box-shadow] focus-visible:ring-2 focus-visible:ring-ring",
                      collapsed ? "size-12 justify-center" : "px-2 py-1.5",
                      active ? cn(tone.active, "font-bold text-foreground") : cn(tone.hover, "font-semibold text-muted-foreground hover:text-foreground"),
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-xl", tone.ink, active && "clay-sm")}
                    >
                      <item.icon className="size-4" />
                    </span>
                    {collapsed ? (
                      live && (
                        <span aria-hidden="true" className="absolute top-1.5 right-1.5 flex size-2.5">
                          <span className="absolute inset-0 animate-ping rounded-full bg-live opacity-60 motion-reduce:hidden" />
                          <span className="relative size-2.5 rounded-full bg-live ring-2 ring-card" />
                        </span>
                      )
                    ) : (
                      <>
                        <span className="flex-1">{item.label}</span>
                        {live && <span className="rounded-full bg-live px-1.5 py-0.5 text-[0.65rem] font-extrabold tracking-wide text-white">LIVE</span>}
                      </>
                    )}
                  </Link>
                </RailTip>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={cn("mt-auto shrink-0 space-y-3", collapsed && "flex w-full flex-col items-center")}>
        <ActiveLectureCard onNavigate={onNavigate} collapsed={collapsed} />
        <EnvironmentBadge collapsed={collapsed} />
        <SceneCameraCard collapsed={collapsed} onNavigate={onNavigate} />
        <AccountFooter collapsed={collapsed} />
      </div>
    </div>
  );
}
