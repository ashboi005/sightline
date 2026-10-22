// WebSocket message shapes, mirrored from the protocol docs in docs/contracts/ (realtime-ws, gaze-bridge,
// sign-service). If a backend message changes, change it here too. Timestamps are Unix epoch milliseconds.

import type { AccessibilityMode, ProcessingStatus, Session, SessionStatus } from "./index";

// ---------------------------------------------------------------------------
// Captions, slides, sign utterances, snapshots (carried by the session socket)
// ---------------------------------------------------------------------------

/** Render `formula` parts with KaTeX; `display: BLOCK` gets its own line. */
export type CaptionPart =
  | { type: "text"; text: string }
  /** A glossary term. `original` is what speech-to-text heard before it was corrected ("kerchief's"). */
  | { type: "term"; text: string; glossaryTermId: string | null; original: string | null }
  /** `spoken` is the words the teacher said, for hover / alt text. */
  | { type: "formula"; latex: string; spoken: string; display: "INLINE" | "BLOCK" };

/** INTERIM = still being spoken. FINAL = speech-to-text is done (raw). REFINED = corrected. */
export type CaptionStatus = "INTERIM" | "FINAL" | "REFINED";

export type CaptionSegment = {
  id: string;
  sessionId: string;
  /** Monotonic per session. Order captions by this, not by arrival. */
  seq: number;
  status: CaptionStatus;
  /** Milliseconds since the session started. */
  startMs: number;
  endMs: number;
  speaker: string | null;
  rawText: string;
  text: string;
  parts: CaptionPart[];
  corrections: { from: string; to: string; reason: "GLOSSARY" | "FORMULA" | "GRAMMAR" | "CONTEXT" }[];
  slidePointer: SlidePointer | null;
  confidence: number;
};

export type SlidePointer = { slideIndex: number; bulletIndex: number | null; confidence: number };

export type SignSource = "SELF" | "PEER";

/** One recognised sign. `gloss` is the UPPERCASE sign label, e.g. "REPEAT"; fingerspelling gives "OHM". */
export type SignToken = {
  id: string;
  gloss: string;
  kind: "SIGN" | "FINGERSPELL" | "NUMBER";
  confidence: number;
  ts: number;
};

/** A signed phrase turned into a sentence (+ speech audio). */
export type SignUtterance = {
  id: string;
  sessionId: string;
  source: SignSource;
  gloss: string[];
  text: string;
  alternatives: string[];
  audioUrl: string | null;
  confidence: number;
  createdAt: number;
};

export type SnapshotTrigger = "SPEECH_CUE" | "BOARD_DWELL" | "VISUAL_CHANGE" | "POINTING" | "MANUAL";

export type Snapshot = {
  id: string;
  sessionId: string;
  imageUrl: string;
  trigger: SnapshotTrigger;
  reason: string;
  capturedAt: number;
  atMs: number;
  segmentIds: string[];
  /** One-line description from the vision model; null until it arrives. */
  description: string | null;
};

/** Every socket's error frame. */
export type SocketErrorMessage = { type: "error"; code: string; message: string; ts: number };

// ---------------------------------------------------------------------------
// Session socket: web ↔ server   ${NEXT_PUBLIC_SERVER_WS_URL}/ws/sessions/:sessionId
// ---------------------------------------------------------------------------

export type AudioFormat = { encoding: "LINEAR16"; sampleRate: 16000 | 48000; channels: 1 };

export type SessionClientMessage =
  /** Start streaming mic audio; binary PCM frames follow. */
  | { type: "audio.start"; format: AudioFormat; ts: number }
  | { type: "audio.stop"; ts: number }
  /** Forward every zone change from the gaze bridge (the server uses them for notes). */
  | { type: "gaze.transition"; transition: GazeTransition; ts: number }
  | { type: "ping"; ts: number };

export type SessionServerMessage =
  /** First message after connecting. `isReplay` = captions come from a recorded lecture, mic not needed. */
  | { type: "session.ready"; session: Session; isReplay: boolean; ts: number }
  | { type: "session.status"; status: SessionStatus; ts: number }
  /** Words still being spoken. Replace the single "typing" line. */
  | { type: "caption.interim"; segmentId: string; seq: number; text: string; startMs: number; ts: number }
  /** Speech-to-text finished a segment. Append it. */
  | { type: "caption.final"; segment: CaptionSegment; ts: number }
  /** Corrected version of a final segment. Replace by `segment.id`; can arrive after later finals. */
  | { type: "caption.refined"; segment: CaptionSegment; ts: number }
  | { type: "slide.pointer"; pointer: SlidePointer; ts: number }
  | { type: "sign.utterance"; utterance: SignUtterance; ts: number }
  /** The teacher referred to something visual: grab the scene frame and POST it to /snapshots. */
  | { type: "snapshot.request"; trigger: SnapshotTrigger; reason: string; segmentId: string | null; ts: number }
  /** A snapshot was stored (sent again once its description arrives). */
  | { type: "snapshot.captured"; snapshot: Snapshot; ts: number }
  | { type: "notes.status"; status: ProcessingStatus; notesId: string | null; ts: number }
  | { type: "pong"; ts: number }
  | SocketErrorMessage;

