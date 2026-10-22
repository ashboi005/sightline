import { buttonVariants } from "@sightline/ui/components/button";
import { cn } from "@sightline/ui/lib/utils";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";

export function Closing() {
  return (
    <section className="bg-slate text-[#ecedea] dark:border-t">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-10 px-4 py-20 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:py-24">
        <div className="max-w-2xl">
          <h2 className="text-[clamp(2.25rem,1.6rem+2.6vw,3.5rem)] leading-[1.05] font-bold tracking-[-0.03em] text-balance">
            Follow every lecture, even when you look away.
          </h2>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-[#ecedea]/70">
            Create an account, set up your first lecture, and keep your notes from every class in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/sign-up" className={buttonVariants({ size: "lg" })}>
            Create an account
          </Link>
          <Link
            href="/sign-in"
            className={cn(
              buttonVariants({ size: "lg", variant: "ghost" }),
              "text-[#ecedea] hover:bg-white/10 hover:text-[#ecedea] focus-visible:ring-offset-slate",
            )}
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
