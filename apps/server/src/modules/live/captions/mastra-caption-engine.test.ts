import { describe, expect, it } from "bun:test";
import type { KnowledgeEngine, RawTranscriptSegment, SignToken } from "@sightline/contracts";
import { fixtures } from "@sightline/mocks";

import type { StructuredGenerate } from "./llm";
import { buildCaptionPrompt, type LlmCaptionOutput, MastraCaptionEngine } from "./mastra-caption-engine";

const glossary = fixtures.lecture.context.glossary;

const knowledge = (overrides: Partial<KnowledgeEngine> = {}): KnowledgeEngine => ({
  name: "test",
  ingestContext: async () => {
    throw new Error("unused");
  },
  getGlossary: async () => glossary,
  retrieveContext: async () => [],
  dropSession: async () => {},
  ...overrides,
});

const segment = (text: string): RawTranscriptSegment => ({
  id: "seg_1",
  sessionId: "ses_1",
  seq: 0,
  startMs: 0,
  endMs: 1000,
  text,
  isFinal: true,
  speaker: null,
  confidence: 0.9,
});

const returning = (output: unknown, calls: Parameters<StructuredGenerate>[0][] = []): StructuredGenerate =>
  (async (req) => {
    calls.push(req);
    return output;
  }) as StructuredGenerate;

const engine = (generate: StructuredGenerate, extra: Partial<ConstructorParameters<typeof MastraCaptionEngine>[0]> = {}) =>
  new MastraCaptionEngine({ generate, knowledge: knowledge(), captionTimeoutMs: 200, useRag: false, ...extra });

const p = (kind: "text" | "term" | "formula", text: string, extra: Partial<LlmCaptionOutput["parts"][number]> = {}) => ({
  kind,
  text,
  original: null,
  latex: null,
  display: null,
  ...extra,
});

