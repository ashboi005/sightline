/**
 * Fixture-backed IntelligenceEngine. Used when MOCK_INTELLIGENCE=true.
 *
 * - Known lecture lines (fixtures/kirchhoff.script.json) get their hand-written refined output.
 * - Anything else gets a cheap glossary-alias replacement so real Deepgram text still looks "refined".
 */
import type {
  CaptionCorrection,
  CaptionPart,
  ComposeSentenceInput,
  ComposeSentenceResult,
  GenerateNotesInput,
  GlossaryTerm,
  IngestContextInput,
  IngestContextResult,
  IntelligenceEngine,
  LectureNotes,
  LocateSlideInput,
  RefineCaptionInput,
  RefineCaptionResult,
  SlidePointer,
} from "@sightline/contracts";
import { fixtures } from "@sightline/mocks";

const { context, script, notes } = fixtures.lecture;

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const scriptByRaw = new Map(script.segments.map((s) => [normalize(s.raw), s]));
const scriptByAnyText = new Map(
  script.segments.flatMap((s) => [
    [normalize(s.raw), s],
    [normalize(s.refined.text), s],
  ]),
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MockIntelligenceEngine implements IntelligenceEngine {
  readonly name = "mock";
  private readonly glossaries = new Map<string, GlossaryTerm[]>();

  async ingestContext(input: IngestContextInput): Promise<IngestContextResult> {
    await sleep(800); // feels like real work in the UI
    this.glossaries.set(input.sessionId, context.glossary);
    const paragraphs = (input.text ?? "").split(/\n\s*\n/).filter(Boolean).length;
    return {
      glossary: context.glossary,
      topics: context.topics,
      chunkCount: input.slides.length + paragraphs,
      sttKeyterms: context.sttKeyterms,
    };
  }

  async getGlossary(sessionId: string): Promise<GlossaryTerm[]> {
    return this.glossaries.get(sessionId) ?? context.glossary;
  }

  async refineCaption(input: RefineCaptionInput): Promise<RefineCaptionResult> {
    await sleep(250 + Math.random() * 350); // simulated LLM latency
    const known = scriptByRaw.get(normalize(input.segment.text));
    if (known) return known.refined;
    return this.refineWithGlossary(input.segment.text, await this.getGlossary(input.sessionId));
  }

  async locateSlide(input: LocateSlideInput): Promise<SlidePointer | null> {
    return scriptByAnyText.get(normalize(input.text))?.slidePointer ?? null;
  }

  async composeSignSentence(input: ComposeSentenceInput): Promise<ComposeSentenceResult> {
    await sleep(300);
    const key = input.tokens.map((t) => t.gloss).join(" ");
    const phrase = fixtures.sign.phrases.find((p) => p.tokens.map((t) => t.gloss).join(" ") === key);
    if (phrase) return { text: phrase.text, alternatives: phrase.alternatives, confidence: 0.9 };

    const words = input.tokens.map((t) => (t.kind === "FINGERSPELL" ? t.gloss : t.gloss.toLowerCase().replace(/-/g, " ")));
    const sentence = words.join(" ");
    const isQuestion = input.tokens.some((t) => ["QUESTION", "WHAT", "WHY", "HOW", "WHERE"].includes(t.gloss));
    return {
      text: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}${isQuestion ? "?" : "."}`,
      alternatives: [],
      confidence: 0.4,
    };
  }

  async generateNotes(input: GenerateNotesInput): Promise<Omit<LectureNotes, "id" | "generatedAt">> {
    await sleep(2500);
    const { transcript, awayWindows } = input;
    const sections = notes.sections.map((section) => {
      const segs = transcript.filter(
        (seg) => seg.slidePointer && section.slideIndexes.includes(seg.slidePointer.slideIndex),
      );
      const awaySeconds = awayWindows
        .filter((w) => w.zone === "BOARD")
        .filter((w) => w.missedSegmentIds.some((id) => segs.some((s) => s.id === id)))
        .reduce((sum, w) => sum + (w.endedAt - w.startedAt) / 1000, 0);
      return {
        ...section,
        sourceSegmentIds: segs.map((s) => s.id),
        boardFocus: awaySeconds > 0 ? { isBoardHeavy: awaySeconds >= 10, awaySeconds: Math.round(awaySeconds) } : section.boardFocus,
      };
    });
    return {
      ...notes,
      sessionId: input.session.id,
      title: `${input.session.title} — Notes`,
      sections,
    };
  }

  async dropSession(sessionId: string): Promise<void> {
    this.glossaries.delete(sessionId);
  }

  private refineWithGlossary(text: string, glossary: GlossaryTerm[]): RefineCaptionResult {
    const corrections: CaptionCorrection[] = [];
    const parts: CaptionPart[] = [];
    const aliases = glossary
      .flatMap((term) => term.aliases.map((alias) => ({ alias, term })))
      .sort((a, b) => b.alias.length - a.alias.length);

    let rest = text;
    while (rest.length > 0) {
      let earliest: { index: number; alias: string; term: GlossaryTerm } | null = null;
      for (const { alias, term } of aliases) {
        const match = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").exec(rest);
        if (match && (!earliest || match.index < earliest.index)) earliest = { index: match.index, alias: match[0], term };
      }
      if (!earliest) {
        parts.push({ type: "text", text: rest });
        break;
      }
      if (earliest.index > 0) parts.push({ type: "text", text: rest.slice(0, earliest.index) });
      parts.push({ type: "term", text: earliest.term.term, glossaryTermId: earliest.term.id, original: earliest.alias });
      corrections.push({ from: earliest.alias, to: earliest.term.term, reason: "GLOSSARY" });
      rest = rest.slice(earliest.index + earliest.alias.length);
    }

    const first = parts[0];
    if (first?.type === "text") first.text = first.text.charAt(0).toUpperCase() + first.text.slice(1);
    return {
      text: parts.map((p) => (p.type === "formula" ? p.latex : p.text)).join(""),
      parts,
      corrections,
      confidence: corrections.length > 0 ? 0.7 : 0.6,
    };
  }
}
