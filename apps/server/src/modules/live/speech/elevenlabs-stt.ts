/**
 * OWNER: Ashwath — ElevenLabs Scribe v2 Realtime STT (STT_PROVIDER=elevenlabs, the default).
 *
 *   1. POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe  (xi-api-key) → { token }   (one per socket)
 *   2. wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000
 *        &commit_strategy=vad&language_code=en|hi[&secondary_languages=en]&keyterms=…&token=…
 *   client → { message_type: "input_audio_chunk", audio_base_64, commit: false, sample_rate: 16000 }
 *   server → session_started | partial_transcript {text} | committed_transcript {text} | *_error
 *
 * partial_transcript updates one RawTranscriptSegment (same id); committed_transcript finalises it.
 */
import type { RawTranscriptSegment } from "@sightline/contracts";

import { AppError } from "../../../lib/errors";
import { newId } from "../../../lib/ids";
import type { SpeechToText, SttStream, SttStreamOptions } from "./types";

export type ElevenLabsSttOptions = {
  apiKey: string | undefined;
  model: string;
  /** "en", or "hi" for Hinglish (English allowed as secondary language). */
  language: "en" | "hi";
  vadSilenceSecs: number;
  /** https://api.elevenlabs.io (override for tests). */
  baseUrl?: string;
  maxReconnects?: number;
  fetch?: typeof fetch;
};

const MAX_BUFFERED_BYTES = 5 * 16000 * 2;
const MAX_KEYTERMS = 50;
const TERMINAL_ERRORS = new Set([
  "auth_error",
  "quota_exceeded",
  "quota_exceeded_error",
  "unaccepted_terms",
  "input_error",
  "invalid_request",
  "invalid_request_error",
  "chunk_size_exceeded",
  "session_time_limit_exceeded",
]);

export function buildScribeUrl(opts: ElevenLabsSttOptions, stream: SttStreamOptions, token: string): string {
  const params = new URLSearchParams({
    model_id: opts.model,
    language_code: opts.language,
    audio_format: `pcm_${stream.format.sampleRate}`,
    commit_strategy: "vad",
    vad_silence_threshold_secs: String(opts.vadSilenceSecs),
  });
  if (opts.language === "hi") params.append("secondary_languages", "en"); // Hinglish keeps both halves
  for (const term of [...new Set(stream.keyterms.map((t) => t.trim()).filter(Boolean))].slice(0, MAX_KEYTERMS)) {
    params.append("keyterms", term);
  }
  params.append("token", token);
  const ws = (opts.baseUrl ?? "https://api.elevenlabs.io").replace(/^http/, "ws").replace(/\/$/, "");
  return `${ws}/v1/speech-to-text/realtime?${params}`;
}

export class ElevenLabsStt implements SpeechToText {
  readonly name = "elevenlabs-scribe";
  readonly isReplay = false;

  constructor(private readonly opts: ElevenLabsSttOptions) {}

  open(options: SttStreamOptions): SttStream {
    if (!this.opts.apiKey) throw new AppError("UPSTREAM_ERROR", "ELEVENLABS_API_KEY is not set");
    if (options.format.sampleRate !== 16000) throw new AppError("VALIDATION_ERROR", "Scribe realtime expects 16 kHz audio");
    return new ScribeStream(this.opts, options);
  }
}

type ScribeMessage = { message_type?: string; text?: unknown; error?: unknown };

class ScribeStream implements SttStream {
  private socket: WebSocket | null = null;
  private ready = false;
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private closed = false;
  private reconnects = 0;
  private current: { id: string; seq: number; startMs: number } | null = null;
  private closedPromise: Promise<void> | null = null;

  constructor(
    private readonly opts: ElevenLabsSttOptions,
    private readonly stream: SttStreamOptions,
  ) {
    void this.connect();
  }

