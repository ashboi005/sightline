"use client";

import type { CaptionSegment, GlossaryTerm } from "@sightline/contracts";
import { cn } from "@sightline/ui/lib/utils";
import { memo, useEffect, useRef, useState } from "react";

import { CaptionText } from "@/components/lecture/caption-text";
import { formatClock } from "@/lib/recordings/timeline";

/** One committed caption. When it changes FINAL → REFINED in front of the reader, the corrected words underline. */
export const CaptionLine = memo(function CaptionLine({
  segment,
  glossary,
  missed,
}: {
  segment: CaptionSegment;
  glossary: Map<string, GlossaryTerm>;
  missed: boolean;
}) {
  const previous = useRef(segment.status);
  const [justRefined, setJustRefined] = useState(false);

  useEffect(() => {
    if (previous.current === "FINAL" && segment.status === "REFINED") {
      setJustRefined(true);
      const t = setTimeout(() => setJustRefined(false), 3000);
      previous.current = segment.status;
      return () => clearTimeout(t);
    }
    previous.current = segment.status;
  }, [segment.status]);

  return (
    <li data-seq={segment.seq} className="sl-line-in grid grid-cols-[3.25rem_1fr] gap-3">
      <span className="pt-[0.45em] font-mono text-xs text-muted-foreground tabular-nums" aria-hidden="true">
        {formatClock(segment.startMs)}
      </span>
      <p className={cn("-mx-2 rounded-lg px-2 transition-colors duration-700 motion-reduce:transition-none", missed && "bg-highlight")}>
        {missed && <span className="sr-only">Missed while you were looking away: </span>}
        <CaptionText parts={segment.parts} glossary={glossary} animateCorrections={justRefined} />
      </p>
    </li>
  );
});
