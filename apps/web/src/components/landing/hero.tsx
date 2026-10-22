import { buttonVariants } from "@sightline/ui/components/button";
import Link from "next/link";

import { GazeLine } from "@/components/clay/memphis";

import { CaptionDemo } from "./caption-demo";

export function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:gap-16 lg:pt-20 lg:pb-28">
      <div className="max-w-xl">
        <GazeLine className="mb-6" />
        <h1
          className="sl-rise text-[clamp(2.75rem,1.9rem+4.2vw,4.75rem)] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance"
          style={{ "--sl-delay": "0ms" } as React.CSSProperties}
        >
          Captions that wait for you.
        </h1>
        <p
          className="sl-rise mt-6 max-w-[34rem] text-lg leading-relaxed text-muted-foreground sm:text-xl sm:leading-relaxed"
          style={{ "--sl-delay": "120ms" } as React.CSSProperties}
        >
          Sightline is a lecture workspace for deaf and hard-of-hearing students. It follows your eyes, so
          when you look up at the board the captions hold still and keep track of what you missed.
        </p>
        <div
          className="sl-rise mt-9 flex flex-wrap items-center gap-3"
          style={{ "--sl-delay": "240ms" } as React.CSSProperties}
        >
          <Link href="/sign-up" className={buttonVariants({ size: "lg", variant: "clay" })}>
            Create an account
          </Link>
          <a href="#how-it-works" className={buttonVariants({ size: "lg", variant: "clay-soft" })}>
            See how a lecture works
          </a>
        </div>
        <p
          className="sl-rise mt-8 max-w-md text-sm leading-relaxed text-muted-foreground"
          style={{ "--sl-delay": "360ms" } as React.CSSProperties}
        >
          Works with the Sightline eye tracker, a webcam and your lecture slides. Captions in English and
          Hinglish.
        </p>
      </div>

      <div className="sl-rise min-w-0 rounded-[2rem] clay p-3 sm:p-4" style={{ "--sl-delay": "200ms" } as React.CSSProperties}>
        <CaptionDemo />
      </div>
    </section>
  );
}
