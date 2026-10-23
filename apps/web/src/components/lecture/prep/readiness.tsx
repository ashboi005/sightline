"use client";

import type { AccessibilityMode } from "@sightline/contracts";
import { Captions, Ear, Mic, ScanEye } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ClayCard, SectionTitle, StatusPill, type StatusKind } from "@/components/clay/clay";
import { useSpeakerHealth } from "@/hooks/live/use-voice-focus";
import { useHealth } from "@/hooks/use-lecture-data";
import { useEyeTrackingStatus } from "@/hooks/use-eye-tracking-status";

type MicPermission = "granted" | "denied" | "prompt" | "unknown";

function useMicPermission(): MicPermission {
  const [state, setState] = useState<MicPermission>("unknown");
  useEffect(() => {
    let status: PermissionStatus | null = null;
    const update = () => status && setState(status.state as MicPermission);
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((s) => {
        status = s;
        update();
        s.addEventListener("change", update);
      })
      .catch(() => setState("unknown"));
    return () => status?.removeEventListener("change", update);
  }, []);
  return state;
}

function Row({ icon: Icon, label, status, kind, detail }: { icon: typeof Mic; label: string; status: string; kind: StatusKind; detail?: string }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">{label}</span>
          <StatusPill kind={kind}>{status}</StatusPill>
        </div>
        {detail && <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>}
      </div>
    </li>
  );
}

/**
 * What's ready before the lecture starts. Each capability stands alone: no eye tracker still means captions;
 * no voice service still means captions.
 */
export function Readiness({ mode }: { mode: AccessibilityMode }) {
  const health = useHealth();
  const eye = useEyeTrackingStatus();
  const mic = useMicPermission();
  const speaker = useSpeakerHealth(mode === "HARD_OF_HEARING");
  const replay = health.data?.mocks.speech;

  return (
    <ClayCard className="p-6">
      <SectionTitle aside={<Link href="/setup" className="text-sm font-semibold underline decoration-marigold decoration-2 underline-offset-4">Camera settings</Link>}>
        Ready to start?
      </SectionTitle>
      <ul className="mt-2 divide-y">
        <Row
          icon={Captions}
          label="Captions"
          {...(replay
            ? { status: "Demo lecture", kind: "ready" as const, detail: "The server replays a recorded lecture, so no microphone is needed." }
            : mic === "granted"
              ? { status: "Microphone allowed", kind: "ready" as const }
              : mic === "denied"
                ? { status: "Microphone blocked", kind: "attention" as const, detail: "Allow the microphone in your browser's site settings to get captions." }
                : { status: "Asks when you start", kind: "idle" as const, detail: "Your browser will ask for the microphone." })}
        />
        <Row
          icon={ScanEye}
          label="Eye tracker"
          {...eye}
        />
        {mode === "HARD_OF_HEARING" && (
          <Row
            icon={Ear}
            label="Voice focus"
            {...(speaker.data?.ready
              ? { status: speaker.data.engine === "mock" ? "Mock service ready" : "Ready", kind: "ready" as const }
              : speaker.data
                ? { status: "Loading the model", kind: "working" as const }
                : { status: "Not running", kind: "idle" as const, detail: "Captions still work. Start the voice service on this laptop for voice focus." })}
          />
        )}
      </ul>
      <Link href="/focus" className="mt-4 flex min-h-11 items-center justify-center rounded-2xl clay-sage px-4 py-2 text-sm font-bold text-sage-ink outline-none focus-visible:ring-2 focus-visible:ring-ring">Focus a person</Link>
      <p className="mt-2 text-xs text-muted-foreground">Select with your gaze and voice, or click a face. You can use voice focus before starting a lecture.</p>
    </ClayCard>
  );
}
