/**
 * OWNER: Tushar — the real NotesEngine (Mastra workflow grounded with the KnowledgeEngine).
 * Until done, run with MOCK_NOTES=true.
 */
import type { GenerateNotesInput, KnowledgeEngine, NotesDraft, NotesEngine } from "@sightline/contracts";

import { notImplemented } from "../../../lib/errors";

export class LlmNotesEngine implements NotesEngine {
  readonly name = "mastra";

  constructor(readonly knowledge: KnowledgeEngine) {}

  async generateNotes(_input: GenerateNotesInput): Promise<NotesDraft> {
    // TODO(tushar): Mastra workflow — outline from context topics/slides → per-section writer over transcript
    //   ranges (retrieveContext for grounding) → collate formulas (from caption formula parts) + key terms →
    //   render `markdown`. P1: mark sections overlapping long BOARD awayWindows as boardFocus.
    throw notImplemented("NotesEngine.generateNotes", "Tushar");
  }
}
