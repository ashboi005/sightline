import type { ServerMessageResult } from "@lichess-org/vosk-browser/dist/vosk.interfaces"
export type VoiceResult = ServerMessageResult["result"]
export type VoiceDecoder = {
  listen: (
    sampleRate: number,
    handler: (text: string) => void,
    onFailure: (failure: unknown) => void,
    onRejected?: () => void
  ) => void
  accept: (samples: Float32Array, sampleRate: number) => void
  stop: () => void
}
