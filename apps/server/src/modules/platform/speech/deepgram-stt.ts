/**
 * OWNER: Tushar — Deepgram streaming STT (MOCK_SPEECH=false).
 *
 * TODO(tushar):
 *  - open a live connection (model = DEEPGRAM_MODEL, encoding=linear16, sample_rate=format.sampleRate,
 *    interim_results=true, smart_format=true, punctuate=true, keyterm=options.keyterms)
 *  - push(chunk) → connection.send(chunk); keep-alive every 8 s while idle
 *  - map each Results event → RawTranscriptSegment (stable id + seq per utterance; isFinal from is_final;
 *    startMs/endMs from start/duration + session offset)
 *  - reconnect with backoff; onError on fatal errors
 */
import { notImplemented } from "../../../lib/errors";
import type { SpeechToText, SttStream, SttStreamOptions } from "./types";

export class DeepgramStt implements SpeechToText {
  readonly name = "deepgram";
  readonly isReplay = false;

  constructor(
    readonly apiKey: string | undefined,
    readonly model: string,
  ) {}

  open(_options: SttStreamOptions): SttStream {
    throw notImplemented("DeepgramStt.open", "Tushar");
  }
}
