/**
 * OWNER: Tushar. Speech ports. MOCK_SPEECH=true → MockReplayStt + MockTts.
 */
import type { AudioFormat, RawTranscriptSegment } from "@sightline/contracts";

export type SttStreamOptions = {
  sessionId: string;
  format: AudioFormat;
  /** Glossary terms for Deepgram keyterm prompting. */
  keyterms: string[];
  /** Session `startedAt` (epoch ms) — segment offsets are relative to this. */
  startedAt: number;
  /** Next free `seq` for this session (streams can be reopened after reconnects). */
  nextSeq: () => number;
  onSegment: (segment: RawTranscriptSegment) => void;
  onError: (error: Error) => void;
};

export interface SttStream {
  /** Raw audio in the announced format. Ignored by replay streams. */
  push(chunk: Uint8Array): void;
  close(): Promise<void>;
}

export interface SpeechToText {
  readonly name: string;
  /** True when the stream invents a transcript instead of listening (mock replay). */
  readonly isReplay: boolean;
  open(options: SttStreamOptions): SttStream;
}

export type SynthesizedAudio = { contentType: "audio/mpeg" | "audio/wav"; bytes: Uint8Array };

export interface TextToSpeech {
  readonly name: string;
  synthesize(text: string, options?: { voiceId?: string }): Promise<SynthesizedAudio>;
}
