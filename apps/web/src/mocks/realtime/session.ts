import type { SocketHandlers } from "@/lib/realtime/socket";
import type { Session } from "@/types";
import type {
  CaptionPart,
  CaptionSegment,
  SessionClientMessage,
  SessionServerMessage,
  SlidePointer,
} from "@/types/realtime";

import { mockSessions } from "../data";
import { createMockSocket } from "./mock-socket";

type Line = {
  raw: string;
  parts: CaptionPart[];
  corrections?: CaptionSegment["corrections"];
  pointer?: SlidePointer;
  /** The teacher refers to the board here, so the server would ask for a snapshot. */
  visualCue?: boolean;
};

const t = (text: string): CaptionPart => ({ type: "text", text });
const term = (text: string, original: string | null = null): CaptionPart => ({
  type: "term",
  text,
  glossaryTermId: null,
  original,
});
const formula = (latex: string, spoken: string, display: "INLINE" | "BLOCK" = "INLINE"): CaptionPart => ({
  type: "formula",
  latex,
  spoken,
  display,
});

// A replay of the Kirchhoff lecture: raw speech-to-text (with its mistakes), then the refined version.
const LECTURE: Line[] = [
  {
    raw: "good morning everyone today we're going to look at kerchief's laws for electrical circuits",
    parts: [t("Good morning everyone, today we're going to look at "), term("Kirchhoff's", "kerchief's"), t(" laws for electrical circuits.")],
    corrections: [{ from: "kerchief's", to: "Kirchhoff's", reason: "GLOSSARY" }],
    pointer: { slideIndex: 0, bulletIndex: null, confidence: 0.92 },
  },
  {
    raw: "first a quick recap of homes law v equals i times r",
    parts: [t("First, a quick recap of "), term("Ohm's law", "homes law"), t(": "), formula("V = IR", "v equals i times r")],
    corrections: [{ from: "homes law", to: "Ohm's law", reason: "GLOSSARY" }],
    pointer: { slideIndex: 1, bulletIndex: 0, confidence: 0.95 },
  },
  {
    raw: "now kerchief's current law or k c l says that at any note the sum of currents entering equals the sum of currents leaving",
    parts: [
      t("Now, "),
      term("Kirchhoff's Current Law (KCL)", "kerchief's current law or k c l"),
      t(" says that at any "),
      term("node", "note"),
      t(" the sum of currents entering equals the sum of currents leaving."),
    ],
    corrections: [
      { from: "kerchief's current law or k c l", to: "Kirchhoff's Current Law (KCL)", reason: "GLOSSARY" },
      { from: "note", to: "node", reason: "CONTEXT" },
    ],
    pointer: { slideIndex: 2, bulletIndex: 0, confidence: 0.94 },
  },
  {
    raw: "we can write that as sigma i in equals sigma i out or equivalently the summation of i k from k equals one to n equals zero",
    parts: [
      t("We can write that as "),
      formula("\\sum I_{\\text{in}} = \\sum I_{\\text{out}}", "sigma i in equals sigma i out"),
      t(", or equivalently:"),
      formula("\\sum_{k=1}^{n} I_k = 0", "the summation of i k from k equals one to n equals zero", "BLOCK"),
    ],
    corrections: [{ from: "sigma i in equals sigma i out", to: "\\sum I_{in} = \\sum I_{out}", reason: "FORMULA" }],
    pointer: { slideIndex: 2, bulletIndex: 1, confidence: 0.93 },
  },
  {
    raw: "let me draw an example on the board",
    parts: [t("Let me draw an example on the board.")],
    visualCue: true,
  },
  {
    raw: "moving on kerchief's voltage law k v l says the sum of all voltages around any closed loop is zero",
    parts: [
      t("Moving on: "),
      term("Kirchhoff's Voltage Law (KVL)", "kerchief's voltage law k v l"),
      t(" says the sum of all voltages around any closed loop is zero."),
    ],
    corrections: [{ from: "kerchief's voltage law k v l", to: "Kirchhoff's Voltage Law (KVL)", reason: "GLOSSARY" }],
    pointer: { slideIndex: 3, bulletIndex: 0, confidence: 0.95 },
  },
  {
    raw: "sum of v k around the loop equals zero",
    parts: [formula("\\sum_{k} V_k = 0", "sum of v k around the loop equals zero", "BLOCK")],
    corrections: [{ from: "sum of v k around the loop equals zero", to: "\\sum_{k} V_k = 0", reason: "FORMULA" }],
    pointer: { slideIndex: 3, bulletIndex: 0, confidence: 0.9 },
  },
  {
    raw: "sign convention matters going across a resistor in the direction of current the voltage drops by i r",
    parts: [
      t("Sign convention matters: going across a resistor in the direction of current, the voltage drops by "),
      formula("IR", "i r"),
      t("."),
    ],
    pointer: { slideIndex: 4, bulletIndex: 0, confidence: 0.93 },
  },
  {
    raw: "any questions so far",
    parts: [t("Any questions so far?")],
  },
];

