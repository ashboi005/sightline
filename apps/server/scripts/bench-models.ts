/**
 * Model bake-off for every LLM job, through the real prompts + schemas (never prints keys).
 *   bun run --filter server bench:models                          # default candidates, all tasks
 *   bun run --filter server bench:models -- --tasks captions,glossary --models gemini/gemini-3.1-flash-lite,zai/glm-5.3-flash
 *
 * Model ids: "gemini/<id>" = Gemini direct (GEMINI_API_KEY…_4, rotated per call); anything else = Merge Gateway id.
 * Tasks:
 *   captions  10 golden Kirchhoff lines (formula-heavy; --lines all = all 20) through MastraCaptionEngine — latency, LLM ok, formula/term hits
 *   glossary  the real deck + context through the glossary prompt/schema — latency, #terms, over-long terms
 *   sign      3 gloss sequences through the sign composer — latency
 *   notes     one full notes run (LlmNotesEngine) on the golden transcript — latency, sections
 *   vision    the KCL slide PNG described — latency
 */
import "varlock/auto-load";

import type { CaptionPart, CaptionSegment, GenerateNotesInput, GlossaryTerm } from "@sightline/contracts";
import { fixtures } from "@sightline/mocks";

import { ENV } from "../src/env";
import { KeyPool } from "../src/lib/key-pool";
import { type GatewayConfig } from "../src/lib/llm-gateway";
import { type StructuredGenerate, createMastraGenerate } from "../src/modules/live/captions/llm";
import { MastraCaptionEngine } from "../src/modules/live/captions/mastra-caption-engine";
import { MockKnowledgeEngine } from "../src/modules/platform/knowledge/mock-knowledge-engine";
import { MastraStructuredModel } from "../src/modules/platform/ai/structured-model";
import { GLOSSARY_INSTRUCTIONS, GlossaryDraft, glossaryInput, normalizeGlossary } from "../src/modules/platform/knowledge/glossary";
import { chunkContext } from "../src/modules/platform/knowledge/chunks";
import { LlmNotesEngine } from "../src/modules/platform/notes/llm-notes-engine";
import { emptyContext } from "../src/modules/platform/store/memory-store";
import { GatewayVisionDescriber } from "../src/modules/live/snapshots/vision";
import { lecturePdf } from "./fixtures";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const DEFAULT_MODELS = [
  "zai/glm-5.3-flash",
  "zai/glm-5.3-flashx",
  "zai/glm-4.7-flashx",
  "google/gemini-3.1-flash-lite",
  "google/gemini-3.5-flash-lite",
  "gemini/gemini-3.1-flash-lite",
  "gemini/gemini-3.5-flash-lite",
  "gemini/gemini-flash-lite-latest",
  "qwen/qwen3.8-flash",
  "deepseek/deepseek-v4-flash-0731-fast",
  "gpt-5.4-nano",
  "gpt-4.1-nano",
  "xai/grok-4.20-0309-non-reasoning",
  "minimax/minimax-m3.1-flash",
  "mistral/ministral-8b-2512",
];
const models = (arg("models") ?? DEFAULT_MODELS.join(",")).split(",").map((m) => m.trim()).filter(Boolean);
const tasks = new Set((arg("tasks") ?? "captions,glossary,sign").split(","));
const parallel = Number(arg("parallel") ?? 5);

/** Same routing as production (container.ts): "gemini/…" → Gemini direct with rotated keys, else Merge. */
const gateway: GatewayConfig = {
  url: ENV.LLM_GATEWAY_URL,
  apiKey: ENV.MERGE_GATEWAY_API_KEY,
  gemini: { url: ENV.GEMINI_BASE_URL, pool: new KeyPool("gemini", [ENV.GEMINI_API_KEY, ENV.GEMINI_API_KEY_2, ENV.GEMINI_API_KEY_3, ENV.GEMINI_API_KEY_4]) },
};

const pct = (xs: number[], q: number) => (xs.length ? Math.round([...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))]!) : NaN);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 90);

