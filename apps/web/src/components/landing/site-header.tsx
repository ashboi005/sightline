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
        "sticky top-0 z-40 border-b transition-colors duration-300",
        scrolled ? "border-border bg-background/85 backdrop-blur-md" : "border-transparent bg-background",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo />
        </Link>

        <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
          {SECTIONS.map((s) => (
            <a
              key={s.href}
              href={s.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {s.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ModeToggle />
          {session?.user ? (
            <Link href="/dashboard" className={buttonVariants()}>
              Open dashboard
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className={buttonVariants({ variant: "ghost" })}>
                Sign in
              </Link>
              <Link href="/sign-up" className={cn(buttonVariants(), "hidden sm:inline-flex")}>
                Create account
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
