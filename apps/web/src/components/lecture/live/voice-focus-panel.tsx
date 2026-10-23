"use client";

import { Button } from "@sightline/ui/components/button";
import { cn } from "@sightline/ui/lib/utils";
import {
  CameraOff,
  Crosshair,
  Ear,
  LoaderCircle,
  Mic,
  MicOff,
  Square,
  Volume2,
} from "lucide-react";
import { useId } from "react";

import {
  InlineAlert,
  StatusPill,
  type StatusKind,
} from "@/components/clay/clay";
import { useStreamPreview } from "@/hooks/live/use-scene-camera";
import {
  useSpeakerHealth,
  type VoiceFocusState,
} from "@/hooks/live/use-voice-focus";
import { useLiveLecture } from "@/providers/live-lecture-provider";
import { MicrophoneInput } from "./microphone-input";

const faceName = (id: string, faces: VoiceFocusState["faces"]) =>
  `person ${faces.findIndex((f) => f.id === id) + 1}`;

function describe(state: VoiceFocusState): { kind: StatusKind; text: string } {
  switch (state.status) {
    case "CONNECTING":
      return { kind: "working", text: "Connecting to the voice service…" };
    case "READY":
      return {
        kind: "ready",
        text: state.faces.length
          ? "Look inside a person's face box and say “select”, or tap their face."
          : "Looking for faces in the POV camera…",
      };
    case "LISTENING":
      return {
        kind: state.hasAudio ? "ready" : "working",
        text: state.hasAudio
          ? `Listening to ${faceName(state.targetId!, state.faces)}. You can look away; the selection stays locked.`
          : `${faceName(state.targetId!, state.faces)} selected. Gathering ${state.analysisSeconds ?? 3} seconds of aligned audio and video, then separating their voice…`,
      };
    case "TARGET_LOST":
      return {
        kind: "attention",
        text: "The selected person or video feed was lost. Audio is paused. Look at their face and select again.",
      };
    case "OVERLOADED":
      return {
        kind: "attention",
        text: "This laptop can't keep up, so focused audio is paused.",
      };
    case "ERROR":
      return {
        kind: "attention",
        text: state.error ?? "The voice service reported a problem.",
      };
  }
}

