import { loadVoiceDecoder } from "./voice-decoder"
import type { VoiceDecoder } from "./voice-decoder.types"
import type { VoiceSessionFactory } from "./local-voice.types"

export const startVoiceSession: VoiceSessionFactory = async (
  handler,
  signal,
  onFailure,
  onRejected
) => {
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof AudioWorkletNode === "undefined"
  ) {
    throw new Error("Local voice is unavailable")
  }
  signal.throwIfAborted()
  const cancellation = new AbortController()
  const activeSignal = AbortSignal.any([signal, cancellation.signal])
  const context = new AudioContext()
  let stream: MediaStream | null = null
  let decoder: VoiceDecoder | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let node: AudioWorkletNode | null = null
  let stopped = false
  const stop = () => {
    if (stopped) {
      return
    }
    stopped = true
    cancellation.abort()
    signal.removeEventListener("abort", stop)
    if (node) {
      node.port.onmessage = null
      node.port.close()
      node.disconnect()
    }
    source?.disconnect()
    stream?.getTracks().forEach((track) => track.stop())
    decoder?.stop()
    void context.close().catch(() => {})
  }
  const fail = (failure: unknown) => {
    stop()
    onFailure(failure)
  }
  signal.addEventListener("abort", stop, { once: true })
  try {
    // Resume on the user's Voice click before the asynchronous permission/model work.
    await context.resume()
    activeSignal.throwIfAborted()
    stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    })
    if (activeSignal.aborted) {
      stream.getTracks().forEach((track) => track.stop())
      activeSignal.throwIfAborted()
    }
    stream.getTracks().forEach((track) =>
      track.addEventListener(
        "ended",
        () => {
          if (!stopped) {
            fail(new Error("Microphone disconnected"))
          }
        },
        { once: true }
      )
    )
    if (stream.getAudioTracks().some((track) => track.readyState === "ended")) {
      throw new Error("Microphone disconnected")
    }
    decoder = await loadVoiceDecoder(activeSignal, fail)
    await context.audioWorklet.addModule("/voice-runtime/microphone.worklet.js")
    activeSignal.throwIfAborted()
    decoder.listen(context.sampleRate, handler, fail, onRejected)
    source = context.createMediaStreamSource(stream)
    node = new AudioWorkletNode(context, "viewer-microphone", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })
    const activeDecoder = decoder
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (!stopped) {
        activeDecoder.accept(event.data, context.sampleRate)
      }
    }
    node.onprocessorerror = () =>
      fail(new Error("Microphone processing failed"))
    source.connect(node)
    // The processor writes silence, so the microphone is never played back.
    node.connect(context.destination)
    return { stop }
  } catch (failure) {
    stop()
    throw failure
  }
}
