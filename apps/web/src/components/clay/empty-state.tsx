import { cn } from "@sightline/ui/lib/utils";
import type { LucideIcon } from "lucide-react";

import { IconTile, type Tone } from "./clay";
import { DotGrid, HalfDisc } from "./memphis";

/** An empty screen is an invitation to act: say what goes here and how to get it. */
export function EmptyState({
  icon,
  tone = "lilac",
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-[1.75rem] clay-sunken px-6 py-12 text-center", className)}>
      <DotGrid className="absolute -top-2 -left-2 text-lilac-ink/15" />
      <HalfDisc className="absolute -right-3 -bottom-1 text-marigold/35" />
      <div className="relative mx-auto flex max-w-sm flex-col items-center">
        <IconTile icon={icon} tone={tone} size="lg" />
        <h2 className="mt-5 text-xl font-bold tracking-tight">{title}</h2>
        {children && <p className="mt-2 text-base leading-relaxed text-muted-foreground">{children}</p>}
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  );
}
