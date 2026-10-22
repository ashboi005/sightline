"use client";

import { cn } from "@sightline/ui/lib/utils";
import { Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Formula } from "@/components/formula";

const STEPS = [
  {
    title: "Before class",
    body: "Look at a few dots to calibrate the eye tracker. Add the lecture slides, or type what today's class covers.",
    visual: <CalibrationVisual />,
  },
  {
    title: "During the lecture",
    body: "Read live captions and look at the board whenever you need to. Switch between Deaf and hard-of-hearing mode without stopping.",
    visual: <CaptionsVisual />,
  },
  {
    title: "When you have a question",
    body: "Sign it at your webcam. Sightline turns your signs into a sentence and speaks it for the class.",
    visual: <SignVisual />,
  },
  {
    title: "After class",
    body: "Press End lecture. Your notes arrive with the formulas, definitions and board diagrams in place.",
    visual: <NotesVisual />,
  },
];

export function LectureFlow() {
  const ref = useRef<HTMLOListElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section id="how-it-works" className="scroll-mt-28">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <h2 className="max-w-2xl text-[clamp(2rem,1.5rem+2vw,3rem)] leading-[1.08] font-bold tracking-[-0.025em] text-balance">
          One lecture, start to finish
        </h2>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
          No setup for the teacher. You open Sightline on your laptop and it works alongside the class.
        </p>

        <ol ref={ref} data-visible={visible} className="relative mt-14 grid gap-12 md:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          <span
            aria-hidden="true"
            className="sl-draw absolute top-[1.125rem] right-[12.5%] left-[12.5%] hidden h-0.5 rounded-full bg-marigold lg:block"
          />
          {STEPS.map((step, i) => (
            <li key={step.title} className="relative flex min-w-0 flex-col rounded-[1.75rem] clay p-5">
              <span className="relative z-10 flex size-11 items-center justify-center self-start rounded-2xl clay-marigold text-base font-bold tabular-nums">
                {i + 1}
              </span>
              <div className="mt-5 flex h-44 items-center justify-center overflow-hidden rounded-2xl bg-card p-3 shadow-[var(--clay-sunken)]">
                {step.visual}
              </div>
              <h3 className="mt-6 text-xl font-bold tracking-tight">{step.title}</h3>
              <p className="mt-2 text-base leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function CalibrationVisual() {
  const dots = [
    [12, 16],
    [50, 16],
    [88, 16],
    [12, 50],
    [50, 50],
    [88, 50],
    [12, 84],
    [50, 84],
    [88, 84],
  ];
  return (
    <div aria-hidden="true" className="relative h-full w-full rounded-lg bg-muted/60">
      {dots.map(([x, y], i) => (
        <span
          key={`${x}-${y}`}
          className={cn(
            "absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
            i < 5 ? "bg-foreground/25" : "bg-foreground/10",
          )}
          style={{ left: `${x}%`, top: `${y}%` }}
        />
      ))}
      <span
        className="absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-marigold ring-6 ring-marigold/25"
        style={{ left: "88%", top: "50%" }}
      />
      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-card px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap shadow-xs">
        6 of 9
      </span>
    </div>
  );
}

function CaptionsVisual() {
  return (
    <div aria-hidden="true" className="w-full space-y-2 text-sm leading-snug font-medium">
      <p className="text-muted-foreground">The current into a node equals the current out.</p>
      <div className="flex items-center gap-2 text-[0.7rem] font-semibold text-marigold-ink">
        <span className="flex-1 border-t-2 border-dashed border-marigold" />
        Board
      </div>
      <p className="-mx-1 rounded bg-highlight px-1">
        Around any loop, <Formula tex="\sum V = 0" />.
      </p>
      <p className="-mx-1 rounded bg-highlight px-1">
        Across each resistor, <Formula tex="V = IR" />.
      </p>
    </div>
  );
}

function SignVisual() {
  return (
    <div aria-hidden="true" className="w-full space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {["PLEASE", "REPEAT", "FORMULA"].map((g) => (
          <span key={g} className="rounded-md border bg-muted px-2 py-0.5 font-mono text-xs font-semibold">
            {g}
          </span>
        ))}
      </div>
      <div className="flex items-start gap-2.5 rounded-lg bg-foreground p-3 text-background">
        <Volume2 className="mt-0.5 size-4 shrink-0 text-marigold" />
        <p className="text-sm leading-snug font-semibold">Could you please repeat the formula?</p>
      </div>
    </div>
  );
}

function NotesVisual() {
  return (
    <div aria-hidden="true" className="w-full space-y-2">
      <p className="text-sm font-bold">Kirchhoff&apos;s voltage law</p>
      <p className="text-xs leading-snug text-muted-foreground">
        The sum of voltages around any closed loop is zero.
      </p>
      <div className="rounded-md bg-muted py-2 text-center">
        <Formula tex="\textstyle\sum_{k} V_k = 0" />
      </div>
      <p className="border-l-2 border-marigold pl-2 text-xs font-semibold">Board diagram: two-loop circuit</p>
    </div>
  );
}
