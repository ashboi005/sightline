"use client";

import type { GlossaryTerm } from "@sightline/contracts";
import { Button } from "@sightline/ui/components/button";
import { cn } from "@sightline/ui/lib/utils";
import { AArrowDown, AArrowUp, Pause, Play, Presentation } from "lucide-react";
import { Fragment, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";

import { useLectureContext } from "@/hooks/use-lecture-data";
import { bookmarkOf, missedCount } from "@/lib/live/gaze-pause";
import { useLiveLecture } from "@/providers/live-lecture-provider";

import { CaptionLine } from "./caption-line";
import { MicrophoneInput } from "./microphone-input";

const SIZES = ["text-xl", "text-2xl", "text-[1.75rem]", "text-[2.125rem]"] as const;
const SIZE_KEY = "sightline.caption-size";

function useCaptionSize() {
  const [size, setSize] = useState(1);
  useEffect(() => {
    const saved = Number(localStorage.getItem(SIZE_KEY));
    if (saved >= 0 && saved < SIZES.length) setSize(saved);
  }, []);
  const change = (delta: number) =>
    setSize((s) => {
      const next = Math.min(SIZES.length - 1, Math.max(0, s + delta));
      try {
        localStorage.setItem(SIZE_KEY, String(next));
      } catch {}
      return next;
    });
  return { size, change };
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The caption reading region. Live: follows the newest line. Frozen (looking at the board, or paused): stays
 * exactly where the student was, keeps collecting, marks where they left, highlights what they missed, and
 * waits for "Resume live".
 */
export function CaptionsView({ className }: { className?: string }) {
  const lecture = useLiveLecture();
  const { live, pause, mode } = lecture;
  const context = useLectureContext(lecture.activeId);
  const glossary = new Map<string, GlossaryTerm>((context.data?.glossary ?? []).map((t) => [t.id, t]));
  const { size, change } = useCaptionSize();
  const scroller = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);

  const segments = live.captions.segments;
  const interim = live.captions.interim;
  const bookmark = bookmarkOf(pause);
  const missed = missedCount(pause, segments.map((s) => s.seq));
  const frozen = pause.kind !== "LIVE";

  const scrollTo = (top: number) => {
    const el = scroller.current;
    if (!el) return;
    programmatic.current = true;
    el.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
    setTimeout(() => (programmatic.current = false), 400);
  };

  // Live: follow the newest caption. Frozen: never move the reader.
  useLayoutEffect(() => {
    if (!frozen && scroller.current) scrollTo(scroller.current.scrollHeight);
  }, [segments.length, interim?.text, frozen]);

  // Back from the board with missed lines: bring the first missed line into view.
  const showFirstMissed = useEffectEvent(() => {
    if (bookmark === null) return;
    const first = scroller.current?.querySelector<HTMLElement>(`[data-seq="${segments.find((s) => s.seq > bookmark)?.seq}"]`);
    if (first) scrollTo(first.offsetTop - 96);
  });
  useEffect(() => {
    if (pause.kind === "CATCH_UP") showFirstMissed();
  }, [pause.kind]);

  // Scrolling up to re-read pauses the feed, so it doesn't snap back to live.
  const onScroll = () => {
    const el = scroller.current;
    if (!el || programmatic.current || frozen) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 120) lecture.pauseCaptions();
  };

  const resume = () => {
    lecture.resumeLive();
    requestAnimationFrame(() => scroller.current && scrollTo(scroller.current.scrollHeight));
  };

  const micNeeded = lecture.needsMicForCaptions && !lecture.mic.mic && !live.isReplay;

  return (
    <section aria-label="Live captions" className={cn("relative flex min-h-0 flex-col rounded-[1.75rem] bg-card shadow-[var(--clay-shadow-sm)]", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 sm:px-5">
        <p className="text-sm font-semibold text-muted-foreground" aria-live="polite">
          {pause.kind === "AWAY" && "Paused while you look away"}
          {pause.kind === "CATCH_UP" && "Catching up"}
          {pause.kind === "MANUAL" && "Paused"}
          {pause.kind === "LIVE" && (live.status === "OPEN" ? "Live" : live.status === "RECONNECTING" ? "Reconnecting…" : "Connecting…")}
        </p>
        <div className="flex items-center gap-1">
          {pause.kind === "LIVE" ? (
            <Button variant="ghost" size="sm" onClick={lecture.pauseCaptions}>
              <Pause /> Pause
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={resume}>
              <Play /> Resume live
            </Button>
          )}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <Button variant="ghost" size="icon-sm" aria-label="Smaller captions" disabled={size === 0} onClick={() => change(-1)}>
            <AArrowDown />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Larger captions" disabled={size === SIZES.length - 1} onClick={() => change(1)}>
            <AArrowUp />
          </Button>
        </div>
      </div>

      {micNeeded && (
        <div className="space-y-3 border-b bg-highlight px-5 py-3">
          <MicrophoneInput />
          <Button variant="clay" size="sm" disabled={!lecture.mic.deviceId || lecture.mic.busy} onClick={() => void lecture.mic.start()}>
            {lecture.mic.busy ? "Starting microphone…" : "Turn on microphone"}
          </Button>
        </div>
      )}

      <div
        ref={scroller}
        onScroll={onScroll}
        tabIndex={0}
        aria-label="Caption history"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-6"
      >
        {segments.length === 0 && !interim ? (
          <p className="py-16 text-center text-lg text-muted-foreground">
            {live.status === "OPEN" ? "Waiting for the teacher to speak…" : "Connecting to the lecture…"}
          </p>
        ) : (
          <ol className={cn("space-y-4 leading-[1.5] font-medium", SIZES[size])}>
            {segments.map((segment) => (
              <Fragment key={segment.id}>
                <CaptionLine segment={segment} glossary={glossary} missed={bookmark !== null && segment.seq > bookmark} />
                {bookmark !== null && segment.seq === bookmark && (
                  <li aria-hidden="true" className="flex items-center gap-3 py-1 text-sm font-bold text-marigold-ink">
                    <span className="h-0 flex-1 border-t-2 border-dashed border-marigold" />
                    {pause.kind === "MANUAL" ? "You paused here" : "You looked away here"}
                    <span className="h-0 w-8 border-t-2 border-dashed border-marigold" />
                  </li>
                )}
              </Fragment>
            ))}
            {interim && (
              <li className="grid grid-cols-[3.25rem_1fr] gap-3" aria-hidden="true">
                <span />
                <p className="text-muted-foreground italic">{interim.text}…</p>
              </li>
            )}
          </ol>
        )}
      </div>

      {frozen && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
          <div role="status" className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-full bg-foreground py-2 pr-2 pl-4 text-background shadow-lg">
            {pause.kind === "AWAY" && <Presentation aria-hidden="true" className="size-4" />}
            <span className="text-sm font-bold">
              {pause.kind === "AWAY" && (mode === "DEAF" ? `Looking away · ${missed} new` : "Paused")}
              {pause.kind === "CATCH_UP" && `You missed ${missed} line${missed === 1 ? "" : "s"}. They're highlighted.`}
              {pause.kind === "MANUAL" && (missed ? `${missed} new line${missed === 1 ? "" : "s"} below` : "Paused")}
            </span>
            {pause.kind !== "AWAY" && (
              <Button variant="clay" size="sm" onClick={resume}>
                Resume live
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
