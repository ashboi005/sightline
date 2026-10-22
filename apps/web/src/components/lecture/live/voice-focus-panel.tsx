"use client";

import { Button } from "@sightline/ui/components/button";
import { cn } from "@sightline/ui/lib/utils";
import { Ear, LoaderCircle, Square } from "lucide-react";

import { InlineAlert, StatusPill, type StatusKind } from "@/components/clay/clay";
import { useStreamPreview } from "@/hooks/live/use-scene-camera";
import { useSpeakerHealth, type VoiceFocusState } from "@/hooks/live/use-voice-focus";
import { useLiveLecture } from "@/providers/live-lecture-provider";

const faceName = (id: string, faces: VoiceFocusState["faces"]) => `face ${faces.findIndex((f) => f.id === id) + 1}`;

function describe(state: VoiceFocusState): { kind: StatusKind; text: string } {
  switch (state.status) {
    case "CONNECTING":
      return { kind: "working", text: "Connecting to the voice service…" };
    case "READY":
      return { kind: "ready", text: state.faces.length ? "Look at someone to hear them, or tap a face." : "Looking for faces in the scene camera…" };
    case "LISTENING":
      return { kind: "ready", text: `Listening to ${faceName(state.targetId!, state.faces)}.` };
    case "TARGET_LOST":
      return { kind: "attention", text: "Lost the face you were listening to. Look at them again, or tap a face." };
    case "OVERLOADED":
      return { kind: "attention", text: "This laptop can't keep up, so the voice is paused for a moment." };
    case "ERROR":
      return { kind: "attention", text: state.error ?? "The voice service reported a problem." };
  }
}

/**
 * Hard-of-hearing look-to-hear: the scene camera with detected faces, the selected voice, and a tap-to-select
 * fallback. Face numbers are positions in this session, not identities. Captions keep working without it.
 */
export function VoiceFocusPanel() {
  const lecture = useLiveLecture();
  const { voice, scene } = lecture;
  const health = useSpeakerHealth();
  const preview = useStreamPreview(scene.stream);
  const state = voice.state;
  const mock = health.data?.engine === "mock";

  if (!voice.active) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Look at whoever is talking and hear their voice in your hearing aids. Uses your microphone and the scene camera.
        </p>
        {!health.data && !health.isPending && (
          <InlineAlert>The voice service on this laptop isn&apos;t running. Captions still work without it.</InlineAlert>
        )}
        {(voice.error || lecture.mic.error || scene.error) && <InlineAlert>{voice.error ?? lecture.mic.error ?? scene.error}</InlineAlert>}
        <Button variant="clay" onClick={() => void voice.start()} disabled={voice.starting || !health.data}>
          {voice.starting ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Ear />}
          {voice.starting ? "Starting voice focus" : "Start voice focus"}
        </Button>
      </div>
    );
  }

  const status = state ? describe(state) : { kind: "working" as const, text: "Starting…" };
  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl bg-slate">
        <video ref={preview} muted playsInline aria-label="Scene camera" className="aspect-video w-full object-cover" />
        {state?.faces.map((face, i) => {
          const box = face.observations.at(-1)?.box;
          if (!box) return null;
          const selected = face.id === state.targetId;
          return (
            <button
              key={face.id}
              type="button"
              onClick={() => voice.select(selected ? null : face.id)}
              aria-pressed={selected}
              aria-label={selected ? `Stop listening to face ${i + 1}` : `Listen to face ${i + 1}`}
              style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${box[2] * 100}%`, height: `${box[3] * 100}%` }}
              className={cn(
                "absolute rounded-xl border-[3px] outline-none focus-visible:ring-4 focus-visible:ring-ring",
                selected ? "border-marigold bg-marigold/15" : "border-white/80 hover:border-white",
              )}
            >
              <span className={cn("absolute -top-6 left-0 rounded-md px-1.5 text-xs font-bold", selected ? "bg-marigold text-[#16181c]" : "bg-white/90 text-[#16181c]")}>
                {selected ? "Listening" : `Face ${i + 1}`}
              </span>
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="space-y-2">
        <StatusPill kind={status.kind} icon={Ear}>
          {state?.status === "LISTENING" ? "Voice focused" : state?.status === "READY" ? "Ready" : state?.status === "CONNECTING" ? "Connecting" : "Needs attention"}
        </StatusPill>
        <p className="text-sm">{status.text}</p>
        {state && state.playbackDelay > 0 && (
          <p className="text-sm text-muted-foreground">You hear them about {state.playbackDelay.toFixed(1)} s after they speak.</p>
        )}
        {mock && (
          <p className="rounded-xl bg-lilac px-3 py-2 text-xs font-semibold text-lilac-ink">
            Mock voice service: faces are fixed and the &ldquo;focused&rdquo; voice is your own microphone, delayed. No real separation.
          </p>
        )}
      </div>

      <Button variant="clay-soft" size="sm" onClick={() => void voice.stop()}>
        <Square /> Stop voice focus
      </Button>
    </div>
  );
}
