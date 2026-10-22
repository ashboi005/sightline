"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { InlineAlert } from "@/components/clay/clay";
import { coveredRange, formatClock, locate, toLectureMs, type PlayableSegment } from "@/lib/recordings/timeline";

export type SeekRequest = { ms: number; nonce: number };

/**
 * Plays a recording's segments in order on the lecture clock. Seeking converts lecture time to the segment that
 * holds it (gaps jump to the next part). An expired playback URL is refreshed once before reporting an error.
 */
export function RecordingPlayer({
  segments,
  seek,
  onTime,
  onExpired,
}: {
  segments: PlayableSegment[];
  seek: SeekRequest | null;
  onTime: (lectureMs: number) => void;
  /** Ask for fresh presigned URLs (they last about an hour). */
  onExpired: () => Promise<unknown>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingOffset = useRef<number | null>(null);
  const autoplay = useRef(false);
  const retried = useRef(false);
  const segment = segments[Math.min(index, segments.length - 1)]!;
  const range = coveredRange(segments);

  const goTo = useEffectEvent((ms: number) => {
    const target = locate(segments, ms);
    if (!target) return;
    setNote(target.inGap ? `No video was recorded at ${formatClock(ms)}, so playback starts at the next recorded part.` : null);
    if (target.index === index && video.current) {
      video.current.currentTime = target.offsetSeconds;
      void video.current.play().catch(() => {});
    } else {
      pendingOffset.current = target.offsetSeconds;
      autoplay.current = true;
      setIndex(target.index);
    }
  });

  useEffect(() => {
    if (seek) goTo(seek.ms);
  }, [seek]);

  const onLoaded = () => {
    const v = video.current;
    if (!v) return;
    if (pendingOffset.current !== null) v.currentTime = pendingOffset.current;
    pendingOffset.current = null;
    if (autoplay.current) void v.play().catch(() => {});
    autoplay.current = false;
  };

  const onEnded = () => {
    if (index >= segments.length - 1) return;
    pendingOffset.current = 0;
    autoplay.current = true;
    setIndex(index + 1);
  };

  const onError = async () => {
    const v = video.current;
    if (retried.current) {
      setError("This part of the recording won't play. It may not have finished uploading.");
      return;
    }
    retried.current = true;
    pendingOffset.current = v?.currentTime ?? 0;
    autoplay.current = !v?.paused;
    await onExpired();
  };

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-[1.4rem] bg-black">
        <video
          key={segment.index}
          ref={video}
          src={segment.url}
          controls
          playsInline
          preload="metadata"
          aria-label={`Lecture recording, part ${index + 1} of ${segments.length}`}
          onLoadedMetadata={onLoaded}
          onTimeUpdate={(e) => onTime(toLectureMs(segment, e.currentTarget.currentTime))}
          onEnded={onEnded}
          onError={() => void onError()}
          onPlaying={() => {
            retried.current = false;
            setError(null);
          }}
          className="aspect-video w-full"
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {segments.length > 1 && `Part ${index + 1} of ${segments.length} · `}
        {range && `Covers ${formatClock(range.startMs)}–${formatClock(range.endMs)} of the lecture`}
      </p>
      {note && <p className="rounded-xl bg-highlight px-3 py-2 text-sm font-medium">{note}</p>}
      {error && <InlineAlert>{error}</InlineAlert>}
    </div>
  );
}