type Row = Record<string, string | number>;
const rows = new Map<string, Row>();
const row = (model: string) => rows.get(model) ?? (rows.set(model, { model }), rows.get(model)!);

// --- captions ---------------------------------------------------------------------------------------------------
/**
 * The fixture glossary plus the broad terms a real LLM glossary adds (seen in the live run). They tempt models into
 * swapping correctly heard words ("sigma I in…" → "Conservation of charge", "resistors" → "Resistance").
 */
class BenchKnowledge extends MockKnowledgeEngine {
  override async getGlossary(sessionId: string): Promise<GlossaryTerm[]> {
    const extra = ["Conservation of charge", "Conservation of energy", "Resistance", "Potential difference", "Electromotive force", "Power dissipated", "Kirchhoff's voltage law"];
    return [
      ...(await super.getGlossary(sessionId)),
      ...extra.map((term, i): GlossaryTerm => ({ id: `trm_x${i}`, term, aliases: term === "Electromotive force" ? ["EMF"] : [], definition: null, category: "TERM", source: "TEXT" })),
    ];
  }
}

const CAPTION_LINES = arg("lines") === "all" ? fixtures.lecture.script.segments.map((_, i) => i) : [2, 3, 4, 5, 8, 10, 11, 13, 14, 17];
async function benchCaptions(model: string) {
  let ok = 0;
  let lastError = "";
  const inner = createMastraGenerate({ gateway, captionModel: model, signModel: model });
  const generate: StructuredGenerate = async (req) => {
    try {
      const out = await inner(req);
      ok++;
      return out;
    } catch (e) {
      lastError = errText(e);
      throw e;
    }
  };
  const engine = new MastraCaptionEngine({ generate, knowledge: new BenchKnowledge(), captionTimeoutMs: 20_000, useRag: false });
  const kinds = (parts: CaptionPart[], type: CaptionPart["type"]) => parts.filter((p) => p.type === type).length;
  const latencies: number[] = [];
  const previous: CaptionSegment[] = [];
  let fHit = 0, fGold = 0, tHit = 0, tGold = 0;
  // Fidelity: word F1 between output and golden (formulas compared by their spoken words, since LaTeX varies).
  // Catches models that swap content for glossary terms or drop/padd words, which the hit counts above can't.
  const spokenWords = (parts: CaptionPart[]) => (parts.map((p) => (p.type === "formula" ? p.spoken : p.text)).join(" ").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const f1s: number[] = [];
  for (const i of CAPTION_LINES) {
    const seg = fixtures.lecture.script.segments[i]!;
    const t = performance.now();
    const result = await engine.refineCaption({
      sessionId: "ses_bench",
      segment: { id: `seg_${i}`, sessionId: "ses_bench", seq: i, startMs: 0, endMs: 1, text: seg.raw, isFinal: true, speaker: null, confidence: 0.9 },
      previous: previous.slice(-3),
    });
    latencies.push(performance.now() - t);
    fGold += kinds(seg.refined.parts, "formula");
    tGold += kinds(seg.refined.parts, "term");
    fHit += Math.min(kinds(seg.refined.parts, "formula"), kinds(result.parts, "formula"));
    tHit += Math.min(kinds(seg.refined.parts, "term"), kinds(result.parts, "term"));
    const gold = spokenWords(seg.refined.parts);
    const out = spokenWords(result.parts);
    const overlap = (xs: string[], ys: string[]) => { const pool = [...ys]; return xs.filter((w) => { const i = pool.indexOf(w); if (i < 0) return false; pool.splice(i, 1); return true; }).length; };
    const common = overlap(out, gold);
    f1s.push(out.length + gold.length ? (2 * common) / (out.length + gold.length) : 1);
    previous.push({ id: `seg_${i}`, sessionId: "ses_bench", seq: i, status: "REFINED", startMs: 0, endMs: 0, speaker: null, rawText: seg.raw, slidePointer: null, ...result });
  }
  Object.assign(row(model), {
    "cap p50": pct(latencies, 0.5),
    "cap p95": pct(latencies, 0.95),
    "cap ok": `${ok}/${CAPTION_LINES.length}`,
    formulas: `${fHit}/${fGold}`,
    terms: `${tHit}/${tGold}`,
    fidelity: (f1s.reduce((a, b) => a + b, 0) / f1s.length).toFixed(3),
    "lines<0.8": f1s.filter((f) => f < 0.8).length,
    ...(lastError ? { "cap err": lastError } : {}),
  });
}

// --- glossary -----------------------------------------------------------------------------------------------------
const deckInput = {
  sessionId: "ses_bench",
  title: "Kirchhoff's Circuit Laws",
  subject: "Electrical engineering",
  text: [
    "Kirchhoff's current law (KCL): the algebraic sum of currents at a node is zero; charge is conserved.",
    "Kirchhoff's voltage law (KVL): the sum of voltages around any closed loop is zero; energy is conserved.",
    "Ohm's law: V = I R. Power dissipated in a resistor P = I^2 R. Charge Q = integral of i dt.",
    "Mesh analysis applies KVL to each independent loop of a planar circuit.",
  ].join("\n\n"),
  slides: fixtures.lecture.slides.slides.map((s) => ({
    id: `sld_${s.index}`,
    index: s.index,
    imageUrl: "x",
    title: s.title,
    text: [s.title, ...s.bullets].join("\n"),
    bullets: s.bullets.map((text, index) => ({ index, text })),
  })),
};
async function benchGlossary(model: string) {
  const latencies: number[] = [];
  let terms: GlossaryTerm[] | null = null;
  let rawBad = 0;
  let error = "";
  const chunks = chunkContext(deckInput);
  for (let run = 0; run < 2; run++) {
    const llm = new MastraStructuredModel(gateway, model, { timeoutMs: 60_000 });
    const t = performance.now();
    try {
      const draft = await llm.generate(GlossaryDraft, GLOSSARY_INSTRUCTIONS, glossaryInput(deckInput, chunks));
      latencies.push(performance.now() - t);
      rawBad = draft.terms.filter((t) => t.term.length > 40 || /[()=]/.test(t.term) || (t.aliases ?? []).some((a) => a.replace(/[^\p{L}]/gu, "").length < 3)).length;
      terms = normalizeGlossary(draft, deckInput);
    } catch (e) {
      error = errText(e);
    }
  }
  Object.assign(row(model), {
    "glos ms": latencies.length ? latencies.map(Math.round).join("/") : "fail",
    "#terms": terms?.length ?? 0,
    "raw bad": rawBad,
    ...(error ? { "glos err": error } : {}),
  });
  if (terms) console.log(`  [${model}] glossary: ${terms.map((t) => `${t.term}${t.aliases.length ? ` {${t.aliases.join("|")}}` : ""}`).join("; ").slice(0, 400)}`);
}

// --- sign ----------------------------------------------------------------------------------------------------------
const GLOSSES = [["PLEASE", "REPEAT", "FORMULA"], ["ME", "NOT", "UNDERSTAND", "KCL"], ["WHAT", "MEAN", "NODE"]];
async function benchSign(model: string) {
  const latencies: number[] = [];
  let error = "";
  const texts: string[] = [];
  for (const gloss of GLOSSES) {
    const engine = new MastraCaptionEngine({ generate: createMastraGenerate({ gateway, captionModel: model, signModel: model }), knowledge: new MockKnowledgeEngine(), captionTimeoutMs: 20_000, signTimeoutMs: 20_000, useRag: false });
    const t = performance.now();
    try {
      const out = await engine.composeSignSentence({ sessionId: "ses_bench", source: "SELF", recentCaptions: ["Kirchhoff's current law says the currents at a node sum to zero."], tokens: gloss.map((g, i) => ({ id: `tok_${i}`, gloss: g, kind: "SIGN", confidence: 0.9, ts: 0 })) });
      latencies.push(performance.now() - t);
      texts.push(out.text);
    } catch (e) {
      error = errText(e);
    }
  }
  Object.assign(row(model), { "sign p50": pct(latencies, 0.5), "sign max": pct(latencies, 1), ...(error ? { "sign err": error } : {}) });
  console.log(`  [${model}] sign: ${texts.join(" | ")}`);
}

// --- notes ---------------------------------------------------------------------------------------------------------
async function benchNotes(model: string) {
  const segments: CaptionSegment[] = fixtures.lecture.script.segments.map((seg, i) => ({
    id: `seg_${i}`, sessionId: "ses_bench", seq: i, startMs: seg.atMs, endMs: seg.atMs + seg.durationMs, status: "REFINED", speaker: null,
    rawText: seg.raw, text: seg.refined.text, parts: seg.refined.parts, corrections: [], confidence: 0.9, slidePointer: null,
  }));
  const input: GenerateNotesInput = {
    session: { id: "ses_bench", title: "Kirchhoff's laws", subject: null, mode: "DEAF", status: "ENDED", contextStatus: "READY", slidesStatus: "READY", notesStatus: "PROCESSING", createdAt: 0, startedAt: 0, endedAt: 600_000 },
    context: { ...emptyContext("ses_bench"), status: "READY", topics: fixtures.lecture.slides.slides.map((s) => s.title) },
    slides: deckInput.slides, transcript: segments, awayWindows: [], snapshots: [],
  };
  const engine = new LlmNotesEngine(new MockKnowledgeEngine(), new MastraStructuredModel(gateway, model, { timeoutMs: 120_000 }));
  const t = performance.now();
  try {
    const notes = await engine.generateNotes(input);
    Object.assign(row(model), { "notes ms": Math.round(performance.now() - t), sections: notes.sections.length });
  } catch (e) {
    Object.assign(row(model), { "notes ms": "fail", "notes err": errText(e) });
  }
}

// --- vision --------------------------------------------------------------------------------------------------------
const slidePng = await (async () => {
  if (!tasks.has("vision")) return null;
  const pdf = Bun.which("pdftoppm");
  if (!pdf) return null;
  const dir = `${process.env.TMPDIR ?? "/tmp"}/sightline-bench-${Date.now()}`;
  await Bun.$`mkdir -p ${dir}`.quiet();
  await Bun.write(`${dir}/deck.pdf`, lecturePdf());
  await Bun.$`pdftoppm -png -scale-to 1200 ${dir}/deck.pdf ${dir}/page`.quiet();
  const file = (await Array.fromAsync(new Bun.Glob("page*.png").scan(dir)))[0];
  return file ? new Uint8Array(await Bun.file(`${dir}/${file}`).arrayBuffer()) : null;
})();
async function benchVision(model: string) {
  if (!slidePng) return void Object.assign(row(model), { "vision ms": "no png" });
  const vision = new GatewayVisionDescriber(gateway, model, 30_000);
  const t = performance.now();
  const text = await vision.describe(slidePng, "image/png", "Kirchhoff's current law says the currents at a node sum to zero.");
  Object.assign(row(model), { "vision ms": text ? Math.round(performance.now() - t) : "fail" });
  console.log(`  [${model}] vision: ${text ?? "—"}`);
}

// --- run -------------------------------------------------------------------------------------------------------------
console.log(`models: ${models.length}, tasks: ${[...tasks].join(",")}, gemini keys: ${gateway.gemini!.pool.size}\n`);
const queue = [...models];
await Promise.all(
  Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    for (let model = queue.shift(); model; model = queue.shift()) {
      const t = performance.now();
      if (tasks.has("captions")) await benchCaptions(model).catch((e) => Object.assign(row(model!), { "cap err": errText(e) }));
      if (tasks.has("glossary")) await benchGlossary(model).catch((e) => Object.assign(row(model!), { "glos err": errText(e) }));
      if (tasks.has("sign")) await benchSign(model).catch((e) => Object.assign(row(model!), { "sign err": errText(e) }));
      if (tasks.has("notes")) await benchNotes(model);
      if (tasks.has("vision")) await benchVision(model);
      console.log(`done ${model} (${Math.round((performance.now() - t) / 1000)} s)`);
    }
  }),
);
console.log();
console.table([...rows.values()]);
console.log("gemini key use:", JSON.stringify(gateway.gemini!.pool.status()));
process.exit(0);
