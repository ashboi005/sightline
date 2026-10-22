/**
 * Seeds one finished demo lecture (context, slides, transcript, gaze, notes) for the demo user so every
 * screen has data on first load. Runs only with MOCK_PERSISTENCE + MOCK_AUTH.
 */
import type { CaptionSegment } from "@sightline/contracts";
import { fixtures } from "@sightline/mocks";

import { newId } from "../../lib/ids";
import { DEMO_USER } from "./auth";
import type { PlatformService } from "./platform-service";
import type { AssetStore } from "./assets/asset-store";
import type { SlideProcessor } from "./slides/slide-processor";
import type { SessionStore } from "./store/types";

export async function seedDemoSession(deps: {
  store: SessionStore;
  slides: SlideProcessor;
  platform: PlatformService;
  assets: AssetStore;
  assetUrl: (assetId: string) => string;
}) {
  const { store, slides, platform, assets, assetUrl } = deps;
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

  // A snapshot of the worked KCL example on the board (the real pipeline captures these live).
  const segments = await store.listSegments(sessionId);
  const boardSegments = segments.filter((seg) => seg.startMs >= 42_000 && seg.startMs <= 57_000).map((seg) => seg.id);
  const boardAsset = await assets.put("image/svg+xml", new TextEncoder().encode(BOARD_SVG), sessionId);
  await store.upsertSnapshot({
    id: newId("snp"),
    sessionId,
    imageUrl: assetUrl(boardAsset),
    trigger: "SPEECH_CUE",
    reason: 'Teacher: "Let me draw an example on the board."',
    capturedAt: startedAt + 48_000,
    atMs: 48_000,
    segmentIds: boardSegments,
    description: "Node A with I₁ = 2 A and I₂ = 3 A entering and I₃ = 5 A leaving (KCL example).",
  });

  // The student looked up at the board for the worked KCL example.
  await store.addGazeTransition(sessionId, { from: "SCREEN", to: "BOARD", targetId: "teacher", ts: startedAt + 42_000 });
  await store.addGazeTransition(sessionId, { from: "BOARD", to: "SCREEN", targetId: null, ts: startedAt + 57_500 });

  await platform.regenerateNotes(DEMO_USER.id, sessionId);
  console.log(`[seed] demo session ${sessionId} ready`);
}

const BOARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
<rect width="960" height="540" fill="#1f3b2d"/>
<g stroke="#f5f5f0" stroke-width="4" fill="none" stroke-linecap="round">
<circle cx="480" cy="270" r="10" fill="#f5f5f0"/>
<line x1="180" y1="150" x2="470" y2="265"/><line x1="180" y1="390" x2="470" y2="275"/><line x1="490" y1="270" x2="800" y2="270"/>
<path d="M330 200 l20 14 -24 4"/><path d="M330 340 l20 -14 -24 -4"/><path d="M650 262 l20 8 -20 8"/>
</g>
<g fill="#f5f5f0" font-family="Comic Sans MS, Chalkboard, cursive" font-size="34">
<text x="455" y="240">A</text><text x="230" y="160">I₁ = 2 A</text><text x="230" y="430">I₂ = 3 A</text>
<text x="640" y="240">I₃ = ?</text><text x="300" y="500">I₃ = I₁ + I₂ = 5 A</text>
</g></svg>`;
