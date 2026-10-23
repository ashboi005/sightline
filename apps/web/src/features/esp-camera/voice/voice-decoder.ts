import type { ServerMessage } from "@lichess-org/vosk-browser/dist/vosk.interfaces"
import { viewerCommandPhrases, normalizeCommand } from "./commands"
import type { VoiceDecoder, VoiceResult } from "./voice-decoder.types"

export function recognizedCommand(result: VoiceResult, phrases: readonly string[] = viewerCommandPhrases): string | null {
  if (
    !result ||
    typeof result.text !== "string" ||
    !phrases.includes(normalizeCommand(result.text)) ||
    !Array.isArray(result.result) ||
    !result.result.length
  ) {
    return null
  }
  if (
    result.result.some(
      (word) => !Number.isFinite(word?.conf) || word.conf < 0.75
    )
  ) {
    return null
  }
  return result.text
}

/** Own the worker directly so abort also cancels model loading and frees WASM memory. */
export function loadVoiceDecoder(
  signal: AbortSignal,
  onFailure: (failure: unknown) => void = () => {},
  phrases: readonly string[] = viewerCommandPhrases
): Promise<VoiceDecoder> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const worker = new Worker("/voice-runtime/vosk.worker.js", {
      type: "module",
    })
    let loaded = false
    let stopped = false
    let resultHandler: (text: string) => void = () => {}
    let rejectedHandler: () => void = () => {}
    let failureHandler = onFailure
    let terminalFailure: unknown = null
    const stop = () => {
      if (stopped) {
        return
      }
      stopped = true
      clearTimeout(timeout)
      signal.removeEventListener("abort", abort)
      worker.terminate()
    }
    const abort = () => {
      stop()
      if (!loaded) {
        reject(new DOMException("Voice stopped", "AbortError"))
      }
    }
    const fail = (failure: unknown) => {
      terminalFailure = failure
      stop()
      if (loaded) {
        failureHandler(failure)
      } else {
        reject(failure)
      }
    }
    const timeout = setTimeout(
      () => fail(new Error("Voice model timed out")),
      120_000
    )
    signal.addEventListener("abort", abort, { once: true })
    worker.onerror = () => fail(new Error("Local voice worker failed"))
    worker.onmessageerror = () => fail(new Error("Invalid voice response"))
    worker.onmessage = (event: MessageEvent<ServerMessage>) => {
      if (stopped) {
        return
      }
      const message = event.data
      // Emscripten may emit startup messages without a recognition payload.
      if (!message || typeof message !== "object" || !("event" in message)) {
        return
      }
      if (message.event === "error") {
        fail(new Error("Local voice model failed"))
      } else if (message.event === "load") {
        if (!message.result) {
          fail(new Error("Voice model unavailable"))
          return
        }
        loaded = true
        clearTimeout(timeout)
        resolve({
          listen(sampleRate, handler, onFailure, onRejected = () => {}) {
            if (stopped) {
              throw (
                terminalFailure ??
                new DOMException("Voice stopped", "AbortError")
              )
            }
            resultHandler = handler
            rejectedHandler = onRejected
            failureHandler = onFailure
            worker.postMessage({
              action: "create",
              recognizerId: "viewer",
              sampleRate,
              grammar: JSON.stringify([...phrases, "[unk]"]),
            })
            worker.postMessage({
              action: "set",
              recognizerId: "viewer",
              key: "words",
              value: true,
            })
          },
          accept(samples, sampleRate) {
            if (stopped) {
              return
            }
            const data = samples.map((value) => value * 32768)
            worker.postMessage(
              {
                action: "audioChunk",
                recognizerId: "viewer",
                data,
                sampleRate,
              },
              [data.buffer]
            )
          },
          stop,
        })
      } else if (message.event === "result") {
        const text = recognizedCommand(message.result, phrases)
        if (text) {
          resultHandler(text)
        } else if (
          typeof message.result?.text === "string" &&
          message.result.text.trim()
        ) {
          rejectedHandler()
        }
      }
    }
    worker.postMessage({ action: "set", key: "logLevel", value: -1 })
    worker.postMessage({
      action: "load",
      modelUrl: new URL("/voice-runtime/english-0.15.tar.gz", location.origin)
        .href,
      wasmUrl: new URL("/voice-runtime/vosk.wasm", location.origin).href,
    })
  })
}