  private async mintToken(): Promise<string> {
    const base = (this.opts.baseUrl ?? "https://api.elevenlabs.io").replace(/\/$/, "");
    const res = await (this.opts.fetch ?? fetch)(`${base}/v1/single-use-token/realtime_scribe`, {
      method: "POST",
      headers: { "xi-api-key": this.opts.apiKey! },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`ElevenLabs token ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const body = (await res.json().catch(() => null)) as { token?: string } | null;
    if (!body?.token) throw new Error("ElevenLabs token response had no token");
    return body.token;
  }

  private async connect() {
    let token: string;
    try {
      token = await this.mintToken();
    } catch (error) {
      this.retryOrFail(error instanceof Error ? error.message : String(error));
      return;
    }
    if (this.closed) return;
    const socket = new WebSocket(buildScribeUrl(this.opts, this.stream, token));
    this.socket = socket;

    socket.onmessage = (event) => {
      let msg: ScribeMessage;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const type = msg.message_type ?? "";
      if (type === "session_started") {
        this.ready = true;
        this.reconnects = 0;
        for (const chunk of this.pending) this.sendChunk(chunk);
        this.pending = [];
        this.pendingBytes = 0;
      } else if (type === "partial_transcript" && typeof msg.text === "string") {
        this.onPartial(msg.text);
      } else if (type.startsWith("committed_transcript") && typeof msg.text === "string") {
        this.onCommitted(msg.text);
      } else if (type.includes("error") || TERMINAL_ERRORS.has(type) || /rate|throttl|quota|exhausted/.test(type)) {
        this.stream.onError(new Error(`ElevenLabs STT ${type}${msg.error ? `: ${String(msg.error).slice(0, 200)}` : ""}`));
        if (TERMINAL_ERRORS.has(type)) this.closed = true;
        socket.close();
      }
    };

    socket.onclose = () => {
      this.ready = false;
      if (this.closed) return;
      this.clearInterim();
      this.retryOrFail("connection closed");
    };
  }

  private retryOrFail(reason: string) {
    if (this.closed) return;
    if (this.reconnects >= (this.opts.maxReconnects ?? 3)) {
      this.closed = true;
      this.stream.onError(new Error(`ElevenLabs STT unavailable (${reason})`));
      return;
    }
    const delay = 250 * 2 ** this.reconnects++;
    setTimeout(() => !this.closed && void this.connect(), delay);
  }

  private now() {
    return Math.max(0, Date.now() - this.stream.startedAt);
  }

  private emit(text: string, isFinal: boolean) {
    const c = this.current!;
    const segment: RawTranscriptSegment = {
      id: c.id,
      sessionId: this.stream.sessionId,
      seq: c.seq,
      startMs: c.startMs,
      endMs: Math.max(c.startMs, this.now()),
      text,
      isFinal,
      speaker: null,
      confidence: isFinal ? 0.9 : 0.5,
    };
    this.stream.onSegment(segment);
  }

  private onPartial(raw: string) {
    const text = raw.trim();
    if (!text) return;
    this.current ??= { id: newId("seg"), seq: this.stream.nextSeq(), startMs: this.now() };
    this.emit(text, false);
  }

  private onCommitted(raw: string) {
    const text = raw.trim();
    if (!this.current) {
      if (!text) return;
      this.current = { id: newId("seg"), seq: this.stream.nextSeq(), startMs: this.now() };
    }
    this.emit(text, text.length > 0); // empty commit after partials clears the interim line
    this.current = null;
  }

  private clearInterim() {
    if (!this.current) return;
    this.emit("", false);
    this.current = null;
  }

  private sendChunk(chunk: Uint8Array) {
    this.socket?.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: Buffer.from(chunk).toString("base64"),
        commit: false,
        sample_rate: this.stream.format.sampleRate,
      }),
    );
  }

  push(chunk: Uint8Array): void {
    if (this.closed || chunk.byteLength === 0) return;
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) {
      this.sendChunk(chunk);
      return;
    }
    this.pending.push(chunk.slice());
    this.pendingBytes += chunk.byteLength;
    while (this.pendingBytes > MAX_BUFFERED_BYTES && this.pending.length > 1) {
      this.pendingBytes -= this.pending.shift()!.byteLength;
    }
  }

  /** Feed ~1 s of silence so VAD commits the last line, wait briefly for it, then close. */
  close(): Promise<void> {
    if (this.closedPromise) return this.closedPromise;
    this.closedPromise = (async () => {
      const socket = this.socket;
      if (socket && this.ready && socket.readyState === WebSocket.OPEN && this.current) {
        const silence = new Uint8Array(3200);
        for (let i = 0; i < 10; i++) this.sendChunk(silence);
        const deadline = Date.now() + 1500;
        while (this.current && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
      }
      this.closed = true;
      socket?.close();
    })();
    return this.closedPromise;
  }
}
