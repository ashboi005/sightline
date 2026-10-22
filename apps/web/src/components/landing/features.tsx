import { Ear, Hand, NotebookText, ScanEye, Sigma, type LucideIcon } from "lucide-react";

import { IconTile, type Tone } from "@/components/clay/clay";

type Audience = "Deaf mode" | "Hard-of-hearing mode" | "Both modes";

const FEATURES: {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  audience: Audience;
  body: string;
}[] = [
  {
    icon: ScanEye,
    tone: "marigold",
    title: "Captions that wait for you",
    audience: "Deaf mode",
    body: "Look up at the board and the caption feed holds still. Everything said while you were away is highlighted, so you can catch up before live scrolling starts again.",
  },
  {
    icon: Sigma,
    tone: "marigold",
    title: "Captions that know the subject",
    audience: "Both modes",
    body: "Add the lecture slides or a few lines about the topic. Sightline fixes the jargon speech recognition gets wrong and writes spoken formulas as real maths.",
  },
  {
    icon: Ear,
    tone: "sage",
    title: "Hear the person you look at",
    audience: "Hard-of-hearing mode",
    body: "Look at whoever is speaking and their voice streams to your hearing aids, separated from the fan, the corridor and the back row.",
  },
  {
    icon: Hand,
    tone: "lilac",
    title: "Sign back",
    audience: "Both modes",
    body: "Sign a question at your webcam. Sightline writes it as a full sentence and says it aloud for the room. It can read a classmate's signing too.",
  },
  {
    icon: NotebookText,
    tone: "sage",
    title: "Notes when class ends",
    audience: "Both modes",
    body: "End the lecture and get notes with headings, definitions, formulas and the board diagrams you looked at, ready to export.",
  },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-28">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20 lg:py-28">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <h2 className="text-[clamp(2rem,1.5rem+2vw,3rem)] leading-[1.08] font-bold tracking-[-0.025em] text-balance">
            Made for the parts of a lecture that captions usually miss
          </h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-muted-foreground">
            Most caption apps transcribe and scroll. Sightline also knows where you&apos;re looking, what the
            course is about, and that you might want to answer back.
          </p>
        </div>

        <ul className="space-y-5">
          {FEATURES.map(({ icon, tone, title, audience, body }) => (
            <li key={title} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 rounded-[1.75rem] clay p-5 sm:gap-x-5 sm:p-7">
              <IconTile icon={icon} tone={tone} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <h3 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h3>
                  <span className="rounded-full clay-sunken px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                    {audience}
                  </span>
                </div>
                <p className="mt-2.5 max-w-[38rem] text-base leading-relaxed text-muted-foreground sm:text-lg sm:leading-relaxed">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
