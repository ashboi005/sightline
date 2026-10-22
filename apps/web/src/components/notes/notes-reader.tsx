"use client";

import type { LectureNotes, NoteBlock, NoteSection } from "@sightline/contracts";
import { cn } from "@sightline/ui/lib/utils";
import { Lightbulb, Presentation, TriangleAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { Formula } from "@/components/formula";
import { assetUrl } from "@/lib/api";
import { formatClock } from "@/lib/recordings/timeline";
import { formatWhen } from "@/lib/format";

type SourceLinker = {
  /** Lecture time (ms) of each caption segment, to turn a section's sources into a jump link. */
  segmentTimes: Map<string, number>;
  /** Where a jump to `ms` goes, e.g. the recording at that moment. */
  href: (ms: number) => string;
};

function Block({ block }: { block: NoteBlock }) {
  switch (block.type) {
    case "paragraph":
      return <p>{block.text}</p>;
    case "bullets":
      return (
        <ul className="list-disc space-y-1.5 pl-6 marker:text-marigold-ink">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "definition":
      return (
        <div className="rounded-2xl bg-sage/60 px-4 py-3">
          <dt className="font-bold">{block.term}</dt>
          <dd className="mt-0.5">{block.definition}</dd>
        </div>
      );
    case "formula":
      return (
        <figure className="rounded-2xl bg-muted/60 px-4 py-2">
          <Formula tex={block.latex} display />
          {block.caption && <figcaption className="-mt-1 pb-1 text-center text-sm text-muted-foreground">{block.caption}</figcaption>}
        </figure>
      );
    case "image":
      return (
        <figure>
          <img src={assetUrl(block.url)} alt={block.caption ?? "Board snapshot from the lecture"} className="w-full rounded-2xl border bg-muted" loading="lazy" />
          {block.caption && <figcaption className="mt-2 text-sm text-muted-foreground">{block.caption}</figcaption>}
        </figure>
      );
    case "callout": {
      const style = {
        TIP: { icon: Lightbulb, className: "bg-sage text-foreground", label: "Tip" },
        WARNING: { icon: TriangleAlert, className: "bg-destructive/10 text-foreground", label: "Watch out" },
        BOARD: { icon: Presentation, className: "bg-highlight text-foreground", label: "From the board" },
      }[block.variant];
      return (
        <aside className={cn("flex gap-3 rounded-2xl px-4 py-3", style.className)}>
          <style.icon aria-hidden="true" className="mt-1 size-4 shrink-0" />
          <p>
            <span className="font-bold">{style.label}: </span>
            {block.text}
          </p>
        </aside>
      );
    }
  }
}

function SectionView({ section, linker }: { section: NoteSection; linker?: SourceLinker }) {
  const times = linker ? section.sourceSegmentIds.map((id) => linker.segmentTimes.get(id)).filter((t): t is number => t !== undefined) : [];
  const from = times.length ? Math.min(...times) : null;
  return (
    <section aria-labelledby={`sec-${section.id}`} className="scroll-mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`sec-${section.id}`} className="text-xl font-bold tracking-tight">
          {section.heading}
        </h2>
        {from !== null && linker && (
          <Link href={linker.href(from) as Route} className="text-sm font-semibold underline decoration-marigold decoration-2 underline-offset-4 hover:decoration-foreground">
            Hear it at {formatClock(from)}
          </Link>
        )}
      </div>
      {section.boardFocus?.isBoardHeavy && (
        <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-highlight px-3 py-1 text-sm font-semibold">
          <Presentation aria-hidden="true" className="size-4" />
          You looked at the board for {Math.round(section.boardFocus.awaySeconds)} s here: worth a second look
        </p>
      )}
      <div className="mt-3 space-y-3.5">
        {section.blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>
    </section>
  );
}

/** Generated lecture notes on a flat reading surface. `compact` shows the summary, takeaways and section list only. */
export function NotesReader({
  notes,
  linker,
  compact = false,
  headingLevel = 1,
}: {
  notes: LectureNotes;
  linker?: SourceLinker;
  compact?: boolean;
  headingLevel?: 1 | 2;
}) {
  const Title = headingLevel === 1 ? "h1" : "h2";
  return (
    <article className="text-[1.0625rem] leading-[1.7]">
      <Title className={cn("font-extrabold tracking-[-0.02em] text-balance", compact ? "text-xl" : "text-[1.75rem] leading-tight sm:text-[2rem]")}>
        {notes.title}
      </Title>
      <p className="mt-1 text-sm text-muted-foreground">Written {formatWhen(notes.generatedAt)} from the lecture&apos;s captions</p>
      <p className={cn("mt-4", compact ? "text-base" : "text-lg")}>{notes.summary}</p>

      {notes.takeaways.length > 0 && (
        <div className="mt-6 rounded-[1.5rem] bg-sage/70 px-5 py-4">
          <h3 className="font-bold">Takeaways</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-base">
            {notes.takeaways.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      {compact ? (
        <div className="mt-6 space-y-2">
          {notes.sections.map((section) => (
            <details key={section.id} className="group rounded-2xl border px-4 py-2.5 open:pb-4">
              <summary className="cursor-pointer list-none font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {section.heading}
              </summary>
              <div className="mt-2 space-y-3 text-base">
                {section.blocks.map((block, i) => (
                  <Block key={i} block={block} />
                ))}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <>
          <div className="mt-10 space-y-10">
            {notes.sections.map((section) => (
              <SectionView key={section.id} section={section} linker={linker} />
            ))}
          </div>

          {notes.keyTerms.length > 0 && (
            <section className="mt-12">
              <h2 className="text-xl font-bold tracking-tight">Key terms</h2>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                {notes.keyTerms.map((k) => (
                  <div key={k.term} className="rounded-2xl bg-muted/60 px-4 py-3">
                    <dt className="font-bold">{k.term}</dt>
                    <dd className="mt-0.5 text-base">{k.definition}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {notes.formulas.length > 0 && (
            <section className="mt-12">
              <h2 className="text-xl font-bold tracking-tight">Formulas</h2>
              <ul className="mt-3 space-y-3">
                {notes.formulas.map((f) => (
                  <li key={f.latex} className="rounded-2xl bg-muted/60 px-4 py-2">
                    <Formula tex={f.latex} display />
                    <p className="-mt-1 pb-1 text-center text-sm text-muted-foreground">{f.description}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </article>
  );
}
