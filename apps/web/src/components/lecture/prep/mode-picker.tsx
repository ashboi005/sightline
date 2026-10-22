"use client";

import type { AccessibilityMode } from "@sightline/contracts";
import { cn } from "@sightline/ui/lib/utils";
import { Ear, Eye } from "lucide-react";

const MODES: { value: AccessibilityMode; title: string; body: string; icon: typeof Eye }[] = [
  {
    value: "DEAF",
    title: "Deaf mode",
    body: "Read the lecture. Captions pause when you look at the board and catch you up after.",
    icon: Eye,
  },
  {
    value: "HARD_OF_HEARING",
    title: "Hard-of-hearing mode",
    body: "Hear the person you look at through your hearing aids, with captions alongside.",
    icon: Ear,
  },
];

/** Deaf / hard-of-hearing as two large choices. Works as a radio group from the keyboard. */
export function ModePicker({
  value,
  onChange,
  disabled,
  compact = false,
}: {
  value: AccessibilityMode;
  onChange: (mode: AccessibilityMode) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className={cn("grid gap-3", !compact && "sm:grid-cols-2")}>
      <legend className="sr-only">Lecture mode</legend>
      {MODES.map((m) => {
        const selected = value === m.value;
        return (
          <label
            key={m.value}
            className={cn(
              "relative flex cursor-pointer gap-3.5 rounded-[1.4rem] p-4 transition-shadow has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:cursor-not-allowed has-disabled:opacity-60",
              selected ? "clay ring-2 ring-marigold" : "bg-muted/70 hover:bg-muted",
            )}
          >
            <input
              type="radio"
              name="lecture-mode"
              value={m.value}
              checked={selected}
              onChange={() => onChange(m.value)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-[0.9rem]", selected ? "clay-marigold" : "bg-card")}
            >
              <m.icon className="size-5" />
            </span>
            <span>
              <span className="block font-bold">{m.title}</span>
              {!compact && <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{m.body}</span>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
