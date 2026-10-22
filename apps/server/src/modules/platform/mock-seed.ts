/**
 * Seeds one finished demo lecture (context, slides, transcript, gaze, notes) for the demo user so every
 * screen has data on first load. Runs only with MOCK_PERSISTENCE + MOCK_AUTH.
 */
import type { CaptionSegment } from "@sightline/contracts";
import { fixtures } from "@sightline/mocks";

import { newId } from "../../lib/ids";
import { DEMO_USER } from "./auth";
import type { PlatformService } from "./platform-service";
import type { SlideProcessor } from "./slides/slide-processor";
import type { SessionStore } from "./store/types";

export async function seedDemoSession(deps: { store: SessionStore; slides: SlideProcessor; platform: PlatformService }) {
  const { store, slides, platform } = deps;
  const { context, script } = fixtures.lecture;
  const startedAt = Date.now() - 60 * 60 * 1000;
  const sessionId = newId("ses");

  await store.createSession(DEMO_USER.id, {
    id: sessionId,
    title: `${context.session.title} (demo)`,
    subject: context.session.subject,
    mode: context.session.mode,
    status: "ENDED",
    contextStatus: "READY",
    slidesStatus: "READY",
    notesStatus: "EMPTY",
    createdAt: startedAt - 5 * 60 * 1000,
    startedAt,
    endedAt: startedAt + 2 * 60 * 1000,
  });

  await store.saveContext({
    sessionId,
    status: "READY",
    source: "TEXT_AND_SLIDES",
    text: context.contextText,
    topics: context.topics,
    glossary: context.glossary,
    chunkCount: 12,
    error: null,
    updatedAt: startedAt,
  });

  const slideList = await slides.process({ sessionId, fileName: fixtures.lecture.slides.fileName, bytes: new Uint8Array() });
  await store.saveSlideDeck({
    id: newId("dck"),
    sessionId,
    fileName: fixtures.lecture.slides.fileName,
    status: "READY",
    pageCount: slideList.length,
    slides: slideList,
    error: null,
    uploadedAt: startedAt - 4 * 60 * 1000,
  });

  for (const [seq, seg] of script.segments.entries()) {
    const segment: CaptionSegment = {
      id: newId("seg"),
      sessionId,
      seq,
      status: "REFINED",
      startMs: seg.atMs,
      endMs: seg.atMs + seg.durationMs,
      speaker: seg.speaker,
      rawText: seg.raw,
      ...seg.refined,
      slidePointer: seg.slidePointer,
    };
    await store.upsertSegment(segment);
  }

  // The student looked up at the board for the worked KCL example.
  await store.addGazeTransition(sessionId, { from: "SCREEN", to: "BOARD", targetId: "teacher", ts: startedAt + 42_000 });
  await store.addGazeTransition(sessionId, { from: "BOARD", to: "SCREEN", targetId: null, ts: startedAt + 57_500 });

  await platform.generateNotes(sessionId);
  console.log(`[seed] demo session ${sessionId} ready`);
}
