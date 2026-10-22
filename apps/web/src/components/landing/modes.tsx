import { Check, Ear, Eye } from "lucide-react";

import { IconTile } from "@/components/clay/clay";

const MODES = [
  {
    icon: Ear,
    tone: "sage" as const,
    name: "Hard-of-hearing mode",
    lead: "For when you hear part of the lecture and want more of the right voice.",
    points: [
      "The voice of the person you look at, streamed to your hearing aids",
      "Background noise pushed down, not just turned up",
      "Live captions alongside, in case you miss a word",
    ],
  },
  {
    icon: Eye,
    tone: "lilac" as const,
    name: "Deaf mode",
    lead: "For when you read the lecture rather than hear it.",
    points: [
      "Captions pause while you look at the board",
      "Missed lines highlighted, then live scrolling resumes",
      "Sign a question and Sightline speaks it for you",
    ],
  },
];

export function Modes() {
  return (
    <section id="modes" className="scroll-mt-28">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <h2 className="max-w-2xl text-[clamp(2rem,1.5rem+2vw,3rem)] leading-[1.08] font-bold tracking-[-0.025em] text-balance">
          Two ways to follow a lecture
        </h2>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Pick the mode that fits how you take in a class. You can switch in the middle of a lecture and
          nothing is lost.
        </p>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {MODES.map(({ icon, tone, name, lead, points }) => (
            <article key={name} className={`rounded-[2rem] p-7 sm:p-9 ${tone === "sage" ? "clay-sage" : "clay-lilac"}`}>
              <IconTile icon={icon} tone={tone} size="lg" />
              <h3 className="mt-5 text-2xl font-bold tracking-tight">{name}</h3>
              <p className="mt-3 text-lg leading-relaxed text-foreground">{lead}</p>
              <ul className="mt-7 space-y-3.5 rounded-[1.5rem] bg-card p-5">
                {points.map((p) => (
                  <li key={p} className="flex gap-3 text-base leading-snug">
                    <Check className="mt-0.5 size-5 shrink-0 text-marigold-ink" aria-hidden="true" />
                    {p}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
