/**
 * Fixture-backed NotesEngine. Used when MOCK_NOTES=true. Returns the Kirchhoff notes, linked to the real
 * transcript segments (by slide), with board-focus markers from the away windows and the live snapshots placed
 * as image blocks in the section they belong to (by caption overlap, else time).
 */
import type { GenerateNotesInput, NoteBlock, NoteSection, NotesDraft, NotesEngine, Snapshot } from "@sightline/contracts";
import { fixtures } from "@sightline/mocks";
import { boardFocus, renderNotes } from "./render";

export class MockNotesEngine implements NotesEngine {
  readonly name = "mock";

  async generateNotes(input: GenerateNotesInput): Promise<NotesDraft> {
    await new Promise((r) => setTimeout(r, 2500));
    const { transcript, awayWindows } = input;
    const sections: NoteSection[] = fixtures.lecture.notes.sections.map((section) => {
      const segs = transcript.filter((s) => s.slidePointer && section.slideIndexes.includes(s.slidePointer.slideIndex));
      const segIds = new Set(segs.map((s) => s.id));
      return {
        ...section,
        blocks: [...section.blocks],
        sourceSegmentIds: [...segIds],
        boardFocus: boardFocus(segs, awayWindows, input.session.startedAt ?? input.session.createdAt),
      };
    });
    placeSnapshots(sections, input.snapshots ?? [], transcript);
    const notes = { ...fixtures.lecture.notes, sessionId: input.session.id, title: `${input.session.title} — Notes`, sections };
    return { ...notes, markdown: renderNotes(notes) };
  }
}

/** Put each snapshot into the section that owns the captions around it; else the section active at that time. */
export function placeSnapshots(sections: NoteSection[], snapshots: Snapshot[], transcript: GenerateNotesInput["transcript"]) {
  for (const snap of snapshots) {
    const block: NoteBlock = { type: "image", snapshotId: snap.id, url: snap.imageUrl, caption: snap.description ?? snap.reason };
    let target = sections.find((s) => s.sourceSegmentIds.some((id) => snap.segmentIds.includes(id)));
    if (!target) {
      // Fall back to the slide being explained just before the capture.
      const before = [...transcript].reverse().find((seg) => seg.startMs <= snap.atMs && seg.slidePointer);
      target = sections.find((s) => before?.slidePointer && s.slideIndexes.includes(before.slidePointer.slideIndex)) ?? sections.at(-1);
    }
    if (!target) continue;
    // After the first block (usually the definition) so the picture sits next to the explanation.
    target.blocks.splice(Math.min(1, target.blocks.length), 0, block);
  }
}