describe("MastraCaptionEngine.refineCaption", () => {
  it("maps LLM parts, validates LaTeX, links glossary ids and derives corrections", async () => {
    const out: LlmCaptionOutput = {
      parts: [
        p("text", "First, a quick recap of "),
        p("term", "Ohm's law", { original: "homes law" }),
        p("text", ": "),
        p("formula", "v equals i times r", { latex: "V = IR", display: "INLINE" }),
      ],
      confidence: 0.92,
    };
    const result = await engine(returning(out)).refineCaption({
      sessionId: "ses_1",
      segment: segment("first a quick recap of homes law v equals i times r"),
      previous: [],
    });
    expect(result.text).toBe("First, a quick recap of Ohm's law: V = IR");
    expect(result.parts[1]).toEqual({ type: "term", text: "Ohm's law", glossaryTermId: "trm_ohms_law", original: "homes law" });
    expect(result.parts[3]).toEqual({ type: "formula", latex: "V = IR", spoken: "v equals i times r", display: "INLINE" });
    expect(result.corrections).toEqual([
      { from: "homes law", to: "Ohm's law", reason: "GLOSSARY" },
      { from: "v equals i times r", to: "V = IR", reason: "FORMULA" },
    ]);
    expect(result.confidence).toBe(0.92);
  });

  it("degrades a formula with invalid LaTeX to its spoken words", async () => {
    const out = { parts: [p("text", "So "), p("formula", "i three is five amps", { latex: "\\frac{5", display: "BLOCK" })], confidence: 0.8 };
    const result = await engine(returning(out)).refineCaption({ sessionId: "ses_1", segment: segment("so i three is five amps"), previous: [] });
    expect(result.parts).toEqual([{ type: "text", text: "So i three is five amps" }]);
    expect(result.corrections).toEqual([]);
  });

  it("rejects an LLM output that summarises away the transcript and falls back to the glossary pass", async () => {
    const out = { parts: [p("text", "KCL explained.")], confidence: 0.9 };
    const result = await engine(returning(out)).refineCaption({
      sessionId: "ses_1",
      segment: segment("now kerchief's current law says that at any node the sum of currents entering equals the sum leaving"),
      previous: [],
    });
    expect(result.parts.some((part) => part.type === "term" && part.glossaryTermId === "trm_kcl")).toBe(true);
    expect(result.text).toContain("sum of currents entering");
  });

  it("falls back to the glossary pass on timeout, within the deadline", async () => {
    const never: StructuredGenerate = (({ signal }: { signal: AbortSignal }) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))) as StructuredGenerate;
    const started = Date.now();
    const result = await engine(never, { captionTimeoutMs: 100 }).refineCaption({
      sessionId: "ses_1",
      segment: segment("mash analysis next class"),
      previous: [],
    });
    expect(Date.now() - started).toBeLessThan(400);
    expect(result.corrections).toEqual([{ from: "mash analysis", to: "mesh analysis", reason: "GLOSSARY" }]);
  });

  it("falls back when the LLM throws", async () => {
    const failing = (async () => {
      throw new Error("401 invalid key");
    }) as StructuredGenerate;
    const result = await engine(failing).refineCaption({ sessionId: "ses_1", segment: segment("hello class"), previous: [] });
    expect(result.text).toBe("Hello class");
  });

  it("only queries RAG when enabled, and survives RAG failures", async () => {
    let ragCalls = 0;
    const calls: Parameters<StructuredGenerate>[0][] = [];
    const kb = knowledge({
      retrieveContext: async () => {
        ragCalls++;
        return [{ id: "c1", text: "KCL: the sum of currents at a node is zero", source: "SLIDE", slideIndex: 2, score: 0.9 }];
      },
    });
    const out = { parts: [p("text", "Hello class")], confidence: 0.9 };
    const off = new MastraCaptionEngine({ generate: returning(out, calls), knowledge: kb, captionTimeoutMs: 200, useRag: false });
    await off.refineCaption({ sessionId: "ses_1", segment: segment("hello class"), previous: [] });
    expect(ragCalls).toBe(0);
    const on = new MastraCaptionEngine({ generate: returning(out, calls), knowledge: kb, captionTimeoutMs: 200, useRag: true });
    await on.refineCaption({ sessionId: "ses_1", segment: segment("hello class"), previous: [] });
    expect(ragCalls).toBe(1);
    expect(calls[1]!.prompt).toContain("Lecture context:");

    const broken = new MastraCaptionEngine({
      generate: returning(out),
      knowledge: knowledge({ retrieveContext: async () => Promise.reject(new Error("qdrant down")) }),
      captionTimeoutMs: 200,
      useRag: true,
    });
    expect((await broken.refineCaption({ sessionId: "ses_1", segment: segment("hello class"), previous: [] })).text).toBe("Hello class");
  });

  it("keeps Hinglish / Devanagari output (unicode-aware drop guard) with the term fix", async () => {
    const raw = "ab kerchief ka current law dekhte hain, हर node पर current का sum zero होता है";
    const out = {
      parts: [
        p("text", "Ab "),
        p("term", "Kirchhoff", { original: "kerchief" }),
        p("text", " ka current law dekhte hain, हर node पर current का sum zero होता है"),
      ],
      confidence: 0.9,
    };
    const result = await engine(returning(out)).refineCaption({ sessionId: "ses_1", segment: segment(raw), previous: [] });
    expect(result.text).toBe("Ab Kirchhoff ka current law dekhte hain, हर node पर current का sum zero होता है");
    expect(result.corrections).toEqual([{ from: "kerchief", to: "Kirchhoff", reason: "GLOSSARY" }]);
  });

  it("rejects an LLM that translates a Hindi caption into English", async () => {
    const raw = "हर node पर आने वाला current जाने वाले current के बराबर होता है";
    const out = { parts: [p("text", "At every node, incoming current equals outgoing current.")], confidence: 0.9 };
    const result = await engine(returning(out)).refineCaption({ sessionId: "ses_1", segment: segment(raw), previous: [] });
    expect(result.text).toContain("बराबर"); // fell back to the original-language transcript
  });

  it("puts glossary aliases and previous lines into the prompt", () => {
    const prompt = buildCaptionPrompt(
      { sessionId: "ses_1", segment: segment("kerchief"), previous: [] },
      glossary,
      [],
    );
    expect(prompt).toContain("Kirchhoff (often mis-heard as: kerchief");
    expect(prompt).toContain("Transcript to correct:\nkerchief");
  });
});

describe("MastraCaptionEngine.composeSignSentence", () => {
  const tokens: SignToken[] = ["PLEASE", "REPEAT", "FORMULA"].map((gloss, i) => ({
    id: `tok_${i}`,
    gloss,
    kind: "SIGN",
    confidence: 0.9,
    ts: 0,
  }));

  it("returns the LLM sentence with gloss + recent captions in the prompt", async () => {
    const calls: Parameters<StructuredGenerate>[0][] = [];
    const out = { text: "Could you please repeat the formula?", alternatives: ["Please repeat the formula."], confidence: 0.9 };
    const result = await engine(returning(out, calls)).composeSignSentence({
      sessionId: "ses_1",
      tokens,
      source: "SELF",
      recentCaptions: ["V = IR"],
    });
    expect(result).toEqual(out);
    expect(calls[0]!.task).toBe("sign");
    expect(calls[0]!.prompt).toContain("PLEASE[0.90] REPEAT[0.90] FORMULA[0.90]");
    expect(calls[0]!.prompt).toContain("- V = IR");
  });

  it("falls back to a joined gloss sentence when the LLM fails", async () => {
    const failing = (async () => {
      throw new Error("down");
    }) as StructuredGenerate;
    const result = await engine(failing).composeSignSentence({ sessionId: "ses_1", tokens, source: "SELF", recentCaptions: [] });
    expect(result).toEqual({ text: "Please repeat formula.", alternatives: [], confidence: 0.4 });
  });
});

describe("sign language output", () => {
  it("adds the Hinglish rule only when configured", async () => {
    const { signInstructions } = await import("./prompts");
    expect(signInstructions("hinglish")).toContain("Hinglish");
    expect(signInstructions("english")).not.toContain("Hinglish as Indian students");
  });
});
