"use client";

import type { SignSource, SignUtterance } from "@sightline/contracts";
import { Button } from "@sightline/ui/components/button";
import { cn } from "@sightline/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, CameraOff, Hand, Play, Square, Users, Volume2, X } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { InlineAlert, StatusPill } from "@/components/clay/clay";
import { useCreateSignUtterance, useSignUtterances } from "@/hooks/use-lecture-data";
import { useSignService } from "@/hooks/use-sign-service";
import { useStreamPreview } from "@/hooks/live/use-scene-camera";
import { errorMessage } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { speakUtterance } from "@/lib/live/speak";
import { describeMediaError } from "@/lib/media/errors";
import { startWebcamFrames } from "@/lib/media/webcam-frames";
import { keys } from "@/lib/query-keys";

const FRAME = { fps: 12, width: 640, height: 480 };

const upsert = (list: SignUtterance[] | undefined, u: SignUtterance) =>
  list?.some((x) => x.id === u.id) ? list : [...(list ?? []), u];

/**
 * Sign → text → speech. Webcam frames go to the sign service; committed signs build a phrase; when the signer
 * pauses, the phrase is sent to the server to become a sentence (and speech). The live guess is shown greyed and
 * never sent. Owns its own webcam, so stopping it never affects the lecture's microphone or scene camera.
 */
