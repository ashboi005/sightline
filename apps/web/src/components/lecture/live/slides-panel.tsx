"use client";

import { Button } from "@sightline/ui/components/button";
import { cn } from "@sightline/ui/lib/utils";
import { ChevronLeft, ChevronRight, LocateFixed } from "lucide-react";
import { useState } from "react";

import { StatusPill } from "@/components/clay/clay";
import { useSlides } from "@/hooks/use-lecture-data";
import { assetUrl } from "@/lib/api";
import { useLiveLecture } from "@/providers/live-lecture-provider";

/** Follows the teacher's slide and bullet (`slide.pointer`); browsing manually stops following until asked. */
export function SlidesPanel() {
  const lecture = useLiveLecture();
  const slides = useSlides(lecture.activeId);
  const [manual, setManual] = useState<number | null>(null);
  const deck = slides.data;
  const pointer = lecture.live.slidePointer;

  if (!deck || deck.status !== "READY" || deck.slides.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {deck?.status === "PROCESSING" ? "The slides are still being read…" : "No slides for this lecture. Add them before the next one to follow along here."}
      </p>
    );
  }

  const following = manual === null;
  const index = Math.min(deck.slides.length - 1, following ? (pointer?.slideIndex ?? 0) : manual);
  const slide = deck.slides[index]!;
  const highlighted = following && pointer?.slideIndex === index ? pointer.bulletIndex : null;
  const go = (delta: number) => setManual(Math.min(deck.slides.length - 1, Math.max(0, index + delta)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {following ? (
          <StatusPill kind="ready" icon={LocateFixed}>
            Following the teacher
          </StatusPill>
        ) : (
          <Button variant="clay" size="sm" onClick={() => setManual(null)}>
            <LocateFixed /> Back to the teacher&apos;s slide
          </Button>
        )}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Previous slide" disabled={index === 0} onClick={() => go(-1)}>
            <ChevronLeft />
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {index + 1} / {deck.slides.length}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Next slide" disabled={index === deck.slides.length - 1} onClick={() => go(1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
      <img src={assetUrl(slide.imageUrl)} alt={slide.title ?? `Slide ${index + 1}`} className="aspect-video w-full rounded-2xl border bg-white object-contain" />
      {slide.bullets.length > 0 && (
        <ul className="space-y-1 text-sm">
          {slide.bullets.map((b) => (
            <li
              key={b.index}
              aria-current={highlighted === b.index ? "true" : undefined}
              className={cn("rounded-lg px-2 py-1 transition-colors", highlighted === b.index ? "bg-highlight font-semibold" : "text-muted-foreground")}
            >
              {b.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
