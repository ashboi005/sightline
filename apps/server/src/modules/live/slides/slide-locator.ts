/**
 * OWNER: Ashwath — P1 live slide auto-pointer.
 *
 * Lexical TF-IDF match of the refined caption against the deck's extracted text (titles + bullets), read from
 * SessionStore.getSlideDeck — the deck Tushar's slide pipeline produces. No RAG, no network, < 1 ms per call.
 * Hysteresis keeps the preview from flickering: we only leave the current slide when another one clearly wins.
 */
import type { LocateSlideInput, Slide, SlideLocator, SlidePointer } from "@sightline/contracts";

import type { SessionStore } from "../../../shared/ports";

const STOPWORDS = new Set(
  "a an and are as at be but by do does for from had has have he her his i if in into is it its just let me my no not now of on or our so that the their them then there these they this to too up us was we were what when which who will with you your can could would should going gonna like okay ok right well also any some all more most very here".split(
    " ",
  ),
);

/** Symbol + LaTeX vocabulary so "Σ I_k = 0" on a slide matches "\\sum_{k} I_k" / "summation" in captions. */
const SYNONYMS: Record<string, string> = {
  σ: "sum",
  Σ: "sum",
  summation: "sum",
  sigma: "sum",
  ω: "ohm",
  Ω: "ohm",
  omega: "ohm",
  ohms: "ohm",
  "∫": "integral",
  int: "integral",
  frac: "divided",
  amps: "ampere",
  amp: "ampere",
  amperes: "ampere",
  volts: "volt",
  kcl: "kirchhoff current law",
  kvl: "kirchhoff voltage law",
};

const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

export function tokenize(text: string): string[] {
  const spaced = text
    .replace(/\\([a-zA-Z]+)/g, " $1 ") // \sum → sum
    .replace(/[ΣσΩω∫]/g, (c) => ` ${SYNONYMS[c]} `)
    .replace(/'s\b/g, "")
    .toLowerCase();
  const out: string[] = [];
  for (const raw of spaced.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const mapped = SYNONYMS[raw] ?? raw;
    for (const w of mapped.split(" ")) {
      if (w.length < 2 && !/\d/.test(w)) continue;
      if (STOPWORDS.has(w)) continue;
      out.push(stem(w));
    }
  }
  return out;
}

type Vector = Map<string, number>;
type Unit = { slideIndex: number; bulletIndex: number | null; vector: Vector; weight: number };
type DeckIndex = { deckId: string; units: Unit[]; idf: Map<string, number>; slideCount: number };

const norm = (v: Vector) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)) || 1;

function vectorize(tokens: string[], idf: Map<string, number>): Vector {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const v: Vector = new Map();
  for (const [t, n] of tf) {
    const w = idf.get(t);
    if (w) v.set(t, (1 + Math.log(n)) * w);
  }
  return v;
}

function cosine(a: Vector, b: Vector): number {
  let dot = 0;
  for (const [t, x] of a) dot += x * (b.get(t) ?? 0);
  return dot / (norm(a) * norm(b));
}

export function buildIndex(deckId: string, slides: Pick<Slide, "index" | "title" | "bullets">[]): DeckIndex {
  const docs: { slideIndex: number; bulletIndex: number | null; tokens: string[]; weight: number }[] = [];
  for (const slide of slides) {
    if (slide.title) docs.push({ slideIndex: slide.index, bulletIndex: null, tokens: tokenize(slide.title), weight: 0.85 });
    for (const b of slide.bullets) docs.push({ slideIndex: slide.index, bulletIndex: b.index, tokens: tokenize(b.text), weight: 1 });
  }
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = new Map([...df].map(([t, n]) => [t, Math.log(1 + docs.length / n)]));
  return {
    deckId,
    idf,
    slideCount: slides.length,
    units: docs.filter((d) => d.tokens.length).map((d) => ({ ...d, vector: vectorize(d.tokens, idf) })),
  };
}

export type LocatorTuning = { minScore: number; switchMargin: number };

/** Pure scoring step (exported for tests). */
export function locateIn(index: DeckIndex, text: string, current: number | null, tuning: LocatorTuning): SlidePointer | null {
  const query = vectorize(tokenize(text), index.idf);
  if (query.size === 0) return null;

  const bestBySlide = new Map<number, { score: number; bulletIndex: number | null }>();
  for (const unit of index.units) {
    const score = cosine(query, unit.vector) * unit.weight;
    const prev = bestBySlide.get(unit.slideIndex);
    if (!prev || score > prev.score) bestBySlide.set(unit.slideIndex, { score, bulletIndex: unit.bulletIndex });
  }
  const ranked = [...bestBySlide].sort((a, b) => b[1].score - a[1].score);
  const [bestSlide, best] = ranked[0] ?? [];
  if (bestSlide === undefined || !best) return null;

  const currentBest = current !== null ? bestBySlide.get(current) : undefined;
  const stayOnCurrent =
    current !== null && bestSlide !== current && (best.score < tuning.minScore || best.score - (currentBest?.score ?? 0) < tuning.switchMargin);
  if (stayOnCurrent) {
    if (!currentBest || currentBest.score < tuning.minScore) return null;
    return { slideIndex: current, bulletIndex: currentBest.bulletIndex, confidence: round(currentBest.score) };
  }
  if (best.score < tuning.minScore) return null;
  return { slideIndex: bestSlide, bulletIndex: best.bulletIndex, confidence: round(best.score) };
}

const round = (n: number) => Math.min(1, Math.round(n * 1000) / 1000);

export class LexicalSlideLocator implements SlideLocator {
  readonly name = "lexical-tfidf";
  private readonly cache = new Map<string, DeckIndex>();

  constructor(
    private readonly store: SessionStore,
    private readonly tuning: LocatorTuning = { minScore: 0.18, switchMargin: 0.08 },
  ) {}

  async locate(input: LocateSlideInput): Promise<SlidePointer | null> {
    const deck = await this.store.getSlideDeck(input.sessionId);
    if (!deck || deck.status !== "READY" || deck.slides.length === 0) return null;
    let index = this.cache.get(input.sessionId);
    if (!index || index.deckId !== deck.id) {
      index = buildIndex(deck.id, deck.slides);
      this.cache.set(input.sessionId, index);
    }
    return locateIn(index, input.text, input.currentSlideIndex, this.tuning);
  }

  forget(sessionId: string) {
    this.cache.delete(sessionId);
  }
}
