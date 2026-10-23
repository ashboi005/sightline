"use client";

import type { SignSource, SignUtterance } from "@sightline/contracts";
import { Button } from "@sightline/ui/components/button";
import { Textarea } from "@sightline/ui/components/textarea";
import { cn } from "@sightline/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, CameraOff, Hand, Play, Send, Square, Users, Volume2, X } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import { InlineAlert, StatusPill } from "@/components/clay/clay";
import { useCreateSignUtterance, useSignUtterances } from "@/hooks/use-lecture-data";
import { useSignService } from "@/hooks/use-sign-service";
import { useStreamPreview } from "@/hooks/live/use-scene-camera";
import { formatWhen } from "@/lib/format";
import { speakUtterance } from "@/lib/live/speak";
import { describeMediaError } from "@/lib/media/errors";
import { startWebcamFrames } from "@/lib/media/webcam-frames";
import { keys } from "@/lib/query-keys";

const FRAME = { fps: 12, width: 640, height: 480 };

const upsert = (list: SignUtterance[] | undefined, u: SignUtterance) =>
  list?.some((x) => x.id === u.id) ? list : [...(list ?? []), u];

/** Accepted letters build an editable draft; only Enter/Send triggers composition and speech. */
export function SignPanel({ sessionId, variant = "page" }: { sessionId: string | null; variant?: "page" | "panel" }) {
  const queryClient = useQueryClient();
  const [source, setSource] = useState<SignSource>("SELF");
  const [speak, setSpeak] = useState(true);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const preview = useStreamPreview(camera);
  const history = useSignUtterances(sessionId);
  const create = useCreateSignUtterance(sessionId);

  const draftInput = useRef<HTMLTextAreaElement | null>(null);
  const draftId = useId();
  const sign = useSignService({
    onPhrase: async (tokens, phraseSource) => {
      const targetSession = sessionId;
      const shouldSpeak = speak;
      const utterance = await create.mutateAsync({ tokens, source: phraseSource, speak: shouldSpeak });
      if (targetSession) {
        queryClient.setQueryData<SignUtterance[]>(keys.utterances(targetSession), list => upsert(list, utterance));
      }
      if (shouldSpeak && utterance.source === "SELF") speakUtterance(utterance, { browserVoice: true });
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
    sign.stop();
    setCamera(null);
  };

  const utterances = [...(history.data ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const latest = utterances[0];
  const serviceReady = sign.ready;
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
      {sign.active ? (
        <Button variant="clay" onClick={sign.stop}>
          <Square /> Stop recognising
        </Button>
      ) : (
        <Button
          variant="clay"
          disabled={!serviceReady || !sessionId || sign.submitting}
          onClick={() => { sign.start({ source, ...FRAME }); draftInput.current?.focus(); }}
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
                (sign.active || Boolean(sign.draft.trim()) || sign.submitting) && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name={`sign-source-${variant}`}
                value={value}
                checked={source === value}
                disabled={sign.active || Boolean(sign.draft.trim()) || sign.submitting}
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
            className={cn("aspect-[4/3] w-full object-fill", source === "SELF" && "-scale-x-100", !camera && "invisible")}
          />
          {!camera && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-[#ecedea]/80">
              <Camera aria-hidden="true" className="size-8" />
              <p className="max-w-xs text-sm">Turn the camera on and fingerspell with one hand in view. Your video isn&apos;t recorded.</p>
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
        {sign.error && <InlineAlert>{sign.error}</InlineAlert>}
        {!serviceReady && sign.status !== "CONNECTING" && (
          <p className="text-sm text-muted-foreground">
            The sign recogniser isn&apos;t ready yet. Run <code className="font-mono">bun run sign:dev</code> on this laptop;
            this panel reconnects automatically.
          </p>
        )}
        {!sessionId && <InlineAlert>Choose a lecture first: sign messages are saved with a lecture.</InlineAlert>}
      </div>

      <div className="space-y-4">
        <section aria-label="Sentence draft" className="rounded-[1.5rem] clay-sm p-4">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={draftId} className="text-sm font-bold text-muted-foreground">Your sentence</label>
            <Button type="button" variant="ghost" size="sm" onClick={sign.reset}
              disabled={sign.submitting || (!sign.draft && !sign.partial)}>
              <X /> Clear sentence
            </Button>
          </div>
          <Textarea
            id={draftId}
            ref={draftInput}
            aria-label="Sentence draft"
            aria-describedby={draftId + "-help"}
            className="mt-2 min-h-24 font-mono"
            rows={3}
            maxLength={2048}
            value={sign.draft}
            readOnly={sign.submitting}
            aria-busy={sign.submitting}
            placeholder="Accepted letters appear here. Add spaces between words."
            onChange={event => sign.editDraft(event.target.value, source)}
            onKeyDown={event => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (!event.repeat && sessionId) void sign.submit();
            }}
          />
          <div className="mt-2 min-h-7 text-sm" aria-live="polite">
            {sign.partial ? (
              <span className="rounded-lg border border-dashed px-2 py-0.5 font-mono text-muted-foreground"
                title="Live guess — hold steady for one second to accept">
                Guess: {sign.partial}?
              </span>
            ) : (
              <span className="text-muted-foreground">
                {sign.streaming ? "Ready for the next letter." : "Start recognising to add letters, or edit your draft."}
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="clay-soft"
              disabled={sign.submitting || !sign.draft || sign.draft.endsWith(" ")}
              onClick={() => { sign.space(); draftInput.current?.focus(); }}>
              Add space
            </Button>
            <Button type="button" variant="clay-soft" disabled={sign.submitting || !sign.draft}
              aria-label="Backspace — delete last character"
              onClick={() => { sign.backspace(); draftInput.current?.focus(); }}>
              Backspace
            </Button>
            <Button type="button" variant="clay" disabled={sign.submitting || !sign.draft.trim() || !sessionId}
              onClick={() => { draftInput.current?.focus(); void sign.submit(); }}>
              <Send /> {sign.submitting ? "Sending…" : "Send sentence"}
            </Button>
          </div>
          <p id={draftId + "-help"} className="mt-2 text-xs text-muted-foreground">
            Hold each letter still for about one second, then move to the next sign.
            Press Space between words and Enter to send. Use Backspace to remove a mistake, or use the Backspace button to delete the last character.
            Lowering your hand keeps the draft; it does not add a space or send.
            For a repeated letter, briefly lower and show your hand again.
          </p>
          {create.isPending && <p className="mt-2 text-sm text-muted-foreground">Sending the sentence…</p>}

          <label className="mt-3 flex items-center gap-2.5 text-sm font-semibold">
            <input type="checkbox" checked={speak} disabled={sign.submitting}
              onChange={event => setSpeak(event.target.checked)} className="size-4 accent-[var(--marigold)]" />
            Say it out loud when I send
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
