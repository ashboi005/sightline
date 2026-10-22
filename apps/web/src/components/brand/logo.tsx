import { cn } from "@sightline/ui/lib/utils";

/** The mark: a gaze point resting on a line of text. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7", className)}>
      <rect width="32" height="32" rx="8" className="fill-foreground" />
      <rect x="7" y="19" width="18" height="2.5" rx="1.25" className="fill-background" />
      <circle cx="19" cy="12.5" r="4" className="fill-marigold" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-lg font-bold tracking-tight">Sightline</span>
    </span>
  );
}