/** The existing speaker service owns face tracking and voice separation; gaze only confirms the target. */
export function VoiceFocusPanel({ expanded = false }: { expanded?: boolean }) {
  const lecture = useLiveLecture();
  const { voice, scene } = lecture;
  const health = useSpeakerHealth();
  const preview = useStreamPreview(scene.stream);
  const id = useId();
  const state = voice.state;
  const mock = health.data?.engine === "mock";
  const ready = health.data?.ready && health.data.streaming_ready;
  const status = state ? describe(state) : null;
  const engine = state?.engine ?? health.data?.engine;
  const voiceOn =
    voice.voice.status === "listening" || voice.voice.status === "starting";
  const cursor = voice.cursor?.displayPoint;
  const validOffset =
    Number.isFinite(voice.videoOffsetMs) &&
    Math.abs(voice.videoOffsetMs) <= 500;
  const problem =
    voice.error ?? scene.error ?? voice.output.error;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Look at a person through your calibrated POV camera, then say
        &ldquo;select&rdquo; to focus their voice. Audio plays through your
        selected speaker.
      </p>
      {engine && engine !== "mock" && (
        <p className="text-xs text-muted-foreground">
          {engine === "av-mossformer2" || engine === "AV-MossFormer2-TSE-16K"
            ? "AV-MossFormer2 · needs 3 seconds of aligned video and audio, plus processing and playback delay. Keep the selected person's lips visible."
            : `Voice model: ${engine}`}
        </p>
      )}

      <div
        className={cn(
          expanded
            ? "grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]"
            : "space-y-3",
        )}
      >
        <div className="space-y-3">
          {scene.stream && (
            <div className="relative overflow-hidden rounded-2xl bg-slate">
              <video
                ref={preview}
                muted
                playsInline
                aria-label="POV scene camera"
                className="block h-auto w-full"
              />
              {state?.faces.map((face, index) => {
                const box = face.observations.at(-1)?.box;
                if (!box) return null;
                const selected = face.id === state.targetId;
                return (
                  <button
                    key={face.id}
                    type="button"
                    onClick={() => voice.select(selected ? null : face.id)}
                    aria-pressed={selected}
                    aria-label={
                      selected
                        ? `Stop listening to person ${index + 1}`
                        : `Listen to person ${index + 1}`
                    }
                    style={{
                      left: `${box[0] * 100}%`,
                      top: `${box[1] * 100}%`,
                      width: `${box[2] * 100}%`,
                      height: `${box[3] * 100}%`,
                    }}
                    className={cn(
                      "absolute rounded-xl border-[3px] outline-none focus-visible:ring-4 focus-visible:ring-ring",
                      selected
                        ? "border-marigold bg-marigold/15"
                        : "border-white/80 hover:border-white",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute left-0 top-0 rounded-md px-1.5 text-xs font-bold",
                        selected
                          ? "bg-marigold text-[#16181c]"
                          : "bg-white/90 text-[#16181c]",
                      )}
                    >
                      {selected ? "Listening" : `Person ${index + 1}`}
                    </span>
                  </button>
                );
              })}
              {cursor && voice.active && (
                <span
                  aria-hidden="true"
                  style={{
                    left: `${cursor[0] * 100}%`,
                    top: `${cursor[1] * 100}%`,
                  }}
                  className={cn(
                    "pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-marigold/75 shadow-md",
                    voice.cursor?.held && "opacity-40",
                  )}
                />
              )}
            </div>
          )}

          {!scene.stream && (
            <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-2xl bg-muted p-6 text-center">
              <CameraOff className="size-8 text-muted-foreground" />
              <p className="font-bold">POV scene camera</p>
              <p className="text-sm text-muted-foreground">
                Preview your saved camera feed, then start voice focus to find
                faces.
              </p>
              <Button
                variant="clay-soft"
                size="sm"
                onClick={() => void scene.start()}
              >
                Preview POV camera
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            After starting, click a face box to listen, or look at a face and
            say “select” with voice enabled.
          </p>
        </div>
        <div className="space-y-4">
          <MicrophoneInput />
          <div className="space-y-2 rounded-2xl clay-inset p-3">
            <label
              htmlFor={`${id}-speaker`}
              className="flex items-center gap-2 text-xs font-bold"
            >
              <Volume2 className="size-4" /> Speaker output
            </label>
            <select
              id={`${id}-speaker`}
              value={voice.output.deviceId}
              disabled={voice.output.busy || voice.starting}
              onChange={(event) => void voice.output.select(event.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">System default speaker</option>
              {voice.output.devices
                .filter((device) => device.deviceId !== "default")
                .map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Speaker ${index + 1}`}
                  </option>
                ))}
            </select>
            {voice.output.canChoose && (
              <Button
                variant="clay-soft"
                size="sm"
                disabled={voice.output.busy || voice.starting}
                onClick={() => void voice.output.choose()}
              >
                <Volume2 /> Choose speaker
              </Button>
            )}
          </div>

          {!voice.active && (
            <>
              <div className="space-y-2 rounded-2xl clay-inset p-3">
                <label
                  htmlFor={`${id}-offset`}
                  className="block text-xs font-bold"
                >
                  Video timing offset (ms)
                </label>
                <input
                  id={`${id}-offset`}
                  type="number"
                  min={-500}
                  max={500}
                  step={10}
                  value={
                    Number.isFinite(voice.videoOffsetMs)
                      ? voice.videoOffsetMs
                      : ""
                  }
                  aria-invalid={!validOffset}
                  disabled={voice.starting}
                  onChange={(event) =>
                    voice.setVideoOffsetMs(event.target.valueAsNumber)
                  }
                  className="h-9 w-full rounded-xl border border-border bg-background px-3 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Clap while watching the POV feed. If video lags sound, use a
                  negative offset. Voice isolation needs aligned lips and audio.
                </p>
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={voice.syncVerified}
                    disabled={!scene.stream || voice.starting}
                    onChange={(event) =>
                      voice.setSyncVerified(event.target.checked)
                    }
                    className="mt-0.5"
                  />
                  I checked video and microphone timing for this camera.
                </label>
              </div>
              {!ready && !health.isPending && (
                <InlineAlert>
                  {health.data?.streaming_error ??
                    health.data?.error?.message ??
                    "The focus speaker service isn't ready on this laptop. Captions still work without it."}
                </InlineAlert>
              )}
              <Button
                variant="clay"
                onClick={() => void voice.start()}
                disabled={
                  voice.starting ||
                  !lecture.mic.deviceId ||
                  lecture.mic.busy ||
                  !ready ||
                  !validOffset ||
                  !voice.syncVerified ||
                  voice.output.busy
                }
              >
                {voice.starting ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <Ear />
                )}
                {voice.starting ? "Starting voice focus" : "Start voice focus"}
              </Button>
              {voice.starting && (
                <Button
                  variant="clay-soft"
                  size="sm"
                  onClick={() => void voice.stop()}
                >
                  Cancel startup
                </Button>
              )}
            </>
          )}

          <div className="space-y-3">
            <h2 className="text-sm font-bold">Choose who to hear</h2>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={voiceOn ? "clay" : "clay-soft"}
                size="sm"
                aria-pressed={voiceOn}
                onClick={voice.toggleVoice}
                disabled={!voice.active}
              >
                {voice.voice.status === "starting" ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                ) : voiceOn ? (
                  <Mic />
                ) : (
                  <MicOff />
                )}
                {voice.voice.status === "starting"
                  ? "Loading voice"
                  : voiceOn
                    ? "Voice on"
                    : "Enable voice"}
              </Button>
              <Button
                variant="clay-soft"
                size="sm"
                onClick={voice.selectAtGaze}
                disabled={
                  !voice.active ||
                  !voice.cursor?.gaze ||
                  state?.status === "CONNECTING" ||
                  state?.status === "ERROR"
                }
              >
                <Crosshair /> Select at gaze
              </Button>
              {state?.targetId && (
                <Button
                  variant="clay-soft"
                  size="sm"
                  onClick={() => voice.select(null)}
                >
                  Clear selection
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Say &ldquo;select&rdquo; or &ldquo;focus&rdquo; to lock a person;
              &ldquo;stop listening&rdquo; to clear. &ldquo;Stop voice&rdquo;
              turns off commands. Face numbers are local to this session.
            </p>
            {!voice.active && (
              <p className="text-xs text-muted-foreground">
                Start voice focus above to detect people and enable selection.
                Preview the camera and confirm video timing first.
              </p>
            )}
            {voice.active && (
              <>
                {status && (
                  <div aria-live="polite" className="space-y-2">
                    <StatusPill kind={status.kind} icon={Ear}>
                      {state?.status === "LISTENING"
                        ? state.hasAudio ? "Voice focused" : "Preparing audio"
                        : state?.status === "READY"
                          ? "Ready"
                          : state?.status === "CONNECTING"
                            ? "Connecting"
                            : "Needs attention"}
                    </StatusPill>
                    <p className="text-sm">{status.text}</p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {voice.cursor?.message}
                </p>
                {voice.voice.status !== "idle" && (
                  <p className="text-xs" role="status">
                    {voice.voice.message}
                  </p>
                )}
                {voice.feedback && (
                  <p className="text-sm" role="status">
                    {voice.feedback}
                  </p>
                )}
                {state?.lastInferenceSeconds != null && (
                  <p className="text-xs text-muted-foreground">
                    Separation: {state.lastInferenceSeconds.toFixed(1)} s per
                    chunk. Playback buffer: {state.playbackDelay.toFixed(1)} s.
                  </p>
                )}
                <Button
                  variant="clay-soft"
                  size="sm"
                  onClick={() => void voice.stop()}
                >
                  <Square /> Stop voice focus
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
      {problem && <InlineAlert>{problem}</InlineAlert>}
      {mock && (
        <p className="rounded-xl bg-lilac px-3 py-2 text-xs font-semibold text-lilac-ink">
          Mock voice service: no real voice isolation. Use the focus speaker
          service for separated audio.
        </p>
      )}
    </div>
  );
}
