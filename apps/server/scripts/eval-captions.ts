/**
 * Golden-set check for the real CaptionEngine (needs the LLM key for CAPTION_MODEL in apps/server/.env).
 *   bun run --filter server eval:captions            # all 20 Kirchhoff lines
 *   bun run --filter server eval:captions -- 5       # first 5
 * Prints raw → refined vs the hand-written golden refinement, formula/term hit rates and latency.
 */
import "varlock/auto-load";

import type { CaptionSegment, CaptionPart } from "@sightline/contracts";
import { fixtures } from "@sightline/mocks";

import { ENV } from "../src/env";
import { createMastraGenerate } from "../src/modules/live/captions/llm";
import { MastraCaptionEngine } from "../src/modules/live/captions/mastra-caption-engine";
import { MockKnowledgeEngine } from "../src/modules/platform/knowledge/mock-knowledge-engine";

const limit = Number(process.argv[2] ?? fixtures.lecture.script.segments.length);
const engine = new MastraCaptionEngine({
  generate: createMastraGenerate({
    gateway: { url: ENV.LLM_GATEWAY_URL, apiKey: ENV.MERGE_GATEWAY_API_KEY },
    captionModel: ENV.CAPTION_MODEL,
    signModel: ENV.SIGN_MODEL,
  }),
  knowledge: new MockKnowledgeEngine(),
  captionTimeoutMs: Math.max(ENV.CAPTION_TIMEOUT_MS, 5000), // eval measures quality; latency is reported separately
  useRag: false,
});

const kinds = (parts: CaptionPart[], type: CaptionPart["type"]) => parts.filter((p) => p.type === type).length;
const previous: CaptionSegment[] = [];
const latencies: number[] = [];
let formulaHits = 0;
let formulaGolden = 0;
let termHits = 0;
let termGolden = 0;

console.log(`model=${ENV.CAPTION_MODEL} timeout(prod)=${ENV.CAPTION_TIMEOUT_MS}ms\n`);
for (const [i, seg] of fixtures.lecture.script.segments.slice(0, limit).entries()) {
  const started = performance.now();
  const result = await engine.refineCaption({
    sessionId: "ses_eval",
    segment: { id: `seg_${i}`, sessionId: "ses_eval", seq: i, startMs: seg.atMs, endMs: seg.atMs + seg.durationMs, text: seg.raw, isFinal: true, speaker: null, confidence: 0.9 },
    previous: previous.slice(-5),
  });
  const ms = performance.now() - started;
  latencies.push(ms);
  const goldenFormulas = kinds(seg.refined.parts, "formula");
  const goldenTerms = kinds(seg.refined.parts, "term");
  formulaGolden += goldenFormulas;
  termGolden += goldenTerms;
  formulaHits += Math.min(goldenFormulas, kinds(result.parts, "formula"));
  termHits += Math.min(goldenTerms, kinds(result.parts, "term"));
  previous.push({ id: `seg_${i}`, sessionId: "ses_eval", seq: i, status: "REFINED", startMs: 0, endMs: 0, speaker: null, rawText: seg.raw, slidePointer: null, ...result });

  console.log(`#${i} ${Math.round(ms)}ms  conf=${result.confidence.toFixed(2)}`);
  console.log(`  raw:    ${seg.raw}`);
  console.log(`  got:    ${result.text}`);
  console.log(`  golden: ${seg.refined.text}\n`);
}

latencies.sort((a, b) => a - b);
const pct = (q: number) => Math.round(latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))]!);
console.log(`formulas ${formulaHits}/${formulaGolden} · terms ${termHits}/${termGolden} · latency p50 ${pct(0.5)}ms p95 ${pct(0.95)}ms`);
