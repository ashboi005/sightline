import Link from "next/link";

import { AuthAside } from "@/components/auth/auth-aside";
import { Logo } from "@/components/brand/logo";
import { ModeToggle } from "@/components/mode-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-4 sm:px-8 lg:px-12">
        <header className="flex h-16 items-center justify-between">
          <Link href="/" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Logo />
          </Link>
          <ModeToggle />
        </header>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="sl-rise w-full max-w-[26rem]">{children}</div>
        </main>
        <footer className="py-6 text-sm text-muted-foreground">
          Real-time captions and sign interpretation for deaf and hard-of-hearing students.
        </footer>
      </div>
      <AuthAside />
    </div>
  );
}
