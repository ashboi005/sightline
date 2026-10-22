import { buttonVariants } from "@sightline/ui/components/button";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { DotGrid } from "@/components/clay/memphis";

export function Closing() {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-4 pb-16 sm:px-6">
      <div className="relative flex flex-col items-start gap-10 overflow-hidden rounded-[2rem] clay-marigold px-6 py-10 sm:p-10 lg:flex-row lg:items-end lg:justify-between lg:py-14">
        <DotGrid className="absolute -top-2 -right-2 text-primary-foreground/15" />
        <div className="relative max-w-2xl">
          <h2 className="text-[clamp(2.25rem,1.6rem+2.6vw,3.5rem)] leading-[1.05] font-bold tracking-[-0.03em] text-balance">
            Follow every lecture, even when you look away.
          </h2>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-primary-foreground">
            Create an account, set up your first lecture, and keep your notes from every class in one place.
          </p>
        </div>
        <div className="relative flex shrink-0 flex-wrap gap-3 lg:flex-col">
          <Link href="/sign-up" className={buttonVariants({ size: "lg", variant: "clay-soft" })}>
            Create an account
          </Link>
          <Link
            href="/sign-in"
            className="inline-flex min-h-11 items-center justify-center rounded-2xl px-5 text-base font-semibold text-primary-foreground underline underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-2 focus-visible:ring-primary-foreground"
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Logo className="text-foreground" />
        <p>Real-time captions and sign interpretation for deaf and hard-of-hearing students.</p>
      </div>
    </footer>
  );
}
