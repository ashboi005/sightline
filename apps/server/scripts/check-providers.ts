/**
 * Real-provider check with the keys in apps/server/.env (never prints keys).
 *   bun run --filter server check:providers
 *
 * 1. Merge Gateway (CAPTION_MODEL) refines a golden lecture line.
 * 2. ElevenLabs TTS speaks a lecture sentence (MP3) and as raw 16 kHz PCM.
 * 3. That PCM is streamed in real time into ElevenLabs Scribe realtime and Sarvam STT → what did they hear?
 * 4. Sarvam TTS speaks a Hinglish sentence.
 * Skips any provider whose key is missing.
 */
import "varlock/auto-load";

import type { RawTranscriptSegment } from "@sightline/contracts";
import { fixtures } from "@sightline/mocks";

import { ENV } from "../src/env";
import { createMastraGenerate } from "../src/modules/live/captions/llm";
import { MastraCaptionEngine } from "../src/modules/live/captions/mastra-caption-engine";
import { ElevenLabsStt } from "../src/modules/live/speech/elevenlabs-stt";
import { SarvamStt } from "../src/modules/live/speech/sarvam-stt";
import { ElevenLabsTts, SarvamTts } from "../src/modules/live/speech/tts";
import type { SpeechToText } from "../src/modules/live/speech/types";
import { MastraStructuredModel, OpenAIEmbeddings } from "../src/modules/platform/ai/structured-model";
import { MockKnowledgeEngine } from "../src/modules/platform/knowledge/mock-knowledge-engine";
import { z } from "zod";

const SENTENCE = "Kirchhoff's current law says the sum of currents entering a node equals the sum leaving it.";
let failures = 0;
const result = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✔" : "✘"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const skip = (label: string, why: string) => console.log(`- ${label} — skipped (${why})`);
const timed = async <T>(fn: () => Promise<T>) => {
  const t = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t) };
};

// 1. LLM via Merge Gateway ---------------------------------------------------------
if (ENV.MERGE_GATEWAY_API_KEY) {
  const engine = new MastraCaptionEngine({
    generate: createMastraGenerate({
      gateway: { url: ENV.LLM_GATEWAY_URL, apiKey: ENV.MERGE_GATEWAY_API_KEY },
      captionModel: ENV.CAPTION_MODEL,
      signModel: ENV.SIGN_MODEL,
    }),
    knowledge: new MockKnowledgeEngine(),
    captionTimeoutMs: 15_000,
    useRag: false,
  });
  const line = fixtures.lecture.script.segments[5]!; // the spoken summation formula
  const { value, ms } = await timed(() =>
    engine.refineCaption({
      sessionId: "ses_check",
      segment: { id: "seg_1", sessionId: "ses_check", seq: 0, startMs: 0, endMs: 1, text: line.raw, isFinal: true, speaker: null, confidence: 0.9 },
      previous: [],
    }),
  );
  const formulas = value.parts.filter((p) => p.type === "formula").length;
  result(`Merge Gateway ${ENV.CAPTION_MODEL} refine (${ms} ms)`, formulas > 0, value.text);
} else skip("Merge Gateway", "MERGE_GATEWAY_API_KEY not set");

// 1b. Platform (Tushar): structured model via Merge + Gemini embeddings ----------------
if (ENV.MERGE_GATEWAY_API_KEY) {
  const model = new MastraStructuredModel({ url: ENV.LLM_GATEWAY_URL, apiKey: ENV.MERGE_GATEWAY_API_KEY }, ENV.LLM_MODEL);
  try {
    const { value, ms } = await timed(() =>
      model.generate(z.object({ term: z.string() }), "Extract the named law from the source.", { source: "Kirchhoff current law" }),
    );
    result(`Platform structured model ${ENV.LLM_MODEL} (${ms} ms)`, value.term.toLowerCase().includes("kirchhoff"), value.term);
  } catch (error) {
    result("Platform structured model", false, error instanceof Error ? error.message.slice(0, 200) : String(error));
  }
}
if (ENV.GEMINI_API_KEY) {
  const embeddings = new OpenAIEmbeddings(ENV.GEMINI_API_KEY, ENV.EMBEDDING_MODEL, { baseURL: ENV.GEMINI_BASE_URL, dimensions: ENV.EMBEDDING_DIMENSIONS });
  try {
    const { value, ms } = await timed(() => embeddings.embed(["Kirchhoff's current law", "sum of currents at a node"]));
    result(`Gemini embeddings ${ENV.EMBEDDING_MODEL} (${ms} ms)`, value.length === 2 && value[0]!.length === ENV.EMBEDDING_DIMENSIONS, `${value.length} × ${value[0]?.length} dims`);
  } catch (error) {
    result("Gemini embeddings", false, error instanceof Error ? error.message.slice(0, 200) : String(error));
  }
} else skip("Gemini embeddings", "GEMINI_API_KEY not set");

