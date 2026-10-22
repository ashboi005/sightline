/**
 * OWNER: Ashwath — Sarvam streaming STT for Hinglish / Indian languages (STT_PROVIDER=sarvam).
 *
 *   wss://api.sarvam.ai/speech-to-text/ws?language-code=hi-IN&model=saaras:v3&mode=codemix&input_audio_codec=pcm_s16le…
 *   auth header: Api-Subscription-Key
 *   client → {"audio": {"data": <base64 PCM>, "sample_rate": "16000", "encoding": "audio/wav"}}, {"type": "flush"}
 *   server → {"type": "events", data: {signal_type: START_SPEECH|END_SPEECH}} | {"type": "data", data: {transcript, …}}
 *
 * Sarvam returns one transcript per utterance (no word-level interims), so START_SPEECH opens a segment with an
 * interim "…" placeholder and the `data` message finalises it under the same id.
 */
import type { RawTranscriptSegment } from "@sightline/contracts";

import { AppError } from "../../../lib/errors";
import { newId } from "../../../lib/ids";
import type { SpeechToText, SttStream, SttStreamOptions } from "./types";

type WebSocketFactory = (url: string, headers: Record<string, string>) => WebSocket;

export type SarvamSttOptions = {
  apiKey: string | undefined;
  model: string;
  mode: string;
  language: string;
  baseUrl?: string;
  maxReconnects?: number;
  createSocket?: WebSocketFactory;
};

const MAX_BUFFERED_BYTES = 5 * 16000 * 2;
export const SPEAKING_PLACEHOLDER = "…";

const defaultSocket: WebSocketFactory = (url, headers) => new WebSocket(url, { headers } as unknown as string[]);

export function buildSarvamUrl(base: string, opts: SarvamSttOptions, stream: SttStreamOptions): string {
  const params = new URLSearchParams({
    "language-code": opts.language,
    model: opts.model,
    mode: opts.mode,
    sample_rate: String(stream.format.sampleRate),
    input_audio_codec: "pcm_s16le",
    vad_signals: "true",
    high_vad_sensitivity: "true",
  });
  return `${base.replace(/\/$/, "")}/speech-to-text/ws?${params}`;
}

export class SarvamStt implements SpeechToText {
  readonly name = "sarvam";
  readonly isReplay = false;

  constructor(private readonly opts: SarvamSttOptions) {}

  open(options: SttStreamOptions): SttStream {
    if (!this.opts.apiKey) throw new AppError("UPSTREAM_ERROR", "SARVAM_API_KEY is not set");
    if (options.format.sampleRate !== 16000) throw new AppError("VALIDATION_ERROR", "Sarvam streaming expects 16 kHz audio");
    return new SarvamStream(this.opts, options);
  }
}

type SarvamMessage =
  | { type: "data"; data: { transcript?: string; metrics?: { audio_duration?: number } } }
  | { type: "events"; data: { signal_type?: string } }
  | { type: "error"; data: { error?: string; code?: string } };

class SarvamStream implements SttStream {
  private socket: WebSocket | null = null;
  private pending: string[] = [];
  private pendingBytes = 0;
  private closed = false;
  private reconnects = 0;
  private current: { id: string; seq: number; startedAtMs: number } | null = null;
  private closedPromise: Promise<void> | null = null;

  constructor(
    private readonly opts: SarvamSttOptions,
    private readonly stream: SttStreamOptions,
  ) {
    this.connect();
  }

  private connect() {
    const url = buildSarvamUrl(this.opts.baseUrl ?? "wss://api.sarvam.ai", this.opts, this.stream);
    const socket = (this.opts.createSocket ?? defaultSocket)(url, { "Api-Subscription-Key": this.opts.apiKey! });
    this.socket = socket;

    socket.onopen = () => {
      this.reconnects = 0;
      for (const frame of this.pending) socket.send(frame);
      this.pending = [];
      this.pendingBytes = 0;
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let msg: SarvamMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === "events" && msg.data?.signal_type === "START_SPEECH") this.onSpeechStart();
      else if (msg.type === "data") this.onTranscript(msg.data?.transcript ?? "", msg.data?.metrics?.audio_duration);
      else if (msg.type === "error") {
        this.stream.onError(new Error(`Sarvam STT error ${msg.data?.code ?? ""}: ${msg.data?.error ?? "unknown"}`));
      }
    };

