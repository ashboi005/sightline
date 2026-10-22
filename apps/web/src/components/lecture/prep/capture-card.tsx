"use client";

import type { RecordingSource } from "@sightline/contracts";
import { Button } from "@sightline/ui/components/button";
import { Label } from "@sightline/ui/components/label";
import { cn } from "@sightline/ui/lib/utils";
import { Camera, CircleOff, MonitorUp, Video } from "lucide-react";
import { useEffect, useState } from "react";

import { ClayCard, SectionTitle } from "@/components/clay/clay";
import { readSceneCameraId, saveSceneCameraId } from "@/hooks/live/use-scene-camera";
import { describeMediaError } from "@/lib/media/errors";

export type CaptureChoice = { record: RecordingSource | null; sceneCamera: boolean };

const SOURCES: { value: RecordingSource | null; label: string; body: string; icon: typeof Video }[] = [
  { value: null, label: "Don't record", body: "Captions and notes only.", icon: CircleOff },
  { value: "SCENE_CAMERA", label: "Scene camera", body: "What you saw: the eye tracker's camera, plus room audio.", icon: Video },
  { value: "WEBCAM", label: "Webcam", body: "Your laptop camera, plus room audio.", icon: Camera },
  { value: "SCREEN", label: "Screen", body: "A screen or window you choose, plus room audio.", icon: MonitorUp },
];

/** Which camera is the scene camera. Device names appear once the browser allows camera access. */
function SceneCameraSelect() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const list = async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices(all.filter((d) => d.kind === "videoinput" && d.deviceId));
  };

  useEffect(() => {
    setSelected(readSceneCameraId() ?? "");
    if (navigator.mediaDevices) void list();
  }, []);

  const allowAndList = async () => {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true });
      probe.getTracks().forEach((t) => t.stop()); // only to reveal device names
      await list();
      setError(null);
    } catch (e) {
      setError(describeMediaError(e, "camera"));
    }
  };

  const named = devices.filter((d) => d.label);
  return (
    <div className="space-y-2">
      <Label htmlFor="scene-camera">Scene camera</Label>
      {named.length > 0 ? (
        <select
          id="scene-camera"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            saveSceneCameraId(e.target.value || null);
          }}
          className="h-11 w-full rounded-2xl border border-input bg-card px-3.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">The browser&apos;s default camera</option>
          {named.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      ) : (
        <Button variant="clay-soft" onClick={allowAndList}>
          <Camera /> Show my cameras
        </Button>
      )}
      <p className="text-sm text-muted-foreground">The eye tracker&apos;s world camera, or any webcam pointed at the front of the room.</p>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}

/** Recording and the scene camera, decided before the lecture starts. */
export function CaptureCard({
  value,
  onChange,
  hardOfHearing,
}: {
  value: CaptureChoice;
  onChange: (next: CaptureChoice) => void;
  hardOfHearing: boolean;
}) {
  return (
    <ClayCard className="p-6">
      <SectionTitle>Recording and camera</SectionTitle>
      <p className="mt-1.5 text-muted-foreground">
        Recordings capture classmates too, so they&apos;re off unless you choose a source. You can stop at any time.
      </p>

      <fieldset className="mt-5 grid gap-2.5 sm:grid-cols-2">
        <legend className="sr-only">Record this lecture</legend>
        {SOURCES.map((s) => {
          const selected = value.record === s.value;
          return (
            <label
              key={s.label}
              className={cn(
                "flex cursor-pointer gap-3 rounded-[1.2rem] p-3.5 has-focus-visible:ring-2 has-focus-visible:ring-ring",
                selected ? "clay ring-2 ring-marigold" : "bg-muted/70 hover:bg-muted",
              )}
            >
              <input
                type="radio"
                name="record-source"
                checked={selected}
                onChange={() => onChange({ record: s.value, sceneCamera: value.sceneCamera || s.value === "SCENE_CAMERA" })}
                className="sr-only"
              />
              <s.icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              <span>
                <span className="block font-semibold">{s.label}</span>
                <span className="block text-sm text-muted-foreground">{s.body}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <label className="mt-5 flex items-start gap-3 text-base">
        <input
          type="checkbox"
          checked={value.sceneCamera || value.record === "SCENE_CAMERA"}
          disabled={value.record === "SCENE_CAMERA"}
          onChange={(e) => onChange({ ...value, sceneCamera: e.target.checked })}
          className="mt-1 size-4 accent-[var(--marigold)]"
        />
        <span>
          <span className="font-semibold">Turn on the scene camera</span>
          <span className="block text-sm text-muted-foreground">
            Saves board snapshots into your notes{hardOfHearing ? " and lets voice focus see who is talking" : ""}.
          </span>
        </span>
      </label>

      {(value.sceneCamera || value.record === "SCENE_CAMERA") && (
        <div className="mt-4">
          <SceneCameraSelect />
        </div>
      )}
    </ClayCard>
  );
}
