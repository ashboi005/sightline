import { DotGrid, HalfDisc, Squiggle } from "@/components/clay/memphis";

/**
 * The workspace's background: a faint chalk-dot texture, soft colour washes in the corners, and a few Memphis
 * shapes kept to the edges. It sits behind every card, so reading surfaces (captions, notes, transcripts) stay
 * solid and nothing decorative ever runs under text.
 */
export function WorkspaceBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Chalk-paper texture */}
      <div className="absolute inset-0 bg-[radial-gradient(color-mix(in_oklab,var(--foreground)_7%,transparent)_1px,transparent_1.2px)] [background-size:22px_22px]" />

      {/* Colour washes in the corners */}
      <div className="absolute -top-40 -right-32 size-[34rem] rounded-full bg-lilac opacity-70 blur-3xl dark:opacity-40" />
      <div className="absolute -bottom-48 -left-24 size-[36rem] rounded-full bg-sage opacity-80 blur-3xl dark:opacity-40" />
      <div className="absolute top-1/3 -right-40 size-[22rem] rounded-full bg-marigold/15 blur-3xl" />

      {/* Memphis shapes, tucked into the corners and margins */}
      <svg viewBox="0 0 200 200" className="absolute -top-16 -right-16 size-64 text-lilac-ink/25">
        <circle cx="100" cy="100" r="72" fill="none" stroke="currentColor" strokeWidth="14" strokeDasharray="2 22" strokeLinecap="round" />
      </svg>
      <Squiggle className="absolute top-24 right-[18%] h-8 w-40 text-marigold/50" />
      <svg viewBox="0 0 40 40" className="absolute top-[42%] right-6 size-7 text-sage-ink/35">
        <path d="M20 4v32M4 20h32" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      </svg>
      <HalfDisc className="absolute right-6 -bottom-3 h-14 w-28 text-marigold/40" />
      <svg viewBox="0 0 60 60" className="absolute right-[34%] bottom-10 size-10 text-lilac-ink/30">
        <path d="M30 6 54 50H6Z" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
      </svg>
      <DotGrid className="absolute bottom-24 left-[22rem] size-20 text-sage-ink/30" />
      <svg viewBox="0 0 120 120" className="absolute -bottom-10 left-[40%] size-36 text-lilac-ink/20">
        <circle cx="60" cy="60" r="44" fill="none" stroke="currentColor" strokeWidth="10" />
      </svg>
    </div>
  );
}
