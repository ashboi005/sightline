export type LocalVoiceSnapshot = {
  status: "idle" | "starting" | "listening" | "error"
  message: string
}
export type VoiceSession = { stop: () => void }
export type VoiceSessionFactory = (
  handler: (text: string) => void,
  signal: AbortSignal,
  onFailure: (failure: unknown) => void,
  onRejected?: () => void
) => Promise<VoiceSession>