    socket.onclose = (event) => {
      if (this.closed) return;
      const max = this.opts.maxReconnects ?? 3;
      if (this.reconnects >= max) {
        this.stream.onError(new Error(`Sarvam connection closed (${event.code} ${event.reason})`));
        this.closed = true;
        return;
      }
      this.clearPlaceholder();
      const delay = 250 * 2 ** this.reconnects++;
      setTimeout(() => !this.closed && this.connect(), delay);
    };
  }

  private now() {
    return Math.max(0, Date.now() - this.stream.startedAt);
  }

  private segment(text: string, isFinal: boolean, startMs: number, endMs: number): RawTranscriptSegment {
    return {
      id: this.current!.id,
      sessionId: this.stream.sessionId,
      seq: this.current!.seq,
      startMs,
      endMs: Math.max(startMs, endMs),
      text,
      isFinal,
      speaker: null,
      confidence: isFinal ? 0.85 : 0.3,
    };
  }

  private onSpeechStart() {
    if (this.current) return;
    const at = this.now();
    this.current = { id: newId("seg"), seq: this.stream.nextSeq(), startedAtMs: at };
    this.stream.onSegment(this.segment(SPEAKING_PLACEHOLDER, false, at, at));
  }

  private onTranscript(transcript: string, audioDuration: number | undefined) {
    const text = transcript.trim();
    const end = this.now();
    if (!this.current) {
      if (!text) return;
      const start = audioDuration ? Math.max(0, end - Math.round(audioDuration * 1000)) : end;
      this.current = { id: newId("seg"), seq: this.stream.nextSeq(), startedAtMs: start };
    }
    // An empty transcript (noise) clears the "…" line instead of finalising nothing.
    this.stream.onSegment(text ? this.segment(text, true, this.current.startedAtMs, end) : this.segment("", false, end, end));
    this.current = null;
  }

  private clearPlaceholder() {
    if (!this.current) return;
    const at = this.now();
    this.stream.onSegment(this.segment("", false, at, at));
    this.current = null;
  }

  push(chunk: Uint8Array): void {
    if (this.closed || chunk.byteLength === 0) return;
    const frame = JSON.stringify({
      audio: { data: Buffer.from(chunk).toString("base64"), sample_rate: "16000", encoding: "audio/wav" },
    });
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(frame);
      return;
    }
    this.pending.push(frame);
    this.pendingBytes += chunk.byteLength;
    while (this.pendingBytes > MAX_BUFFERED_BYTES && this.pending.length > 1) {
      const dropped = this.pending.shift()!;
      this.pendingBytes -= Math.floor((dropped.length * 3) / 4);
    }
  }

  /** Flush the last utterance (bounded wait for its transcript), then close. */
  close(): Promise<void> {
    if (this.closedPromise) return this.closedPromise;
    this.closed = true;
    const socket = this.socket;
    this.closedPromise = new Promise<void>((resolve) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        socket?.close();
        resolve();
        return;
      }
      const finish = () => {
        clearTimeout(timer);
        socket.removeEventListener("message", onMessage);
        socket.close();
        resolve();
      };
      const onMessage = (event: MessageEvent) => {
        if (typeof event.data === "string" && event.data.includes('"type":"data"')) finish();
      };
      const timer = setTimeout(finish, this.current ? 1500 : 300);
      socket.addEventListener("message", onMessage);
      socket.send(JSON.stringify({ type: "flush" }));
    });
    return this.closedPromise;
  }
}
