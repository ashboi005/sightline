"use client";

import { Ear, ScanEye } from "lucide-react";
import Link from "next/link";

import { ClayCard, PageHeader, StatusPill } from "@/components/clay/clay";
import { useEyeTrackingStatus } from "@/hooks/use-eye-tracking-status";
import { VoiceFocusPanel } from "./voice-focus-panel";

/** Uses the workspace's existing camera, microphone and focus session; no lecture or calibration restart. */
export function VoiceFocusWorkspace() {
  const eye = useEyeTrackingStatus();
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        icon={Ear}
        tone="sage"
        title="Focus a person"
        description="Choose who you want to hear through your POV camera. You can use this without starting a lecture."
      />
      <ClayCard className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="space-y-1.5">
          <StatusPill kind={eye.kind} icon={ScanEye}>
            {eye.status}
          </StatusPill>
          <p className="text-sm text-muted-foreground">{eye.detail}</p>
        </div>
        <Link
          href="/setup"
          className="text-sm font-semibold underline underline-offset-4"
        >
          Camera settings
        </Link>
      </ClayCard>
      <ClayCard className="p-5 sm:p-6">
        <VoiceFocusPanel expanded />
      </ClayCard>
    </div>
  );
}
