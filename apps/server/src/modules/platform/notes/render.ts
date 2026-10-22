import type { AwayWindow, CaptionSegment, NoteBlock, NoteSection, NotesDraft } from "@sightline/contracts";

function merged(intervals: [number, number][]) {
  const result: [number, number][] = [];
  for (const interval of intervals.filter(([start, end]) => end > start).sort((left, right) => left[0] - right[0])) {
    const last = result.at(-1);
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else result.push([...interval]);
  }
  return result;
}

export function boardFocus(segments: CaptionSegment[], windows: AwayWindow[], startedAt: number): NoteSection["boardFocus"] {
  const spoken = merged(segments.map((segment) => [startedAt + segment.startMs, startedAt + segment.endMs]));
  const board = merged(windows.filter((window) => window.zone === "BOARD").map((window) => [window.startedAt, window.endedAt]));
  let milliseconds = 0;
  for (const [start, end] of spoken) for (const [boardStart, boardEnd] of board) milliseconds += Math.max(0, Math.min(end, boardEnd) - Math.max(start, boardStart));
  return milliseconds ? { isBoardHeavy: milliseconds >= 10_000, awaySeconds: Math.round(milliseconds / 100) / 10 } : null;
}

function renderBlock(block: NoteBlock): string {
  switch (block.type) {
    case "paragraph": return block.text;
    case "bullets": return block.items.map((item) => `- ${item}`).join("\n");
    case "definition": return `**${block.term}:** ${block.definition}`;
    case "formula": return `$$\n${block.latex}\n$$${block.caption ? `\n\n${block.caption}` : ""}`;
    case "image": return `![${(block.caption ?? "Board snapshot").replace(/[\[\]]/g, "")}](${block.url})`;
    case "callout": return `> **${block.variant}:** ${block.text.replace(/\n/g, "\n> ")}`;
  }
}

export function renderNotes(notes: Omit<NotesDraft, "markdown">): string {
  const sections = notes.sections.map((section) => `## ${section.heading}\n\n${section.blocks.map(renderBlock).join("\n\n")}${section.boardFocus?.isBoardHeavy ? `\n\n> **BOARD:** ${section.boardFocus.awaySeconds} seconds looking at the board.` : ""}`);
  return [`# ${notes.title}`, notes.summary, ...sections,
    ...(notes.keyTerms.length ? ["## Key Terms", notes.keyTerms.map((term) => `- **${term.term}:** ${term.definition}`).join("\n")] : []),
    ...(notes.formulas.length ? ["## Formulas", notes.formulas.map((formula) => `$$\n${formula.latex}\n$$\n\n${formula.description}`).join("\n\n")] : []),
    ...(notes.takeaways.length ? ["## Takeaways", notes.takeaways.map((takeaway) => `- ${takeaway}`).join("\n")] : [])].join("\n\n") + "\n";
}

export function partitionTranscript(transcript: CaptionSegment[], maxCharacters = 14_000): CaptionSegment[][] {
  const ranges: CaptionSegment[][] = [];
  let current: CaptionSegment[] = [];
  let length = 0;
  for (const segment of [...transcript].sort((left, right) => left.seq - right.seq)) {
    if (segment.status === "INTERIM" || !segment.text.trim()) continue;
    if (current.length && length + segment.text.length > maxCharacters) { ranges.push(current); current = []; length = 0; }
    current.push(segment);
    length += segment.text.length;
  }
  if (current.length) ranges.push(current);
  return ranges;
}
