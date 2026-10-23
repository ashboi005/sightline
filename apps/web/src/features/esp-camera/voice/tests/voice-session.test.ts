import { expect, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { LocalVoiceController } from "../local-voice"
if (typeof document === "undefined") GlobalRegistrator.register()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await Promise.resolve()
  }
  throw new Error("Boundary not reached")
}
function platform(
  options: { deferResume?: boolean; deferMicrophone?: boolean } = {}
) {
  const originals = new Map<string, PropertyDescriptor | undefined>()
  let microphoneRequests = 0
  let worker: any = null
  let workletRequested = false
  let closed = false
  const resume = deferred<void>()
  const permission = deferred<any>()
  const worklet = deferred<void>()
  class Track extends EventTarget {
    readyState = "live"
    stopped = false
    stop() {
      this.stopped = true
      this.readyState = "ended"
    }
    end() {
      this.readyState = "ended"
      this.dispatchEvent(new Event("ended"))
    }
  }
  const track = new Track()
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
  class Context {
    sampleRate = 48000
    destination = {}
    audioWorklet = {
      addModule: async () => {
        workletRequested = true
        await worklet.promise
      },
    }
    async resume() {
      if (options.deferResume) await resume.promise
    }
    async close() {
      closed = true
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} }
    }
  }
  class Worker {
    terminated = false
    onmessage: any
    onerror: any
    constructor() {
      worker = this
    }
    postMessage() {}
    terminate() {
      this.terminated = true
    }
    load() {
      this.onmessage({ data: { event: "load", result: true } })
    }
  }
  class WorkletNode {
    port = { onmessage: null, close() {} }
    connect() {}
    disconnect() {}
  }
  for (const [name, value] of Object.entries({
    AudioContext: Context,
    AudioWorkletNode: WorkletNode,
    Worker,
    location: { origin: "http://localhost" },
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value })
  }
  const media = Object.getOwnPropertyDescriptor(navigator, "mediaDevices")
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      async getUserMedia() {
        microphoneRequests++
        return options.deferMicrophone ? permission.promise : stream
      },
    },
  })
  return {
    track,
    stream,
    worklet,
    resume,
    permission,
    get worker() {
      return worker
    },
    get workletRequested() {
      return workletRequested
    },
    get closed() {
      return closed
    },
    get microphoneRequests() {
      return microphoneRequests
    },
    restore() {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
      if (media) Object.defineProperty(navigator, "mediaDevices", media)
      else Reflect.deleteProperty(navigator, "mediaDevices")
    },
  }
}

test("worker failure while the AudioWorklet loads releases the microphone and cannot become listening", async () => {
  const fixture = platform()
  const voice = new LocalVoiceController()
  try {
    const starting = voice.start(() => {})
    await until(() => !!fixture.worker)
    fixture.worker.load()
    await until(() => fixture.workletRequested)
    fixture.worker.onerror()
    expect(voice.getSnapshot().status).toBe("error")
    expect(fixture.track.stopped).toBe(true)
    expect(fixture.closed).toBe(true)
    fixture.worklet.resolve()
    await starting
    expect(voice.getSnapshot().status).toBe("error")
  } finally {
    voice.dispose()
    fixture.restore()
  }
})

test("microphone disconnection during model loading cancels the worker and reports failure", async () => {
  const fixture = platform()
  const voice = new LocalVoiceController()
  try {
    const starting = voice.start(() => {})
    await until(() => !!fixture.worker)
    fixture.track.end()
    await starting
    expect(voice.getSnapshot().status).toBe("error")
    expect(fixture.worker.terminated).toBe(true)
    expect(fixture.closed).toBe(true)
    expect(fixture.workletRequested).toBe(false)
  } finally {
    voice.dispose()
    fixture.restore()
  }
})

test("stop during audio activation prevents a late microphone permission request", async () => {
  const fixture = platform({ deferResume: true })
  const voice = new LocalVoiceController()
  try {
    const starting = voice.start(() => {})
    voice.stop()
    fixture.resume.resolve()
    await starting
    expect(fixture.microphoneRequests).toBe(0)
    expect(voice.getSnapshot().status).toBe("idle")
    expect(fixture.closed).toBe(true)
  } finally {
    voice.dispose()
    fixture.restore()
  }
})

test("stop during permission request releases the late stream without loading the model", async () => {
  const fixture = platform({ deferMicrophone: true })
  const voice = new LocalVoiceController()
  try {
    const starting = voice.start(() => {})
    await until(() => fixture.microphoneRequests > 0)
    voice.stop()
    fixture.permission.resolve(fixture.stream)
    await starting
    expect(fixture.track.stopped).toBe(true)
    expect(fixture.worker).toBeNull()
    expect(voice.getSnapshot().status).toBe("idle")
  } finally {
    voice.dispose()
    fixture.restore()
  }
})

test("final voice results travel through the session to command and rejection feedback", async () => {
  const fixture = platform()
  const voice = new LocalVoiceController()
  const heard: string[] = []
  try {
    const starting = voice.start((text) => heard.push(text))
    await until(() => !!fixture.worker)
    fixture.worker.load()
    await until(() => fixture.workletRequested)
    fixture.worklet.resolve()
    await starting
    fixture.worker.onmessage({
      data: {
        event: "result",
        result: {
          text: "select",
          result: [{ word: "select", conf: 0.95, start: 0, end: 1 }],
        },
      },
    })
    expect(heard).toEqual(["select"])
    expect(voice.getSnapshot().message).toBe("Heard: select")
    fixture.worker.onmessage({
      data: { event: "result", result: { text: "[unk]" } },
    })
    expect(voice.getSnapshot().message).toContain("not understood")
    expect(heard).toEqual(["select"])
  } finally {
    voice.dispose()
    fixture.restore()
  }
})
