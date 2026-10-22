import { Captions, Clapperboard, Hand, LayoutDashboard, NotebookText, ScanEye, type LucideIcon } from "lucide-react";

import type { Tone } from "@/components/clay/clay";

export type NavItem = {
  /** Base path; detail routes (`/notes/ses_…`) count as this destination. */
  href: "/dashboard" | "/setup" | "/lecture" | "/recordings" | "/notes" | "/sign";
  label: string;
  icon: LucideIcon;
  tone: Tone;
};

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, tone: "marigold" },
  { href: "/setup", label: "Setup", icon: ScanEye, tone: "sage" },
  { href: "/lecture", label: "Live lecture", icon: Captions, tone: "marigold" },
  { href: "/recordings", label: "Recorded lectures", icon: Clapperboard, tone: "lilac" },
  { href: "/notes", label: "Notes", icon: NotebookText, tone: "sage" },
  { href: "/sign", label: "Sign language", icon: Hand, tone: "lilac" },
];

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);
