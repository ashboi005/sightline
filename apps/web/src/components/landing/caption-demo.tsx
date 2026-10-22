"use client";

import { cn } from "@sightline/ui/lib/utils";
import { Eye, Presentation } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Formula } from "@/components/formula";

/**
 * A scripted replay of the live workspace: a misheard word is refined in place, a spoken formula
 * becomes maths, and looking at the board freezes the feed and highlights what was said meanwhile.
 *
 * Steps:
 *  1 first line   2 "kerchief's" refined   3 second line   4 spoken formula   5 formula rendered
 *  6 gaze → board 7–8 missed lines         9 gaze → screen, catch-up pill      10 highlights clear
 * 11 fade out, loop
 */
const DURATIONS = [700, 1500, 1500, 1500, 1400, 1700, 1300, 1400, 1700, 2600, 2800, 450];
const REDUCED_MOTION_STEP = 9;

export function CaptionDemo({ className }: { className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? true));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (reduced || !inView) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % DURATIONS.length), DURATIONS[step]);
    return () => clearTimeout(t);
  }, [step, reduced, inView]);

  const s = reduced ? REDUCED_MOTION_STEP : step;
  const lookingAtBoard = s >= 6 && s <= 8;
  const missed = s >= 7 && s <= 9;

  return (
    <figure
      ref={ref}
      className={cn(
        "overflow-hidden rounded-[1.5rem] bg-card text-card-foreground shadow-[var(--clay-sunken)]",
        className,
      )}
    >
      <figcaption className="sr-only">
        Example of Sightline during a lecture on Kirchhoff&apos;s laws. The misheard word
        &quot;kerchief&apos;s&quot; is corrected to Kirchhoff&apos;s, a spoken formula is shown as maths, and
        when the student looks at the board the captions pause and the lines said meanwhile are highlighted.
      </figcaption>

      <div aria-hidden="true">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="relative flex size-2.5 shrink-0">
              <span className="absolute inset-0 animate-ping rounded-full bg-marigold opacity-60 [animation-duration:2s]" />
              <span className="relative size-2.5 rounded-full bg-marigold" />
            </span>
            <span className="truncate text-sm font-semibold">EE101: Kirchhoff&apos;s laws</span>
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors duration-500",
              lookingAtBoard ? "bg-marigold text-[#16181c]" : "bg-muted text-muted-foreground",
            )}
          >
            {lookingAtBoard ? <Presentation className="size-3.5" /> : <Eye className="size-3.5" />}
            {lookingAtBoard ? "Looking at the board" : "Reading captions"}
          </span>
        </div>

        <div
          className={cn(
            "relative flex h-[26rem] flex-col justify-end gap-4 px-4 pt-10 pb-5 transition-opacity duration-400 sm:h-[27rem] sm:px-5",
            "[mask-image:linear-gradient(to_bottom,transparent,black_4.5rem)]",
            s === 11 && "opacity-0",
          )}
        >
          {s >= 1 && (
            <Line time="10:02">
              So today we start with{" "}
              {s >= 2 ? (
                <span key="refined" className="sl-refined">
                  Kirchhoff&apos;s
                </span>
              ) : (
                <span key="raw">kerchief&apos;s</span>
              )}{" "}
              current law.
            </Line>
          )}
          {s >= 3 && <Line time="10:02">The current flowing into a node equals the current flowing out.</Line>}
          {s >= 4 && (
            <Line time="10:03">
              <span className="block">Written as</span>
              {s === 4 ? (
                <span className="mt-1 block text-muted-foreground italic">sigma I in equals sigma I out</span>
              ) : (
                <span className="sl-line-in mt-2 block rounded-lg bg-muted px-3 py-1 text-[1.15em]">
                  <Formula tex="\sum I_{\text{in}} = \sum I_{\text{out}}" display />
                </span>
              )}
            </Line>
          )}
          {s >= 6 && s <= 9 && (
            <div className="sl-line-in flex items-center gap-3 text-xs font-semibold text-marigold-ink">
              <span className="h-px flex-1 border-t-2 border-dashed border-marigold" />
              You looked at the board
              <span className="h-px w-6 border-t-2 border-dashed border-marigold" />
            </div>
          )}
          {s >= 7 && (
            <Line time="10:03" highlighted={missed}>
              Now the voltage law. Around any closed loop, <Formula tex="\sum V = 0" />.
            </Line>
          )}
          {s >= 8 && (
            <Line time="10:04" highlighted={missed}>
              So across each resistor in the loop, <Formula tex="V = IR" />.
            </Line>
          )}

          {s === 9 && (
            <div className="sl-line-in absolute inset-x-0 top-3 flex justify-center">
              <span className="rounded-full bg-foreground px-3.5 py-1.5 text-xs font-semibold text-background shadow-sm">
                You missed 2 lines. They&apos;re highlighted below.
              </span>
            </div>
          )}
        </div>
      </div>
    </figure>
  );
}

function Line({
  time,
  highlighted = false,
  children,
}: {
  time: string;
  highlighted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <p className="sl-line-in grid grid-cols-[2.75rem_1fr] gap-3 sm:grid-cols-[3rem_1fr]">
      <span className="pt-[0.3rem] font-mono text-xs text-muted-foreground tabular-nums">{time}</span>
      <span
        className={cn(
          "-mx-1.5 rounded-md px-1.5 text-lg leading-[1.55] font-medium transition-colors duration-1000 sm:text-xl sm:leading-[1.5]",
          highlighted ? "bg-highlight" : "bg-transparent",
        )}
      >
        {children}
      </span>
    </p>
  );
}
