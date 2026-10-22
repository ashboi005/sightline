/**
 * OWNER: Ashwath — Deepgram streaming STT (MOCK_SPEECH=false).
 *
 * One Deepgram live socket per caption stream:
 *   wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&interim_results=true&keyterm=…
 * Interim results update one RawTranscriptSegment (same id); `is_final` closes it and the next words start a new
 * segment. Audio pushed before the socket opens (or during a reconnect) is buffered, bounded to a few seconds.
 */
import type { RawTranscriptSegment } from "@sightline/contracts";

import { AppError } from "../../../lib/errors";
import { newId } from "../../../lib/ids";
import type { SpeechToText, SttStream, SttStreamOptions } from "./types";

type WebSocketFactory = (url: string, headers: Record<string, string>) => WebSocket;

export type DeepgramOptions = {
  apiKey: string | undefined;
  model: string;
  language: string;
  /** Override for tests. */
  baseUrl?: string;
  /** Silence keep-alive interval (Deepgram closes idle sockets after ~10 s). */
  keepAliveMs?: number;
  maxReconnects?: number;
  createSocket?: WebSocketFactory;
};

/** Deepgram `Results` message (fields we use). */
type DeepgramResults = {
  type: "Results";
  start: number;
  duration: number;
  is_final: boolean;
  speech_final?: boolean;
  channel: { alternatives: { transcript: string; confidence: number }[] };
};

const MAX_BUFFERED_BYTES = 5 * 16000 * 2; // ~5 s of 16 kHz linear16
const MAX_KEYTERMS = 100;

const defaultSocket: WebSocketFactory = (url, headers) =>
  // Bun's WebSocket accepts request headers (browsers don't; this runs server-side only).
  new WebSocket(url, { headers } as unknown as string[]);

export function buildDeepgramUrl(base: string, opts: DeepgramOptions, stream: SttStreamOptions): string {
  const params = new URLSearchParams({
    model: opts.model,
    language: opts.language,
    encoding: "linear16",
    sample_rate: String(stream.format.sampleRate),
    channels: String(stream.format.channels),
    interim_results: "true",
    smart_format: "true",
    punctuate: "true",
    endpointing: "300",
    utterance_end_ms: "1000",
    vad_events: "true",
  });
  // Keyterm prompting is a Nova-3 feature; other models reject the parameter.
  if (opts.model.startsWith("nova-3")) {
    for (const term of [...new Set(stream.keyterms.map((t) => t.trim()).filter(Boolean))].slice(0, MAX_KEYTERMS)) {
      params.append("keyterm", term);
    }
  }
  return `${base.replace(/\/$/, "")}/v1/listen?${params}`;
}

export class DeepgramStt implements SpeechToText {
  readonly name = "deepgram";
  readonly isReplay = false;

  constructor(private readonly opts: DeepgramOptions) {}

  open(options: SttStreamOptions): SttStream {
    if (!this.opts.apiKey) throw new AppError("UPSTREAM_ERROR", "DEEPGRAM_API_KEY is not set");
    return new DeepgramStream(this.opts, options);
  }
}

class DeepgramStream implements SttStream {
  private socket: WebSocket | null = null;
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private closed = false;
  private reconnects = 0;
  private lastAudioAt = 0;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  /** Offset (ms) of the current Deepgram stream's t=0 relative to the session start. */
  private streamOffsetMs = 0;
  private current: { id: string; seq: number } | null = null;
  private closedPromise: Promise<void> | null = null;

  constructor(
    private readonly opts: DeepgramOptions,
    private readonly stream: SttStreamOptions,
  ) {
    this.connect();
  }

