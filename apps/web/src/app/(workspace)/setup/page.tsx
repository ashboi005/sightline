import { Crosshair, ScanEye } from "lucide-react";
import type { Metadata } from "next";

import { ClayCard, IconTile, PageHeader, StatusPill } from "@/components/clay/clay";

export const metadata: Metadata = { title: "Setup" };

// Placeholder: the hardware check and calibration flows come later.
export default function SetupPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader icon={ScanEye} tone="sage" title="Setup" description="Check your devices and calibrate the eye tracker before class." />

      <ClayCard className="p-6">
        <div className="flex items-center gap-3">
          <IconTile icon={ScanEye} tone="sage" />
          <h2 className="text-xl font-bold tracking-tight">Hardware check</h2>
        </div>
        <p className="mt-3 text-muted-foreground">Eye tracker, microphone, webcam, scene camera and the voice-focus service.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusPill kind="idle">Eye tracker</StatusPill>
          <StatusPill kind="idle">Microphone</StatusPill>
          <StatusPill kind="idle">Webcam</StatusPill>
          <StatusPill kind="idle">Scene camera</StatusPill>
          <StatusPill kind="idle">Voice focus</StatusPill>
        </div>
      </ClayCard>

      <ClayCard className="p-6">
        <div className="flex items-center gap-3">
          <IconTile icon={Crosshair} tone="lilac" />
          <h2 className="text-xl font-bold tracking-tight">Calibration</h2>
        </div>
        <p className="mt-3 text-muted-foreground">Look at a few dots, then at the board, so Sightline knows where you&apos;re looking.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusPill kind="idle">Not calibrated</StatusPill>
          <StatusPill kind="idle">9 dots</StatusPill>
          <StatusPill kind="idle">Board step</StatusPill>
        </div>
      </ClayCard>
    </div>
  );
}
