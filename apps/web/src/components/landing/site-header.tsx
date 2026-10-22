"use client";

import { buttonVariants } from "@sightline/ui/components/button";
import { cn } from "@sightline/ui/lib/utils";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Logo } from "@/components/brand/logo";
import { ModeToggle } from "@/components/mode-toggle";
import { useSession } from "@/hooks/use-auth";

const SECTIONS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#modes", label: "Modes" },
];

export function SiteHeader() {
  const { data: session } = useSession();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 px-3 py-3 transition-colors duration-300 sm:px-6 motion-reduce:transition-none",
        scrolled ? "bg-background/85 backdrop-blur-md" : "bg-transparent",
      )}
    >
      <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 rounded-[2rem] clay px-4 py-2 sm:px-6">
        <Link href="/" className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo />
        </Link>

        <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
          {SECTIONS.map((s) => (
            <a
              key={s.href}
              href={s.href}
              className="rounded-2xl px-3 py-2.5 text-sm font-semibold text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {s.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ModeToggle />
          {session?.user ? (
            <Link href="/dashboard" className={buttonVariants({ variant: "clay" })}>
              Open dashboard
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className={buttonVariants({ variant: "ghost" })}>
                Sign in
              </Link>
              <Link href="/sign-up" className={cn(buttonVariants({ variant: "clay" }), "hidden sm:inline-flex")}>
                Create account
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
