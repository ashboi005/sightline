"use client";

import { FlaskConical, ServerOff } from "lucide-react";

import { useHealth } from "@/hooks/use-lecture-data";

import { RailTip } from "./rail-tip";

const MODULE_LABELS: Record<string, string> = {
  captions: "caption corrections",
  speech: "speech (replayed lecture)",
  knowledge: "lecture context",
  notes: "notes",
  persistence: "storage (in memory)",
  slides: "slide processing",
  auth: "sign-in (demo student)",
};

/** Says plainly when data is simulated, so demo data is never mistaken for a real lecture. */
export function EnvironmentBadge({ collapsed = false }: { collapsed?: boolean }) {
  const health = useHealth();

  if (health.isError && collapsed) {
    return (
      <RailTip label="Sightline server is offline" show>
        <span role="img" aria-label="Sightline server is offline" tabIndex={0} className="inline-flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ServerOff className="size-4" />
        </span>
      </RailTip>
    );
  }
  if (health.isError) {
    return (
      <p className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-3 py-2.5 text-xs font-semibold text-destructive">
        <ServerOff aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        Sightline server is offline
      </p>
    );
  }

  const mocked = Object.entries(health.data?.mocks ?? {}).filter(([, on]) => on).map(([name]) => MODULE_LABELS[name] ?? name);
  if (mocked.length === 0) return null;
  const summary = `Demo data: ${mocked.length} services simulated`;

  if (collapsed) {
    return (
      <RailTip label={`${summary} (${mocked.join(", ")})`} show>
        <span role="img" aria-label={summary} tabIndex={0} className="inline-flex size-10 items-center justify-center rounded-xl bg-lilac text-lilac-ink outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <FlaskConical className="size-4" />
        </span>
      </RailTip>
    );
  }

  return (
    <details className="group rounded-2xl bg-lilac px-3 py-2.5 text-xs text-lilac-ink">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <FlaskConical aria-hidden="true" className="size-3.5 shrink-0" />
        {summary}
      </summary>
      <p className="mt-1.5 leading-relaxed">Simulated by the server: {mocked.join(", ")}. Camera and servo connections use real devices.</p>
    </details>
  );
}
