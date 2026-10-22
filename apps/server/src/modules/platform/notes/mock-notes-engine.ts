/**
 * Fixture-backed NotesEngine. Used when MOCK_NOTES=true. Returns the Kirchhoff notes, linked to the real
 * transcript segments (by slide) and with board-focus markers computed from the away windows.
 */
import type { GenerateNotesInput, NotesDraft, NotesEngine } from "@sightline/contracts";
import { fixtures } from "@sightline/mocks";

export class MockNotesEngine implements NotesEngine {
  readonly name = "mock";

  async generateNotes(input: GenerateNotesInput): Promise<NotesDraft> {
    await new Promise((r) => setTimeout(r, 2500));
    const { transcript, awayWindows } = input;
    const sections = fixtures.lecture.notes.sections.map((section) => {
      const segs = transcript.filter((s) => s.slidePointer && section.slideIndexes.includes(s.slidePointer.slideIndex));
      const segIds = new Set(segs.map((s) => s.id));
      const awaySeconds = awayWindows
        .filter((w) => w.zone === "BOARD" && w.missedSegmentIds.some((id) => segIds.has(id)))
        .reduce((sum, w) => sum + (w.endedAt - w.startedAt) / 1000, 0);
      return {
        ...section,
        sourceSegmentIds: [...segIds],
        boardFocus: awaySeconds > 0 ? { isBoardHeavy: awaySeconds >= 10, awaySeconds: Math.round(awaySeconds) } : section.boardFocus,
      };
    });
    return { ...fixtures.lecture.notes, sessionId: input.session.id, title: `${input.session.title} — Notes`, sections };
  }
}