// ---------------------------------------------------------------------------
// Gaze bridge: web ↔ local eye-tracker daemon   NEXT_PUBLIC_GAZE_BRIDGE_URL (ws://localhost:7777)
// ---------------------------------------------------------------------------

/** UNKNOWN = blink or lost tracking: treat it as "no change". */
export type GazeZone = "SCREEN" | "BOARD" | "PERSON" | "AWAY" | "UNKNOWN";

export type GazeTransition = { from: GazeZone; to: GazeZone; targetId: string | null; ts: number };

/** A person the student can focus on in hard-of-hearing mode. */
export type FocusTarget = {
  id: string;
  label: string;
  kind: "TEACHER" | "PEER" | "UNKNOWN";
  /** -90 (left) … +90 (right). */
  azimuthDeg: number;
};

export type DeviceStatus = {
  type: "device.status";
  protocolVersion: string;
  tracker: "CONNECTED" | "DISCONNECTED";
  calibrated: boolean;
  audioFocus: "ACTIVE" | "IDLE" | "UNAVAILABLE";
  mode: AccessibilityMode;
  ts: number;
};

export type CalibrationProgress = {
  type: "calibration.progress";
  step: number;
  totalSteps: number;
  instruction: string;
  /** Where to draw the dot (0..1); null for "look at the board" steps. */
  target: { x: number; y: number } | null;
  ts: number;
};

export type CalibrationResult = { type: "calibration.result"; ok: boolean; quality: number; message: string; ts: number };

export type GazeBridgeMessage =
  | DeviceStatus
  /** On every change (debounced ~150 ms) and as a 1 Hz heartbeat. */
  | { type: "gaze.zone"; zone: GazeZone; targetId: string | null; confidence: number; ts: number }
  /** On-screen gaze point, 0..1 from top-left. Only while subscribed and zone = SCREEN. */
  | { type: "gaze.point"; x: number; y: number; ts: number }
  /** Gaze in the scene-camera image, for look-to-hear. */
  | { type: "gaze.scene"; x: number; y: number; valid: boolean; confidence: number; ts: number }
  | { type: "gaze.targets"; targets: FocusTarget[]; ts: number }
  | { type: "audio.focus"; targetId: string | null; label: string | null; locked: boolean; ts: number }
  | CalibrationProgress
  | CalibrationResult
  | SocketErrorMessage;

export type GazeBridgeCommand =
  | { type: "hello"; client: string; protocolVersion: string }
  | { type: "calibration.start" }
  | { type: "calibration.confirm"; step: number }
  | { type: "calibration.cancel" }
  | { type: "mode.set"; mode: AccessibilityMode }
  | { type: "audio.focus.lock"; targetId: string }
  | { type: "audio.focus.unlock" }
  | { type: "gaze.point.subscribe"; enabled: boolean };

// ---------------------------------------------------------------------------
// Sign service: web ↔ sign recogniser   NEXT_PUBLIC_SIGN_SERVICE_URL (ws://localhost:7788/ws)
// ---------------------------------------------------------------------------

export type SignServiceCommand =
  /** Recommended 10–15 fps at 640×480. */
  | { type: "stream.start"; protocolVersion: string; source: SignSource; fps: number; width: number; height: number }
  /** One webcam frame as base64 JPEG (no data: prefix, not mirrored). */
  | { type: "frame"; seq: number; image: string; ts: number }
  | { type: "stream.stop" }
  /** Drop the in-progress phrase (student pressed "clear"). */
  | { type: "phrase.reset" };

export type SignServiceMessage =
  | { type: "service.ready"; protocolVersion: string; model: string; vocabulary: string[]; ts: number }
  | { type: "hands.status"; handsDetected: number; ts: number }
  /** Live best guess; may change. Show it greyed out, never send it to the server. */
  | { type: "sign.partial"; gloss: string; confidence: number; ts: number }
  | { type: "sign.token"; token: SignToken; ts: number }
  /** Hands down ~1 s: the phrase is done. POST its tokens to /api/sessions/:id/sign/utterances. */
  | { type: "phrase.end"; tokenIds: string[]; ts: number }
  | SocketErrorMessage;
