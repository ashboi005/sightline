"use client";

import type { CaptionPart, GlossaryTerm } from "@sightline/contracts";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@sightline/ui/components/popover";
import { cn } from "@sightline/ui/lib/utils";

import { Formula } from "@/components/formula";

/**
 * One caption's parts: plain text, glossary terms (tap for the definition and what speech-to-text first heard),
 * and formulas rendered with KaTeX (BLOCK formulas on their own line, with the spoken words as their label).
 */
export function CaptionText({
  parts,
  glossary,
  animateCorrections = false,
}: {
  parts: CaptionPart[];
  glossary?: Map<string, GlossaryTerm>;
  /** Draw the marigold underline under corrected words (only for a freshly refined caption). */
  animateCorrections?: boolean;
}) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === "text") return <span key={i}>{part.text}</span>;
        if (part.type === "formula") {
          return part.display === "BLOCK" ? (
            <span key={i} role="img" aria-label={part.spoken} className="my-2 block rounded-xl bg-muted/70 px-3 py-1 text-[1.05em]">
              <Formula tex={part.latex} display />
            </span>
          ) : (
            <span key={i} role="img" aria-label={part.spoken} className="whitespace-nowrap">
              <Formula tex={part.latex} />
            </span>
          );
        }
        const term = part.glossaryTermId ? glossary?.get(part.glossaryTermId) : undefined;
        const corrected = part.original !== null && part.original.toLowerCase() !== part.text.toLowerCase();
        if (!term && !corrected) return <span key={i}>{part.text}</span>;
        return (
          <Popover key={i}>
            <PopoverTrigger
              render={<span />}
              nativeButton={false}
              className={cn(
                "cursor-help rounded-sm underline decoration-marigold decoration-dotted decoration-2 underline-offset-[0.2em] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                corrected && animateCorrections && "sl-refined",
              )}
              tabIndex={0}
            >
              {part.text}
            </PopoverTrigger>
            <PopoverContent>
              <PopoverTitle className="font-bold">{term?.term ?? part.text}</PopoverTitle>
              {term?.definition && <PopoverDescription className="mt-1 leading-relaxed text-muted-foreground">{term.definition}</PopoverDescription>}
              {corrected && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Speech-to-text first heard <span className="font-semibold text-foreground">&ldquo;{part.original}&rdquo;</span>
                </p>
              )}
            </PopoverContent>
          </Popover>
        );
      })}
    </>
  );
}