const WORD_MS = 220; // interim words appear at roughly speaking pace
const REFINE_MS = 1100; // the correction lands about a second after the final
const LINE_GAP_MS = 1800;
const LOOP_GAP_MS = 6000;

const plainText = (parts: CaptionPart[]) =>
  parts.map((p) => (p.type === "formula" ? p.latex : p.text)).join("");

function liveSession(sessionId: string, startedAt: number): Session {
  const known = mockSessions.find((s) => s.id === sessionId);
  return {
    ...(known ?? {
      id: sessionId,
      title: "EE101 Lecture 7: Kirchhoff's laws",
      subject: "Basic Electrical Engineering",
      mode: "DEAF",
      contextStatus: "READY",
      slidesStatus: "READY",
      notesStatus: "EMPTY",
      createdAt: startedAt,
    }),
    status: "LIVE",
    startedAt,
    endedAt: null,
  } as Session;
}

/** Replays the lecture forever: interim words → final (raw) → refined, plus slide pointers and a snapshot cue. */
export function mockSessionSocket(sessionId: string, handlers: SocketHandlers<SessionServerMessage>) {
  return createMockSocket<SessionServerMessage, SessionClientMessage>(handlers, ({ emit, after }) => {
    const startedAt = Date.now();
    let seq = 0;

    emit({ type: "session.ready", session: liveSession(sessionId, startedAt), isReplay: true, ts: Date.now() });

    const playLine = (index: number) => {
      const line = LECTURE[index];
      if (!line) return after(LOOP_GAP_MS, () => playLine(0));

      const id = `seg_mock_${seq}`;
      const lineSeq = seq++;
      const startMs = Date.now() - startedAt;
      const words = line.raw.split(" ");

      words.forEach((_, w) =>
        after(w * WORD_MS, () =>
          emit({
            type: "caption.interim",
            segmentId: id,
            seq: lineSeq,
            text: words.slice(0, w + 1).join(" "),
            startMs,
            ts: Date.now(),
          }),
        ),
      );

      const spokenMs = words.length * WORD_MS;
      const base: CaptionSegment = {
        id,
        sessionId,
        seq: lineSeq,
        status: "FINAL",
        startMs,
        endMs: startMs + spokenMs,
        speaker: "teacher",
        rawText: line.raw,
        text: line.raw,
        parts: [t(line.raw)],
        corrections: [],
        slidePointer: null,
        confidence: 0.86,
      };

      after(spokenMs, () => {
        emit({ type: "caption.final", segment: base, ts: Date.now() });
        if (line.visualCue) {
          emit({ type: "snapshot.request", trigger: "SPEECH_CUE", reason: `Teacher: "${line.raw}"`, segmentId: id, ts: Date.now() });
        }
      });

      after(spokenMs + REFINE_MS, () => {
        const segment: CaptionSegment = {
          ...base,
          status: "REFINED",
          text: plainText(line.parts),
          parts: line.parts,
          corrections: line.corrections ?? [],
          slidePointer: line.pointer ?? null,
          confidence: 0.95,
        };
        emit({ type: "caption.refined", segment, ts: Date.now() });
        if (line.pointer) emit({ type: "slide.pointer", pointer: line.pointer, ts: Date.now() });
      });

      after(spokenMs + LINE_GAP_MS, () => playLine(index + 1));
    };

    after(600, () => playLine(0));

    return {
      onCommand: (command) => {
        // Captions are a replay, so mic audio (audio.start/stop) and gaze transitions need no answer.
        if (command.type === "ping") emit({ type: "pong", ts: Date.now() });
      },
    };
  });
}
