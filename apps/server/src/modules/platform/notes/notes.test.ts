import { expect, test } from "bun:test";
import type { CaptionSegment } from "@sightline/contracts";
import { boardFocus, partitionTranscript, renderNotes } from "./render";
import { LlmNotesEngine } from "./llm-notes-engine";
import { MockKnowledgeEngine } from "../knowledge/mock-knowledge-engine";
import { emptyContext } from "../store/memory-store";
import type { GenerateNotesInput } from "@sightline/contracts";

const input: GenerateNotesInput = { session: { id: "ses_notes", title: "Circuits", subject: null, mode: "DEAF", status: "ENDED", contextStatus: "EMPTY", slidesStatus: "EMPTY", notesStatus: "EMPTY", createdAt: 0, startedAt: 0, endedAt: 600_000 }, context: emptyContext("ses_notes"), slides: [], transcript: [], awayWindows: [], snapshots: [] };

const segment = (id: string, startMs: number, endMs: number): CaptionSegment => ({ id, sessionId: "ses_notes", seq: startMs, startMs, endMs, status: "REFINED", speaker: null, rawText: "current", text: "Current is conserved.", parts: [], corrections: [], slidePointer: null, confidence: 1 });

test("board markers count union of actual source overlap only", () => {
  expect(boardFocus([segment("seg_a", 0, 8000), segment("seg_b", 4000, 12000)], [
    { zone: "BOARD", startedAt: 1000, endedAt: 21_000, missedSegmentIds: [] },
    { zone: "BOARD", startedAt: 2000, endedAt: 5000, missedSegmentIds: [] },
    { zone: "PERSON", startedAt: 1000, endedAt: 99_000, missedSegmentIds: [] },
  ], 1000)).toEqual({ isBoardHeavy: true, awaySeconds: 12 });
});

test("two-hour transcripts partition without losing segments", () => {
  const transcript = Array.from({ length: 2400 }, (_, index) => ({ ...segment(`seg_${index}`, index * 3000, index * 3000 + 2500), text: "spoken fact ".repeat(20) }));
  const ranges = partitionTranscript(transcript);
  expect(ranges.length).toBeGreaterThan(1);
  expect(ranges.flat().map((item) => item.id)).toEqual(transcript.map((item) => item.id));
  expect(ranges.every((range) => range.reduce((sum, item) => sum + item.text.length, 0) <= 14_000)).toBe(true);
});

test("Markdown renders structured formulas and board annotations", () => {
  const markdown = renderNotes({ sessionId: "ses_notes", title: "Circuits", summary: "Summary", keyTerms: [], formulas: [{ latex: "V=IR", description: "Ohm" }], takeaways: ["Conserve charge"], sections: [{ id: "sec_1", heading: "Law", blocks: [{ type: "formula", latex: "V=IR", caption: null }], sourceSegmentIds: ["seg_a"], slideIndexes: [], boardFocus: { isBoardHeavy: true, awaySeconds: 12 } }] });
  expect(markdown).toContain("$$\nV=IR\n$$");
  expect(markdown).toContain("12 seconds");
});

test("real notes workflow rejects missing speech and fabricated source IDs", async () => {
  let calls = 0;
  const engine = new LlmNotesEngine(new MockKnowledgeEngine(), { generate: async (schema) => schema.parse(++calls === 1 ? { sections: [{ rangeIndex: 0, heading: "Current" }] } : { summary: "Current", blocks: [], sourceSegmentIds: ["seg_fabricated"], slideIndexes: [], supplements: [], keyTerms: [], takeaways: [] }) });
  await expect(engine.generateNotes(input)).rejects.toThrow("No speech");
  await expect(engine.generateNotes({ ...input, transcript: [segment("seg_a", 0, 1000)] })).rejects.toThrow("unknown transcript");
});

test("real notes workflow generates grounded no-slide notes and labelled supplements", async () => {
  let calls = 0;
  const engine = new LlmNotesEngine(new MockKnowledgeEngine(), { generate: async (schema) => schema.parse(++calls === 1 ? { sections: [{ rangeIndex: 0, heading: "Current" }] } : { summary: "Current is conserved.", blocks: [{ type: "paragraph", text: "Current is conserved." }], sourceSegmentIds: ["seg_a"], slideIndexes: [], supplements: ["This is conservation of charge."], keyTerms: [], takeaways: ["Current is conserved."] }) });
  const notes = await engine.generateNotes({ ...input, transcript: [segment("seg_a", 0, 1000)] });
  expect(notes.sections[0]?.sourceSegmentIds).toEqual(["seg_a"]);
  expect(notes.markdown).toContain("Context supplement:");
});

test("real notes workflow processes every range of a two-hour transcript", async () => {
  const transcript = Array.from({ length: 2400 }, (_, index) => ({ ...segment(`seg_${index}`, index * 3000, index * 3000 + 2500), text: "Current is conserved at a junction. ".repeat(5) }));
  let writing = 0;
  let maximumConcurrency = 0;
  const engine = new LlmNotesEngine(new MockKnowledgeEngine(), { generate: async (schema, _instructions, data) => {
    const request = data as { ranges?: { rangeIndex: number }[]; transcript?: CaptionSegment[] };
    if (request.ranges) return schema.parse({ sections: request.ranges.map(({ rangeIndex }) => ({ rangeIndex, heading: `Topic ${rangeIndex}` })) });
    writing++;
    maximumConcurrency = Math.max(maximumConcurrency, writing);
    await Promise.resolve();
    writing--;
    return schema.parse({ summary: "Current is conserved.", blocks: [], sourceSegmentIds: request.transcript!.map((item) => item.id), slideIndexes: [], supplements: [], keyTerms: [], takeaways: [] });
  } });
  const notes = await engine.generateNotes({ ...input, transcript, session: { ...input.session, endedAt: 7_200_000 } });
  expect(notes.sections.flatMap((section) => section.sourceSegmentIds)).toEqual(transcript.map((item) => item.id));
  expect(maximumConcurrency).toBeLessThanOrEqual(2);
});
