"use client";

import type { CaptionSegment, GlossaryTerm } from "@sightline/contracts";
import { Input } from "@sightline/ui/components/input";
import { cn } from "@sightline/ui/lib/utils";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CaptionText } from "@/components/lecture/caption-text";
import { activeCaptionIndex, formatClock } from "@/lib/recordings/timeline";

/** Timestamped transcript: highlights what's playing, jumps on a timestamp click, and searches. */
export function TranscriptList({
  segments,
  glossary,
  lectureMs,
  canSeek,
  onSeek,
}: {
  segments: CaptionSegment[];
  glossary: Map<string, GlossaryTerm>;
  lectureMs: number | null;
  canSeek: boolean;
  onSeek: (ms: number) => void;
}) {
  const [query, setQuery] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const active = lectureMs === null ? -1 : activeCaptionIndex(segments, lectureMs);
  const q = query.trim().toLowerCase();
  const shown = q ? segments.filter((s) => s.text.toLowerCase().includes(q) || s.rawText.toLowerCase().includes(q)) : segments;

  // Keep the playing line in view while not searching.
  useEffect(() => {
    if (q || active < 0) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, q]);

  return (
    <div>
      <div className="relative">
        <Search aria-hidden="true" className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the transcript"
          aria-label="Search the transcript"
          className="pl-10"
        />
      </div>
      {q && (
        <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
          {shown.length} line{shown.length === 1 ? "" : "s"} mention &ldquo;{query.trim()}&rdquo;
        </p>
      )}
      <ol ref={list} className="mt-3 max-h-[32rem] space-y-1 overflow-y-auto pr-1">
        {shown.map((s) => {
          const i = segments.indexOf(s);
          const playing = i === active;
          return (
            <li
              key={s.id}
              data-index={i}
              aria-current={playing ? "true" : undefined}
              className={cn("grid grid-cols-[4rem_1fr] gap-3 rounded-xl px-2 py-2 text-[1.0625rem] leading-relaxed transition-colors", playing && "bg-highlight")}
            >
              <button
                type="button"
                onClick={() => onSeek(s.startMs)}
                aria-label={canSeek ? `Play from ${formatClock(s.startMs)}` : `Mark ${formatClock(s.startMs)}`}
                className="h-fit rounded-lg px-1.5 py-0.5 font-mono text-sm text-marigold-ink tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                {formatClock(s.startMs)}
              </button>
              <p>
                <CaptionText parts={s.parts} glossary={glossary} />
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