export function SignPanel({ sessionId, variant = "page" }: { sessionId: string | null; variant?: "page" | "panel" }) {
  const queryClient = useQueryClient();
  const [source, setSource] = useState<SignSource>("SELF");
  const [speak, setSpeak] = useState(true);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const preview = useStreamPreview(camera);
  const history = useSignUtterances(sessionId);
  const create = useCreateSignUtterance(sessionId);

  const sign = useSignService({
    onPhrase: (tokens, phraseSource) => {
      create.mutate(
        { tokens, source: phraseSource, speak },
        {
          onSuccess: (u) => {
            if (sessionId) queryClient.setQueryData<SignUtterance[]>(keys.utterances(sessionId), (list) => upsert(list, u));
            if (speak && u.source === "SELF") speakUtterance(u, { browserVoice: true });
          },
        },
      );
    },
  });

  // Frames flow only while the camera is on and recognition is running.
  const sendFrame = useEffectEvent((jpeg: string) => sign.sendFrame(jpeg));
  useEffect(() => {
    const video = preview.current;
    if (!camera || !video || !sign.streaming) return;
    return startWebcamFrames(video, FRAME, (jpeg) => sendFrame(jpeg));
  }, [camera, preview, sign.streaming]);

  useEffect(() => () => camera?.getTracks().forEach((t) => t.stop()), [camera]);

  const startCamera = async () => {
    try {
      setCamera(await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false }));
      setCameraError(null);
    } catch (e) {
      setCameraError(describeMediaError(e, "camera"));
    }
  };
  const stopCamera = () => {
    if (sign.streaming) sign.stop();
    setCamera(null);
  };

  const utterances = [...(history.data ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const latest = utterances[0];
  const serviceReady = sign.status === "OPEN";
  const isPage = variant === "page";

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      {camera ? (
        <Button variant="clay-soft" onClick={stopCamera}>
          <CameraOff /> Turn camera off
        </Button>
      ) : (
        <Button variant="clay-soft" onClick={startCamera}>
          <Camera /> Turn camera on
        </Button>
      )}
      {sign.streaming ? (
        <Button variant="clay" onClick={sign.stop}>
          <Square /> Stop recognising
        </Button>
      ) : (
        <Button
          variant="clay"
          disabled={!serviceReady || !sessionId}
          onClick={() => sign.start({ source, ...FRAME })}
          title={!serviceReady ? "The sign service isn't connected" : undefined}
        >
          <Hand /> Start recognising
        </Button>
      )}
    </div>
  );

  return (
    <div className={cn("grid gap-5", isPage && "lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]")}>
      <div className="space-y-4">
        <fieldset className="flex flex-wrap gap-2" aria-label="Who is signing">
          {(
            [
              ["SELF", "I'm signing", Hand],
              ["PEER", "Someone else is signing", Users],
            ] as const
          ).map(([value, label, Icon]) => (
            <label
              key={value}
              className={cn(
                "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl px-3.5 text-sm font-semibold has-focus-visible:ring-2 has-focus-visible:ring-ring",
                source === value ? "clay-lilac text-lilac-ink" : "bg-muted text-muted-foreground",
                sign.streaming && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name={`sign-source-${variant}`}
                value={value}
                checked={source === value}
                disabled={sign.streaming}
                onChange={() => setSource(value)}
                className="sr-only"
              />
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </label>
          ))}
        </fieldset>

        <div className="relative overflow-hidden rounded-[1.5rem] bg-slate shadow-[var(--clay-shadow-sm)]">
          <video
            ref={preview}
            muted
            playsInline
            aria-label="Webcam preview"
            className={cn("aspect-[4/3] w-full object-cover", source === "SELF" && "-scale-x-100", !camera && "invisible")}
          />
          {!camera && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-[#ecedea]/80">
              <Camera aria-hidden="true" className="size-8" />
              <p className="max-w-xs text-sm">Turn the camera on and keep your hands in view. Your video isn&apos;t recorded.</p>
            </div>
          )}
          <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
            <StatusPill kind={serviceReady ? "ready" : sign.status === "CONNECTING" ? "working" : "attention"}>
              {serviceReady ? "Recogniser connected" : sign.status === "CONNECTING" ? "Connecting" : "Recogniser offline"}
            </StatusPill>
            {sign.streaming && (
              <StatusPill kind={sign.handsDetected > 0 ? "ready" : "idle"} icon={Hand}>
                {sign.handsDetected > 0 ? `${sign.handsDetected} hand${sign.handsDetected > 1 ? "s" : ""} in view` : "No hands in view"}
              </StatusPill>
            )}
          </div>
        </div>

        {controls}
        {cameraError && <InlineAlert>{cameraError}</InlineAlert>}
        {!serviceReady && sign.status !== "CONNECTING" && (
          <p className="text-sm text-muted-foreground">
            The sign recogniser runs on this laptop and isn&apos;t answering. Start it (for a demo: <code className="font-mono">bun run mock:sign</code>)
            and it reconnects by itself.
          </p>
        )}
        {!sessionId && <InlineAlert>Choose a lecture first: sign messages are saved with a lecture.</InlineAlert>}
      </div>

      <div className="space-y-4">
        <section aria-label="Current phrase" aria-live="polite" className="rounded-[1.5rem] clay-sm p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-muted-foreground">Signing now</h3>
            <Button variant="ghost" size="sm" onClick={sign.reset} disabled={!sign.streaming || (sign.tokens.length === 0 && !sign.partial)}>
              <X /> Clear phrase
            </Button>
          </div>
          <p className="mt-2 flex min-h-10 flex-wrap items-center gap-1.5">
            {sign.tokens.map((t) => (
              <span key={t.id} className="rounded-lg bg-lilac px-2 py-0.5 font-mono text-sm font-bold text-lilac-ink">
                {t.gloss}
              </span>
            ))}
            {sign.partial && (
              <span className="rounded-lg border border-dashed px-2 py-0.5 font-mono text-sm text-muted-foreground" title="Still recognising">
                {sign.partial}?
              </span>
            )}
            {sign.tokens.length === 0 && !sign.partial && (
              <span className="text-sm text-muted-foreground">{sign.streaming ? "Waiting for signs…" : "Start recognising to begin."}</span>
            )}
          </p>
          {create.isPending && <p className="mt-2 text-sm text-muted-foreground">Writing the sentence…</p>}
          {create.isError && <InlineAlert className="mt-2">{errorMessage(create.error)}</InlineAlert>}

          <label className="mt-3 flex items-center gap-2.5 text-sm font-semibold">
            <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} className="size-4 accent-[var(--marigold)]" />
            Say it out loud for the room
          </label>
        </section>

        {latest && (
          <section aria-label="Latest sentence" className="rounded-[1.5rem] clay-marigold p-4">
            <p className="text-xs font-bold opacity-80">{latest.source === "SELF" ? "You said" : "They said"}</p>
            <p className="mt-1 text-xl leading-snug font-bold">{latest.text}</p>
            {latest.alternatives.length > 0 && (
              <p className="mt-1.5 text-sm opacity-80">
                Or maybe: {latest.alternatives.map((a) => `“${a}”`).join(", ")}
              </p>
            )}
            <Button variant="clay-soft" size="sm" className="mt-3" onClick={() => speakUtterance(latest, { again: true, browserVoice: true })}>
              <Volume2 /> Play again
            </Button>
          </section>
        )}

        <section aria-label="Conversation">
          <h3 className="text-sm font-bold text-muted-foreground">Conversation</h3>
          {utterances.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Sentences you and others sign appear here.</p>
          ) : (
            <ol className={cn("mt-2 space-y-2 overflow-y-auto pr-1", isPage ? "max-h-[28rem]" : "max-h-72")}>
              {utterances.map((u) => (
                <li key={u.id} className={cn("flex items-start gap-3 rounded-2xl px-3.5 py-2.5", u.source === "SELF" ? "bg-muted/70" : "bg-lilac/60")}>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-muted-foreground">
                      {u.source === "SELF" ? "You" : "Someone else"} · {formatWhen(u.createdAt)}
                    </p>
                    <p className="mt-0.5 font-medium">{u.text}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{u.gloss.join(" ")}</p>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label={`Play "${u.text}"`} onClick={() => speakUtterance(u, { again: true, browserVoice: true })}>
                    <Play />
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
