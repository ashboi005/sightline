import { cn } from "@sightline/ui/lib/utils";

// Restrained Memphis accents for welcome areas and empty states only; never behind reading content.

export function Squiggle({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 120 24" fill="none" className={cn("h-6 w-30", className)}>
      <path d="M2 12c10-12 20 12 30 0s20 12 30 0 20 12 30 0 16 10 26 0" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

export function DotGrid({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 60 60" className={cn("size-15", className)}>
      {[0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3].map((c) => <circle key={`${r}${c}`} cx={7 + c * 15} cy={7 + r * 15} r="3.5" fill="currentColor" />))}
    </svg>
  );
}

export function HalfDisc({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 80 40" className={cn("h-10 w-20", className)}>
      <path d="M0 40a40 40 0 0 1 80 0Z" fill="currentColor" />
    </svg>
  );
}

/** The Sightline motif: a gaze point resting on a line of text. */
export function GazeLine({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 140 40" fill="none" className={cn("h-10 w-35", className)}>
      <rect x="4" y="26" width="132" height="8" rx="4" className="fill-foreground/80" />
      <circle cx="96" cy="13" r="10" className="fill-marigold" />
    </svg>
  );
}
