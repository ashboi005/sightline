/**
 * OWNER: Ashwath. Text-to-speech for sign-language sentences.
 *   MOCK_SPEECH=true → MockTts (chime). Otherwise ElevenLabsTts or SarvamTts (TTS_PROVIDER), wrapped in CachedTts.
 */
import { AppError } from "../../../lib/errors";
import type { SynthesizedAudio, TextToSpeech } from "./types";

type Fetch = typeof fetch;
const TTS_TIMEOUT_MS = 10_000;
const MAX_TEXT = 1000;

/**
 * Mock TTS: a short two-note chime (WAV) whose length scales with the text, so the web app can exercise
 * real audio playback. The web app may additionally speak the text with the Web Speech API in mock mode.
 */
export class MockTts implements TextToSpeech {
  readonly name = "mock-chime";

  async synthesize(text: string): Promise<SynthesizedAudio> {
    const seconds = Math.min(2, 0.4 + text.length * 0.01);
    return { contentType: "audio/wav", bytes: chimeWav(seconds) };
  }
}

/** ElevenLabs `POST /v1/text-to-speech/{voice_id}` → MP3. */
export class ElevenLabsTts implements TextToSpeech {
  readonly name = "elevenlabs";

  constructor(
    private readonly opts: { apiKey: string | undefined; voiceId: string; modelId: string; fetch?: Fetch },
  ) {}

  async synthesize(text: string, options?: { voiceId?: string }): Promise<SynthesizedAudio> {
    if (!this.opts.apiKey) throw new AppError("UPSTREAM_ERROR", "ELEVENLABS_API_KEY is not set");
    const voice = encodeURIComponent(options?.voiceId ?? this.opts.voiceId);
    const res = await (this.opts.fetch ?? fetch)(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": this.opts.apiKey, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text: clip(text), model_id: this.opts.modelId }),
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      },
    );
    if (!res.ok) throw upstream("ElevenLabs", res.status, await res.text().catch(() => ""));
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0) throw new AppError("UPSTREAM_ERROR", "ElevenLabs returned empty audio");
    return { contentType: "audio/mpeg", bytes };
  }
}

/** Sarvam `POST /text-to-speech` → `{ audios: [base64 wav] }`. Good for Indian-English / Indian-language voices. */
export class SarvamTts implements TextToSpeech {
  readonly name = "sarvam";

  constructor(
    private readonly opts: {
      apiKey: string | undefined;
      model: string;
      speaker: string;
      language: string;
      fetch?: Fetch;
    },
  ) {}

  async synthesize(text: string, options?: { voiceId?: string }): Promise<SynthesizedAudio> {
    if (!this.opts.apiKey) throw new AppError("UPSTREAM_ERROR", "SARVAM_API_KEY is not set");
    const res = await (this.opts.fetch ?? fetch)("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: { "api-subscription-key": this.opts.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        text: clip(text),
        language_code: this.opts.language,
        model: this.opts.model,
        speaker: options?.voiceId ?? this.opts.speaker,
        speech_sample_rate: 22050,
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });
    if (!res.ok) throw upstream("Sarvam", res.status, await res.text().catch(() => ""));
    const body = (await res.json()) as { audios?: unknown };
    const first = Array.isArray(body.audios) ? body.audios[0] : undefined;
    if (typeof first !== "string" || first.length === 0) {
      throw new AppError("UPSTREAM_ERROR", "Sarvam returned no audio");
    }
    return { contentType: "audio/wav", bytes: new Uint8Array(Buffer.from(first, "base64")) };
  }
}

/** Small in-memory LRU so repeated phrases ("Thank you!") don't cost another API call. */
export class CachedTts implements TextToSpeech {
  private readonly cache = new Map<string, SynthesizedAudio>();

  constructor(
    private readonly inner: TextToSpeech,
    private readonly maxEntries = 100,
  ) {}

  get name() {
    return this.inner.name;
  }

  async synthesize(text: string, options?: { voiceId?: string }): Promise<SynthesizedAudio> {
    const key = `${options?.voiceId ?? ""}\u0000${text.trim()}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const audio = await this.inner.synthesize(text, options);
    this.cache.set(key, audio);
    if (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value!);
    return audio;
  }
}

const clip = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) throw new AppError("VALIDATION_ERROR", "Nothing to speak");
  return trimmed.slice(0, MAX_TEXT);
};

const upstream = (provider: string, status: number, body: string) =>
  new AppError("UPSTREAM_ERROR", `${provider} TTS failed (${status})`, body.slice(0, 300));

function chimeWav(seconds: number, sampleRate = 22050): Uint8Array {
  const samples = Math.floor(seconds * sampleRate);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples * 2, true);

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const freq = t < seconds / 2 ? 660 : 880;
    const envelope = Math.min(1, t * 20) * Math.max(0, 1 - t / seconds);
    view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * freq * t) * envelope * 0.3 * 32767, true);
  }
  return new Uint8Array(buffer);
}
