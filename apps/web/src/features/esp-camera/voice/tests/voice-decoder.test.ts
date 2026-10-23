import { expect, test } from "bun:test"
import {
  loadVoiceDecoder,
  recognizedCommand,
} from "../voice-decoder"

test("only complete supported commands with confident final words are accepted", () => {
  const result = (text: string, conf = 0.95) => ({
    text,
    result: text.split(" ").map((word) => ({ word, conf, start: 0, end: 1 })),
  })
  expect(recognizedCommand(result("track"))).toBe("track")
  expect(recognizedCommand(result("stop tracking"))).toBe("stop tracking")
  expect(recognizedCommand(result("stop tracking", 0.3))).toBeNull()
  expect(recognizedCommand(result("please stop tracking"))).toBeNull()
  expect(recognizedCommand(result("[unk]"))).toBeNull()
  expect(recognizedCommand({ text: "stop tracking", result: [] })).toBeNull()
  expect(recognizedCommand(result("stop listening"), ["select", "stop listening"])).toBe("stop listening")
  expect(recognizedCommand(result("track"), ["select", "stop listening"])).toBeNull()
})

function workerFixture() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Worker")
  const previousLocation = Object.getOwnPropertyDescriptor(
    globalThis,
    "location"
  )
  let worker!: FakeWorker
  class FakeWorker {
    messages: any[] = []
    terminated = false
    onmessage: ((event: any) => void) | null = null
    onerror: (() => void) | null = null
    onmessageerror: (() => void) | null = null
    constructor(url: string, options: WorkerOptions) {
      expect(url).toBe("/voice-runtime/vosk.worker.js")
      expect(options.type).toBe("module")
      worker = this
    }
    postMessage(message: any) {
      this.messages.push(message)
    }
    terminate() {
      this.terminated = true
    }
    emit(data: any) {
      this.onmessage?.({ data })
    }
  }
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: FakeWorker,
  })
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { origin: "http://localhost" },
  })
  return {
    get worker() {
      return worker
    },
    restore() {
      if (previous) Object.defineProperty(globalThis, "Worker", previous)
      else Reflect.deleteProperty(globalThis, "Worker")
      if (previousLocation)
        Object.defineProperty(globalThis, "location", previousLocation)
      else Reflect.deleteProperty(globalThis, "location")
    },
  }
}

test("decoder uses same-origin assets, converts microphone PCM and ignores partial results", async () => {
  const fixture = workerFixture()
  const abort = new AbortController()
  try {
    const loading = loadVoiceDecoder(abort.signal)
    expect(fixture.worker.messages[1]).toEqual({
      action: "load",
      modelUrl: "http://localhost/voice-runtime/english-0.15.tar.gz",
      wasmUrl: "http://localhost/voice-runtime/vosk.wasm",
    })
    fixture.worker.emit(undefined)
    fixture.worker.emit({ event: "startup" })
    fixture.worker.emit({ event: "load", result: true })
    const decoder = await loading
    const heard: string[] = []
    decoder.listen(
      48000,
      (text) => heard.push(text),
      () => {}
    )
    const grammar = JSON.parse(fixture.worker.messages[2].grammar)
    expect(grammar).toContain("[unk]")
    expect(grammar).toContain("track")
    decoder.accept(new Float32Array([0, 0.5, -0.5]), 48000)
    expect(Array.from(fixture.worker.messages[4].data)).toEqual([
      0, 16384, -16384,
    ])
    expect(fixture.worker.messages[4].sampleRate).toBe(48000)
    fixture.worker.emit({
      event: "partialresult",
      result: { partial: "stop tracking" },
    })
    fixture.worker.emit({
      event: "result",
      result: {
        text: "track",
        result: [
          { word: "track", conf: 0.95, start: 0, end: 1 },
        ],
      },
    })
    expect(heard).toEqual(["track"])
    abort.abort()
    expect(fixture.worker.terminated).toBe(true)
    decoder.stop()
  } finally {
    abort.abort()
    fixture.restore()
  }
})

test("abort and failed model loading terminate the worker without leaving startup pending", async () => {
  const fixture = workerFixture()
  try {
    const abort = new AbortController()
    const loading = loadVoiceDecoder(abort.signal)
    abort.abort()
    await expect(loading).rejects.toMatchObject({ name: "AbortError" })
    expect(fixture.worker.terminated).toBe(true)
    const retry = loadVoiceDecoder(new AbortController().signal)
    fixture.worker.emit({ event: "load", result: false })
    await expect(retry).rejects.toThrow("unavailable")
    expect(fixture.worker.terminated).toBe(true)
  } finally {
    fixture.restore()
  }
})

test("nonempty rejected final speech gives feedback without executing partial or uncertain commands", async () => {
  const fixture = workerFixture()
  const abort = new AbortController()
  try {
    const loading = loadVoiceDecoder(abort.signal)
    fixture.worker.emit({ event: "load", result: true })
    const decoder = await loading
    const heard: string[] = []
    let rejected = 0
    decoder.listen(
      48000,
      (text) => heard.push(text),
      () => {},
      () => rejected++
    )
    fixture.worker.emit({
      event: "partialresult",
      result: { partial: "select" },
    })
    fixture.worker.emit({ event: "result", result: { text: "", result: [] } })
    expect(rejected).toBe(0)
    fixture.worker.emit({
      event: "result",
      result: {
        text: "select",
        result: [{ word: "select", conf: 0.3, start: 0, end: 1 }],
      },
    })
    fixture.worker.emit({
      event: "result",
      result: { text: "[unk]", result: [] },
    })
    expect(rejected).toBe(2)
    expect(heard).toEqual([])
    fixture.worker.emit({
      event: "result",
      result: {
        text: "select",
        result: [{ word: "select", conf: 0.95, start: 0, end: 1 }],
      },
    })
    expect(heard).toEqual(["select"])
    expect(rejected).toBe(2)
    decoder.stop()
    fixture.worker.emit({ event: "result", result: { text: "[unk]" } })
    expect(rejected).toBe(2)
  } finally {
    abort.abort()
    fixture.restore()
  }
})
