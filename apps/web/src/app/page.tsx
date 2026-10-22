import { Closing, SiteFooter } from "@/components/landing/closing";
import { Features } from "@/components/landing/features";
import { Hero } from "@/components/landing/hero";
import { LectureFlow } from "@/components/landing/lecture-flow";
import { Modes } from "@/components/landing/modes";
import { SiteHeader } from "@/components/landing/site-header";
import { WorkspaceBackdrop } from "@/components/workspace/backdrop";

export default function Home() {
  return (
    <div className="relative isolate min-h-svh bg-background">
      <WorkspaceBackdrop />
      <a
        href="#main"
        className="sr-only z-50 rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <Features />
        <LectureFlow />
        <Modes />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
}