  private connect() {
    const url = buildDeepgramUrl(this.opts.baseUrl ?? "wss://api.deepgram.com", this.opts, this.stream);
    const socket = (this.opts.createSocket ?? defaultSocket)(url, { Authorization: `Token ${this.opts.apiKey}` });
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      this.streamOffsetMs = Date.now() - this.stream.startedAt;
      this.reconnects = 0;
      for (const chunk of this.pending) socket.send(chunk);
      this.pending = [];
      this.pendingBytes = 0;
      this.lastAudioAt = Date.now();
      this.keepAlive = setInterval(() => {
        if (Date.now() - this.lastAudioAt >= (this.opts.keepAliveMs ?? 5000) && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "KeepAlive" }));
        }
      }, Math.min(1000, this.opts.keepAliveMs ?? 5000));
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let message: { type?: string };
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "Results") this.onResults(message as DeepgramResults);
      else if (message.type === "Error") {
        this.stream.onError(new Error(`Deepgram error: ${JSON.stringify(message).slice(0, 300)}`));
      }
    };

    socket.onclose = (event) => {
      if (this.keepAlive) clearInterval(this.keepAlive);
      this.keepAlive = null;
      if (this.closed) return;
      const max = this.opts.maxReconnects ?? 3;
      if (this.reconnects >= max) {
        this.stream.onError(new Error(`Deepgram connection closed (${event.code} ${event.reason})`));
        this.closed = true;
        return;
      }
      this.flushCurrentAsFinal();
      const delay = 250 * 2 ** this.reconnects++;
      setTimeout(() => !this.closed && this.connect(), delay);
    };
  }

  private onResults(msg: DeepgramResults) {
    const alt = msg.channel?.alternatives?.[0];
    const text = alt?.transcript?.trim() ?? "";
    if (!text && !this.current) return;

    if (!this.current) this.current = { id: newId("seg"), seq: this.stream.nextSeq() };
    const startMs = Math.max(0, Math.round(this.streamOffsetMs + msg.start * 1000));
    const segment: RawTranscriptSegment = {
      id: this.current.id,
      sessionId: this.stream.sessionId,
      seq: this.current.seq,
      startMs,
      endMs: Math.max(startMs, Math.round(this.streamOffsetMs + (msg.start + msg.duration) * 1000)),
      text,
      isFinal: msg.is_final && text.length > 0,
      speaker: null,
      confidence: clamp01(alt?.confidence ?? 0),
    };
    if (msg.is_final) {
      // An empty final after interims means "nothing was said": clear the interim line.
      this.stream.onSegment(text ? segment : { ...segment, isFinal: false, text: "" });
      this.current = null;
    } else {
      this.stream.onSegment(segment);
    }
  }

  /** Socket dropped mid-utterance: clear the dangling interim instead of leaving it on screen. */
  private flushCurrentAsFinal() {
    if (!this.current) return;
    const now = Date.now() - this.stream.startedAt;
    this.stream.onSegment({
      id: this.current.id,
      sessionId: this.stream.sessionId,
      seq: this.current.seq,
      startMs: now,
      endMs: now,
      text: "",
      isFinal: false,
      speaker: null,
      confidence: 0,
    });
    this.current = null;
  }

  push(chunk: Uint8Array): void {
    if (this.closed || chunk.byteLength === 0) return;
    this.lastAudioAt = Date.now();
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(chunk);
      return;
    }
    this.pending.push(chunk.slice());
    this.pendingBytes += chunk.byteLength;
    while (this.pendingBytes > MAX_BUFFERED_BYTES && this.pending.length > 1) {
      this.pendingBytes -= this.pending.shift()!.byteLength;
    }
  }

  /** Ask Deepgram to flush remaining results, then close (bounded wait). */
  close(): Promise<void> {
    if (this.closedPromise) return this.closedPromise;
    this.closed = true;
    const socket = this.socket;
    this.closedPromise = new Promise<void>((resolve) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        if (this.keepAlive) clearInterval(this.keepAlive);
        socket?.close();
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        socket.close();
        resolve();
      }, 2000);
      socket.addEventListener("close", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.send(JSON.stringify({ type: "CloseStream" }));
    });
    return this.closedPromise;
  }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
