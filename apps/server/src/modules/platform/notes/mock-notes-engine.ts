/**
 * Fixture-backed NotesEngine. Used when MOCK_NOTES=true. Returns the Kirchhoff notes, linked to the real
 * transcript segments (by slide), with board-focus markers from the away windows and the live snapshots placed
 * as image blocks in the section they belong to (by caption overlap, else time).
 */
import type { GenerateNotesInput, NoteSection, NotesDraft, NotesEngine } from "@sightline/contracts";
import { fixtures } from "@sightline/mocks";
import { boardFocus, renderNotes } from "./render";
import { placeSnapshots } from "./place-snapshots";

export { placeSnapshots } from "./place-snapshots";

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
