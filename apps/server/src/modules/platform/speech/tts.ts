import { notImplemented } from "../../../lib/errors";
import type { SynthesizedAudio, TextToSpeech } from "./types";

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

/**
 * OWNER: Tushar — ElevenLabs (default) or Sarvam (Indian languages/voices) TTS.
 * TODO(tushar): POST text → audio/mpeg bytes; pick provider by TTS_PROVIDER; cache by hash(text+voice).
 */
export class ProviderTts implements TextToSpeech {
  constructor(
    readonly provider: "elevenlabs" | "sarvam",
    readonly apiKey: string | undefined,
    readonly voiceId: string | undefined,
  ) {}

  get name() {
    return this.provider;
  }

  async synthesize(_text: string): Promise<SynthesizedAudio> {
    throw notImplemented(`${this.provider} TTS`, "Tushar");
  }
}

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
