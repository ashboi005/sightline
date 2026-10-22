"use client";

import type { RecordingSource } from "@sightline/contracts";
import { createRecordingUploader, type RecordingUploader } from "@sightline/contracts/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, errorMessage } from "@/lib/api";
import { describeMediaError } from "@/lib/media/errors";
import { keys } from "@/lib/query-keys";
import { pickRecordingFormat } from "@/lib/recordings/format";

const SEGMENT_MS = 5 * 60_000; // one self-contained file every 5 minutes

export type RecorderState =
  | { status: "idle" }
  | { status: "starting"; source: RecordingSource }
  /** `segmentsSent` counts finished segments handed to the uploader; exact upload results arrive when stopping. */
  | { status: "recording"; source: RecordingSource; startedAt: number; segmentsSent: number }
  | { status: "stopping"; source: RecordingSource }
  | { status: "finished"; recordingStatus: "READY" | "FAILED" | "RECORDING"; segmentsUploaded: number; uploadFailures: number }
  | { status: "error"; message: string };

type Active = {
  sessionId: string;
  /** The session's `startedAt`: segment times are offsets from it. */
  sessionStartedAt: number;
  source: RecordingSource;
  uploader: RecordingUploader;
  stream: MediaStream;
  /** Tracks this recorder opened itself (webcam/screen/mic); the scene camera belongs to the lecture. */
  ownTracks: MediaStreamTrack[];
  mimeType: string;
  contentType: string;
  recorder: MediaRecorder;
  segmentStart: number;
  stopped: Promise<Blob>;
  rotate: ReturnType<typeof setInterval>;
};

/**
 * Records the lecture in independently playable segments and uploads them through the recordings contract
 * (`createRecordingUploader`): reserve → presigned PUT → complete, in order, with retries.
 * Segment times are on the lecture clock (`startMs` = offset from the session's `startedAt`).
 */
export function useLectureRecorder() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<RecorderState>({ status: "idle" });
  const active = useRef<Active | null>(null);

  const recordSegment = (a: Omit<Active, "recorder" | "segmentStart" | "stopped" | "rotate">) => {
    const recorder = new MediaRecorder(a.stream, { mimeType: a.mimeType, videoBitsPerSecond: 1_000_000 });
    const parts: Blob[] = [];
    const stopped = new Promise<Blob>((resolve) => {
      recorder.ondataavailable = (e) => e.data.size && parts.push(e.data);
      recorder.onstop = () => resolve(new Blob(parts, { type: a.contentType }));
    });
    recorder.start();
    return { recorder, segmentStart: Date.now(), stopped };
  };

  /** Ends the current segment, waits for its final data, and queues it for upload. */
  const closeSegment = async (a: Active) => {
    if (a.recorder.state !== "inactive") a.recorder.stop();
    const blob = await a.stopped;
    void a.uploader.addSegment(blob, {
      startMs: Math.max(0, a.segmentStart - a.sessionStartedAt),
      durationMs: Date.now() - a.segmentStart,
    });
    setState((s) => (s.status === "recording" ? { ...s, segmentsSent: s.segmentsSent + 1 } : s));
  };

  const stop = useCallback(async () => {
    const a = active.current;
    if (!a) return null;
    active.current = null;
    clearInterval(a.rotate);
    setState({ status: "stopping", source: a.source });
    try {
      await closeSegment(a);
      const result = await a.uploader.finish();
      setState({
        status: "finished",
        recordingStatus: result.recording.status,
        segmentsUploaded: result.uploaded.length,
        uploadFailures: result.failures.length,
      });
      return result;
    } catch (error) {
      setState({ status: "error", message: `The recording couldn't be saved: ${errorMessage(error)}` });
      return null;
    } finally {
      a.ownTracks.forEach((t) => t.stop());
      void queryClient.invalidateQueries({ queryKey: keys.recordings(a.sessionId) });
    }
  }, [queryClient]);

  const start = useCallback(
    async (options: { sessionId: string; sessionStartedAt: number; source: RecordingSource; sceneStream: MediaStream | null }) => {
      const { sessionId, sessionStartedAt, source, sceneStream } = options;
      if (active.current) return;
      if (typeof MediaRecorder === "undefined") {
        setState({ status: "error", message: "This browser can't record video. Try Chrome, Edge or Safari." });
        return;
      }
      setState({ status: "starting", source });
      const ownTracks: MediaStreamTrack[] = [];
      try {
        let video: MediaStream;
        if (source === "SCENE_CAMERA") {
          if (!sceneStream) throw new Error("Turn on the scene camera first, or record the webcam or screen instead.");
          video = sceneStream;
        } else {
          try {
            video =
              source === "SCREEN"
                ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
                : await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          } catch (e) {
            throw new Error(describeMediaError(e, source === "SCREEN" ? "screen" : "camera"));
          }
          ownTracks.push(...video.getTracks());
        }

        // Room audio on its own track (the caption mic is a separate, processed capture).
        const audio = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        if (audio) ownTracks.push(...audio.getTracks());

        const format = pickRecordingFormat((m) => MediaRecorder.isTypeSupported(m), true);
        if (!format || !format.contentType.startsWith("video/")) throw new Error("This browser can't record video in a format Sightline accepts.");

        const stream = new MediaStream([...video.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])]);
        const uploader = await createRecordingUploader(api, sessionId, {
          source,
          contentType: format.contentType as "video/webm" | "video/mp4",
        });
        const base = { sessionId, sessionStartedAt, source, uploader, stream, ownTracks, mimeType: format.mimeType, contentType: format.contentType };
        const a: Active = {
          ...base,
          ...recordSegment(base),
          rotate: setInterval(async () => {
            const current = active.current;
            if (!current) return;
            const previous = { ...current };
            Object.assign(current, recordSegment(base)); // start the next file first, so the gap is tiny
            await closeSegment(previous);
          }, SEGMENT_MS),
        };
        active.current = a;
        // If the student stops sharing their screen (or the camera disappears), finish cleanly.
        video.getVideoTracks()[0]?.addEventListener("ended", () => void stop());
        setState({ status: "recording", source, startedAt: Date.now(), segmentsSent: 0 });
        void queryClient.invalidateQueries({ queryKey: keys.recordings(sessionId) });
      } catch (error) {
        ownTracks.forEach((t) => t.stop());
        setState({ status: "error", message: errorMessage(error) });
      }
    },
    [stop, queryClient],
  );

  // Leaving the page mid-recording would lose the current segment: ask first.
  useEffect(() => {
    if (state.status !== "recording") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.status]);

  return { state, start, stop, reset: () => setState({ status: "idle" }) };
}
