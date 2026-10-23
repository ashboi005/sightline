import { startVoiceSession } from "./voice-session"
import type {
  LocalVoiceSnapshot,
  VoiceSession,
  VoiceSessionFactory,
} from "./local-voice.types"

export class LocalVoiceController {
  private snapshot: LocalVoiceSnapshot = {
    status: "idle",
    message: "Voice off.",
  }
  private listeners = new Set<() => void>()
  private session: VoiceSession | null = null
  private startup: AbortController | null = null
  private disposed = false
  constructor(
    private readonly factory: VoiceSessionFactory = startVoiceSession
  ) {}
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private update(next: LocalVoiceSnapshot) {
    this.snapshot = next
    this.listeners.forEach((listener) => listener())
  }
  mount() {
    this.disposed = false
  }
  stop() {
    this.startup?.abort()
    this.startup = null
    this.session?.stop()
    this.session = null
    this.update({ status: "idle", message: "Voice off." })
  }
  dispose() {
    this.stop()
    this.disposed = true
  }
  async start(handler: (text: string) => void) {
    if (this.disposed || this.startup || this.session) {
      return
    }
    const startup = new AbortController()
    this.startup = startup
    this.update({ status: "starting", message: "Starting local voice…" })
    const current = () =>
      !this.disposed && this.startup === startup && !startup.signal.aborted
    const fail = (failure: unknown) => {
      if (!current()) {
        return
      }
      this.stop()
      const denied =
        failure instanceof Error && failure.name === "NotAllowedError"
      this.update({
        status: "error",
        message: denied
          ? "Allow microphone access, then tap Voice again."
          : "Voice could not start. Tap Voice to retry or type a command.",
      })
    }
    try {
      const session = await this.factory(
        (text) => {
          if (current()) {
            this.update({ ...this.snapshot, message: `Heard: ${text}` })
            handler(text)
          }
        },
        startup.signal,
        fail,
        () => {
          if (current()) {
            this.update({
              ...this.snapshot,
              message: "Command not understood. Say one command, then pause.",
            })
          }
        }
      )
      if (!current()) {
        session.stop()
        return
      }
      this.session = session
      this.update({
        status: "listening",
        message: "Say one command, then pause.",
      })
    } catch (failure) {
      fail(failure)
    }
  }
}