// 2 + 3. ElevenLabs TTS → PCM → STT providers -----------------------------------------
async function elevenPcm(): Promise<Uint8Array | null> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(ENV.ELEVENLABS_VOICE_ID)}?output_format=pcm_16000`,
    {
      method: "POST",
      headers: { "xi-api-key": ENV.ELEVENLABS_API_KEY!, "content-type": "application/json" },
      body: JSON.stringify({ text: SENTENCE, model_id: ENV.ELEVENLABS_MODEL_ID }),
    },
  );
  if (!res.ok) {
    result("ElevenLabs TTS pcm_16000", false, `HTTP ${res.status}`);
    return null;
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function transcribe(stt: SpeechToText, pcm: Uint8Array): Promise<string> {
  const finals: string[] = [];
  const errors: string[] = [];
  let seq = 0;
  const stream = stt.open({
    sessionId: "ses_check",
    format: { encoding: "LINEAR16", sampleRate: 16000, channels: 1 },
    keyterms: ["Kirchhoff"],
    startedAt: Date.now(),
    nextSeq: () => seq++,
    onSegment: (s: RawTranscriptSegment) => {
      if (s.isFinal) finals.push(s.text);
    },
    onError: (e) => errors.push(e.message),
  });
  // Real-time pacing, 100 ms chunks, then 1.5 s of silence so VAD commits.
  const padded = new Uint8Array(pcm.length + 48_000);
  padded.set(pcm);
  for (let i = 0; i < padded.length; i += 3200) {
    stream.push(padded.subarray(i, i + 3200));
    await Bun.sleep(100);
  }
  await Bun.sleep(1500);
  await stream.close();
  if (errors.length) throw new Error(errors.join("; "));
  return finals.join(" ").trim();
}

const similarity = (a: string, b: string) => {
  const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const x = words(a);
  const y = words(b);
  return [...x].filter((w) => y.has(w)).length / Math.max(1, x.size);
};

if (ENV.ELEVENLABS_API_KEY) {
  const tts = new ElevenLabsTts({ apiKey: ENV.ELEVENLABS_API_KEY, voiceId: ENV.ELEVENLABS_VOICE_ID, modelId: ENV.ELEVENLABS_MODEL_ID });
  const mp3 = await timed(() => tts.synthesize("Could you please repeat the formula?"));
  result(`ElevenLabs TTS ${ENV.ELEVENLABS_MODEL_ID} (${mp3.ms} ms)`, mp3.value.bytes.length > 1000, `${mp3.value.bytes.length} bytes mp3`);

  const pcm = await elevenPcm();
  if (pcm) {
    console.log(`  test audio: ${(pcm.length / 32000).toFixed(1)} s of 16 kHz PCM — "${SENTENCE}"`);
    try {
      const heard = await transcribe(
        new ElevenLabsStt({ apiKey: ENV.ELEVENLABS_API_KEY, model: ENV.ELEVENLABS_STT_MODEL, language: "en", vadSilenceSecs: 0.6 }),
        pcm,
      );
      result(`ElevenLabs Scribe ${ENV.ELEVENLABS_STT_MODEL}`, similarity(SENTENCE, heard) > 0.6, `heard: "${heard}"`);
    } catch (error) {
      result("ElevenLabs Scribe realtime", false, error instanceof Error ? error.message : String(error));
    }
    if (ENV.SARVAM_API_KEY) {
      try {
        const heard = await transcribe(
          new SarvamStt({ apiKey: ENV.SARVAM_API_KEY, model: ENV.SARVAM_STT_MODEL, mode: ENV.SARVAM_STT_MODE, language: "en-IN" }),
          pcm,
        );
        result(`Sarvam STT ${ENV.SARVAM_STT_MODEL}/${ENV.SARVAM_STT_MODE} (en-IN)`, similarity(SENTENCE, heard) > 0.5, `heard: "${heard}"`);
      } catch (error) {
        result("Sarvam STT", false, error instanceof Error ? error.message : String(error));
      }
    }
  }
} else skip("ElevenLabs", "ELEVENLABS_API_KEY not set");

// 4. Sarvam TTS (Hinglish) -------------------------------------------------------------
if (ENV.SARVAM_API_KEY) {
  const tts = new SarvamTts({ apiKey: ENV.SARVAM_API_KEY, model: ENV.SARVAM_TTS_MODEL, speaker: ENV.SARVAM_SPEAKER, language: "hi-IN" });
  try {
    const { value, ms } = await timed(() => tts.synthesize("Sir, kya aap formula dobara bata sakte hain?"));
    result(`Sarvam TTS ${ENV.SARVAM_TTS_MODEL} hi-IN (${ms} ms)`, value.bytes.length > 1000, `${value.bytes.length} bytes wav`);
  } catch (error) {
    result("Sarvam TTS", false, error instanceof Error ? error.message : String(error));
  }
} else skip("Sarvam", "SARVAM_API_KEY not set");

console.log(failures === 0 ? "\nPROVIDERS OK" : `\n${failures} PROVIDER CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
