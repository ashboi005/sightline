/**
 * Fixture-backed KnowledgeEngine. Used when MOCK_KNOWLEDGE=true.
 * Ingest returns the Kirchhoff glossary/topics; retrieval is naive word overlap over the ingested text.
 */
import type {
  ContextChunk,
  GlossaryTerm,
  IngestContextInput,
  IngestContextResult,
  KnowledgeEngine,
  LocateSlideInput,
  RetrieveContextInput,
  SlidePointer,
} from "@sightline/contracts";
import { fixtures } from "@sightline/mocks";

const { context, script } = fixtures.lecture;

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const words = (s: string) => new Set(normalize(s).split(" ").filter((w) => w.length > 2));
const pointerByText = new Map(
  script.segments.flatMap((s) => [
    [normalize(s.raw), s.slidePointer],
    [normalize(s.refined.text), s.slidePointer],
  ]),
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MockKnowledgeEngine implements KnowledgeEngine {
  readonly name = "mock";
  private readonly sessions = new Map<string, { glossary: GlossaryTerm[]; chunks: Omit<ContextChunk, "score">[] }>();

  async ingestContext(input: IngestContextInput): Promise<IngestContextResult> {
    await sleep(800); // feels like real work in the UI
    const chunks: Omit<ContextChunk, "score">[] = [
      ...input.slides.map((s) => ({ id: `chk_s${s.index}`, text: s.text, source: "SLIDE" as const, slideIndex: s.index })),
      ...(input.text ?? "")
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((text, i) => ({ id: `chk_t${i}`, text, source: "TEXT" as const, slideIndex: null })),
    ];
    this.sessions.set(input.sessionId, { glossary: context.glossary, chunks });
    return { glossary: context.glossary, topics: context.topics, chunkCount: chunks.length, sttKeyterms: context.sttKeyterms };
  }

  async getGlossary(sessionId: string): Promise<GlossaryTerm[]> {
    return this.sessions.get(sessionId)?.glossary ?? context.glossary;
  }

  async retrieveContext(input: RetrieveContextInput): Promise<ContextChunk[]> {
    const query = words(input.query);
    return (this.sessions.get(input.sessionId)?.chunks ?? [])
      .map((chunk) => {
        const overlap = [...words(chunk.text)].filter((w) => query.has(w)).length;
        return { ...chunk, score: query.size === 0 ? 0 : overlap / query.size };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit);
  }

  async locateSlide(input: LocateSlideInput): Promise<SlidePointer | null> {
    return pointerByText.get(normalize(input.text)) ?? null;
  }

  async dropSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
