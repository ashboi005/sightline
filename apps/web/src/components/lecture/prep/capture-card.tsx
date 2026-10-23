"use client";

import { Button } from "@sightline/ui/components/button";
import { Label } from "@sightline/ui/components/label";
import { Camera, ScanFace, Video } from "lucide-react";
import { useEffect, useState } from "react";

import { ClayCard, SectionTitle } from "@/components/clay/clay";
import { SceneCameraPanel } from "@/components/lecture/live/scene-camera-panel";
import { readAttentionCameraId, saveAttentionCameraId } from "@/hooks/live/use-webcam-attention";
import { describeMediaError } from "@/lib/media/errors";
import { useSceneTracking } from "@/providers/scene/context";

export type CaptureChoice = { sceneCamera: boolean; record: boolean; webcam: boolean };

/** The browser's cameras. Names appear once the browser allows camera access (`reveal`). */
function useCameras() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const list = async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices(all.filter((d) => d.kind === "videoinput" && d.deviceId && d.label));
  };

  useEffect(() => {
    if (navigator.mediaDevices) void list().catch((cause) => setError(describeMediaError(cause, "camera")));
  }, []);

  const reveal = async () => {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true });
      probe.getTracks().forEach((t) => t.stop()); // only to reveal device names
      await list();
      setError(null);
    } catch (e) {
      setError(describeMediaError(e, "camera"));
    }
  };

  return { devices, error, reveal };
}

function CameraSelect({
  id,
  label,
  hint,
  value,
  onChange,
  cameras,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (deviceId: string) => void;
  cameras: ReturnType<typeof useCameras>;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {cameras.devices.length > 0 ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full rounded-2xl border border-input bg-card px-3.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">The browser&apos;s default camera</option>
          {cameras.devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      ) : (
        <Button variant="clay-soft" onClick={cameras.reveal}>
          <Camera /> Show my cameras
        </Button>
      )}
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  title,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 text-base">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-4 accent-[var(--marigold)]" />
      <span>
        <span className="font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{children}</span>
      </span>
    </label>
  );
}

/**
 * The lecture's two cameras, decided before it starts. The scene camera faces the board and the teacher: it records
 * the lecture and saves board snapshots. The webcam faces the student: it only judges where they're looking.
 */
export function CaptureCard({
  value,
  onChange,
  hardOfHearing,
}: {
  value: CaptureChoice;
  onChange: (next: CaptureChoice) => void;
  hardOfHearing: boolean;
}) {
  const { scene } = useSceneTracking();
  const cameras = useCameras();
  const [webcamId, setWebcamId] = useState("");

  useEffect(() => setWebcamId(readAttentionCameraId() ?? ""), []);

  const sceneOn = value.sceneCamera || value.record;
  // The same device for both would point the scene camera at the student's face.
  const sameCamera = sceneOn && value.webcam && Boolean(webcamId) && scene.source?.deviceId === webcamId;

  return (
    <ClayCard className="p-6">
      <SectionTitle>Cameras</SectionTitle>
      <p className="mt-1.5 text-muted-foreground">Both are optional. Captions work without either.</p>

      <section aria-labelledby="scene-camera-title" className="mt-5 rounded-[1.4rem] bg-muted/60 p-4">
        <h3 id="scene-camera-title" className="flex items-center gap-2 font-bold">
          <Video aria-hidden="true" className="size-5" /> Scene camera
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">Faces the board and the teacher.</p>
        <div className="mt-3 space-y-3">
          <Toggle checked={sceneOn} onChange={(on) => onChange({ ...value, sceneCamera: on, record: on && value.record })} title="Turn on the scene camera">
            Saves board snapshots into your notes, including when you look up at the board
            {hardOfHearing ? ", and lets voice focus see who is talking" : ""}.
          </Toggle>
          <Toggle checked={value.record} onChange={(on) => onChange({ ...value, record: on, sceneCamera: value.sceneCamera || on })} title="Record the lecture">
            Video of the board and teacher with room audio, played back next to the transcript. Recordings capture
            classmates too, so this is off unless you choose it.
          </Toggle>
          {sceneOn && <SceneCameraPanel />}
        </div>
      </section>

      <section aria-labelledby="webcam-title" className="mt-3 rounded-[1.4rem] bg-muted/60 p-4">
        <h3 id="webcam-title" className="flex items-center gap-2 font-bold">
          <ScanFace aria-hidden="true" className="size-5" /> Webcam
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">Faces you.</p>
        <div className="mt-3 space-y-3">
          <Toggle checked={value.webcam} onChange={(on) => onChange({ ...value, webcam: on })} title="Follow where I'm looking">
            Captions pause when you look away from the screen and catch you up when you return. The video stays on this
            device and is never recorded.
          </Toggle>
          {value.webcam && (
            <CameraSelect
              id="attention-webcam"
              label="Which camera"
              hint="Usually the camera built into your laptop. Look at your screen for a moment when the lecture starts."
              value={webcamId}
              onChange={(id) => {
                setWebcamId(id);
                saveAttentionCameraId(id || null);
              }}
              cameras={cameras}
            />
          )}
        </div>
      </section>

      {sameCamera && (
        <p className="mt-3 text-sm font-medium text-destructive">
          Both use the same camera. Pick the camera facing the board as the scene camera.
        </p>
      )}
      {cameras.error && <p className="mt-3 text-sm font-medium text-destructive">{cameras.error}</p>}
    </ClayCard>
  );
}
