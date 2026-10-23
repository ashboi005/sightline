import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import {
  NetworkCamera,
  type NetworkCameraFrame,
  type NetworkConnectionState,
} from "../features/eye-tracking/network-camera"
if (typeof document === "undefined") GlobalRegistrator.register()

const originalFetch = globalThis.fetch,
  originalBitmap = globalThis.createImageBitmap
const originalTimeout = globalThis.setTimeout,
  originalClearTimeout = globalThis.clearTimeout
const originalInterval = globalThis.setInterval,
  originalClearInterval = globalThis.clearInterval
let now: number, clock: ReturnType<typeof spyOn>, camera: NetworkCamera
let status: NetworkConnectionState,
  latest: NetworkCameraFrame | null,
  errors: string[]
let timers: Map<number, { callback: () => void; delay: number }>,
  heartbeat: () => void
let streams: ReadableStreamDefaultController<Uint8Array>[],
  fetches: number,
  closed: number[]
const flush = () => new Promise<void>((resolve) => originalTimeout(resolve, 0))
function part(id: number) {
  const header = new TextEncoder().encode(
    "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 5\r\n\r\n"
  )
  return new Uint8Array([...header, 255, 216, id, 255, 217, 13, 10])
}
function bitmap(id: number) {
  return {
    width: 640,
    height: 480,
    id,
    close: () => closed.push(id),
  } as unknown as ImageBitmap
}
beforeEach(() => {
  now = 0
  fetches = 0
  closed = []
  streams = []
  timers = new Map()
  errors = []
  latest = null
  status = "idle"
  clock = spyOn(performance, "now").mockImplementation(() => now)
  let timerId = 0
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    const id = ++timerId
    timers.set(id, { callback, delay })
    return id
  }) as typeof setTimeout
  globalThis.clearTimeout = ((id: number) =>
    timers.delete(id)) as typeof clearTimeout
  globalThis.setInterval = ((callback: () => void) => {
    heartbeat = callback
    return 1
  }) as typeof setInterval
  globalThis.clearInterval = (() => {}) as typeof clearInterval
  globalThis.createImageBitmap = (async (blob: Blob) =>
    bitmap(
      new Uint8Array(await blob.arrayBuffer())[2]
    )) as typeof createImageBitmap
  globalThis.fetch = (async () => {
    fetches++
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streams.push(controller)
          controller.enqueue(part(fetches))
        },
      }),
      {
        headers: {
          "content-type": "multipart/x-mixed-replace; boundary=frame",
        },
      }
    )
  }) as typeof fetch
  camera = new NetworkCamera({
    onFrame: (value) => {
      latest = value
    },
    onStatus: (value) => {
      status = value
    },
    onError: (message) => errors.push(message),
  })
})
afterEach(() => {
  camera.stop()
  clock.mockRestore()
  globalThis.fetch = originalFetch
  globalThis.createImageBitmap = originalBitmap
  globalThis.setTimeout = originalTimeout
  globalThis.clearTimeout = originalClearTimeout
  globalThis.setInterval = originalInterval
  globalThis.clearInterval = originalClearInterval
})
test("a stalled MJPEG source pauses evidence, retries, and resumes without a fatal error", async () => {
  await camera.start("http://esp32.local/stream")
  expect(status).toBe("live")
  now = 2000
  heartbeat()
  expect(status).toBe("waiting")
  expect(latest).toBeNull()
  now = 9000
  heartbeat()
  expect(status).toBe("reconnecting")
  expect(closed).toEqual([1])
  const retry = [...timers.values()].find((timer) => timer.delay === 1000)!
  retry.callback()
  await flush()
  expect(fetches).toBe(2)
  expect(status).toBe("live")
  expect(latest).not.toBeNull()
  expect(errors).toEqual([])
})
test("reconnection immediately reports its cause without becoming a fatal error", async () => {
  const notices: { status: NetworkConnectionState; detail?: string }[] = []
  camera = new NetworkCamera({
    onFrame() {},
    onStatus: (status, _attempt, detail) => notices.push({ status, detail }),
    onError: (message) => errors.push(message),
  })
  await camera.start("http://esp32.local/stream")
  streams[0].error(new Error("Target camera stream ended"))
  await flush()
  expect(notices.at(-1)).toMatchObject({
    status: "reconnecting",
    detail: "Target camera stream ended",
  })
  expect(errors).toEqual([])
})
test("a damaged JPEG is dropped while later frames continue on the same connection", async () => {
  globalThis.createImageBitmap = (async (blob: Blob) => {
    const id = new Uint8Array(await blob.arrayBuffer())[2]
    if (id === 2) throw Error("Damaged JPEG")
    return bitmap(id)
  }) as typeof createImageBitmap
  await camera.start("http://esp32.local/stream")
  streams[0].enqueue(part(2))
  await flush()
  streams[0].enqueue(part(3))
  await flush()
  expect(status).toBe("live")
  expect(fetches).toBe(1)
  expect((latest?.image as unknown as { id: number }).id).toBe(3)
  expect(errors).toEqual([])
})
test("a damaged first JPEG does not abandon valid subsequent frames", async () => {
  globalThis.createImageBitmap = (async (blob: Blob) => {
    const id = new Uint8Array(await blob.arrayBuffer())[2]
    if (id === 1) throw Error("Truncated first JPEG")
    return bitmap(id)
  }) as typeof createImageBitmap
  const start = camera.start("http://esp32.local/stream")
  await flush()
  streams[0].enqueue(part(2))
  await start
  await flush()
  expect(status).toBe("live")
  expect(fetches).toBe(1)
  expect((latest?.image as unknown as { id: number }).id).toBe(2)
})
test("slow JPEG decoding keeps only the newest queued frame", async () => {
  let release!: (value: ImageBitmap) => void
  const decoded: number[] = []
  globalThis.createImageBitmap = (async (blob: Blob) => {
    const id = new Uint8Array(await blob.arrayBuffer())[2]
    decoded.push(id)
    if (id === 2)
      return new Promise<ImageBitmap>((resolve) => {
        release = resolve
      })
    return bitmap(id)
  }) as typeof createImageBitmap
  await camera.start("http://esp32.local/stream")
  streams[0].enqueue(part(2))
  await flush()
  streams[0].enqueue(part(3))
  streams[0].enqueue(part(4))
  await flush()
  release(bitmap(2))
  await flush()
  expect(decoded).toEqual([1, 2, 4])
  expect((latest?.image as unknown as { id: number }).id).toBe(4)
})
test("stopping cancels retries and closes a decode that finishes late", async () => {
  let release!: (value: ImageBitmap) => void
  globalThis.createImageBitmap = (() =>
    new Promise<ImageBitmap>((resolve) => {
      release = resolve
    })) as typeof createImageBitmap
  const start = camera.start("http://esp32.local/stream")
  await flush()
  camera.stop()
  release(bitmap(1))
  await start
  expect(status).toBe("idle")
  expect(latest).toBeNull()
  expect(closed).toEqual([1])
  expect(timers.size).toBe(0)
})
test("failed connections back off and disconnect cancels the next attempt", async () => {
  globalThis.fetch = (async () => {
    fetches++
    return Response.json({ error: "The camera is offline." }, { status: 502 })
  }) as typeof fetch
  await camera.start("http://esp32.local/stream")
  for (const delay of [1000, 2000, 4000]) {
    const retry = [...timers.entries()].find(
      ([, timer]) => timer.delay === delay
    )!
    expect(retry).toBeDefined()
    timers.delete(retry[0])
    retry[1].callback()
    await flush()
  }
  expect(fetches).toBe(4)
  expect(status).toBe("reconnecting")
  expect(errors).toEqual([])
  camera.stop()
  expect(timers.size).toBe(0)
})

test("a browser camera access failure releases the connection controls", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch")
  }) as typeof fetch

  await camera.start("http://esp32.local/stream")

  expect(status).toBe("error")
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatch(/browser.*camera.*CORS.*redirect/i)
  expect(latest).toBeNull()
  expect(timers.size).toBe(0)
})

test("a working camera retries temporary browser fetch failures after a stream drop", async () => {
  const workingFetch = globalThis.fetch
  await camera.start("http://esp32.local/stream")
  expect(status).toBe("live")

  let failNextRequest = true
  globalThis.fetch = (async (...argumentsList) => {
    if (String(argumentsList[0]) === "/api/camera-stream") {
      throw new TypeError("Local helper temporarily unavailable")
    }
    if (failNextRequest) {
      failNextRequest = false
      fetches++
      throw new TypeError("Failed to fetch")
    }
    return workingFetch(...argumentsList)
  }) as typeof fetch
  streams[0].error(new Error("The camera connection dropped."))
  await flush()

  for (const delay of [1000, 2000]) {
    expect(status).toBe("reconnecting")
    expect(errors).toEqual([])
    const retry = [...timers.entries()].find(
      ([, timer]) => timer.delay === delay
    )!
    expect(retry).toBeDefined()
    timers.delete(retry[0])
    retry[1].callback()
    await flush()
  }

  expect(fetches).toBe(3)
  expect(status).toBe("live")
  expect(latest).not.toBeNull()
  expect(errors).toEqual([])
})

test("ESP32 recovery reuses the successful direct endpoint instead of the blocked redirect", async () => {
  const workingFetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = (async (input, options) => {
    const url = String(input)
    requests.push(url)
    if (url === "http://esp32.local/stream") {
      throw new TypeError("Redirect blocked by CORS")
    }
    if (url === "http://esp32.local:81/stream") {
      return workingFetch(input, options)
    }
    throw new Error("Unexpected camera destination")
  }) as typeof fetch

  await camera.start("http://esp32.local/stream")
  expect(status).toBe("live")
  streams[0].error(new Error("Connection dropped"))
  await flush()
  const retry = [...timers.entries()].find(([, timer]) => timer.delay === 1000)!
  expect(retry).toBeDefined()
  timers.delete(retry[0])
  retry[1].callback()
  await flush()

  expect(status).toBe("live")
  expect(requests).toEqual([
    "http://esp32.local/stream",
    "http://esp32.local:81/stream",
    "http://esp32.local:81/stream",
  ])
  expect(errors).toEqual([])
})

test("persistent camera failures stop retrying and retain the actual error", async () => {
  globalThis.fetch = (async () => {
    fetches++
    return Response.json(
      {
        error: "Camera stream unavailable.",
      },
      { status: 502 }
    )
  }) as typeof fetch

  await camera.start("http://esp32.local/stream")
  for (const delay of [1000, 2000, 4000, 8000]) {
    const retry = [...timers.entries()].find(
      ([, timer]) => timer.delay === delay
    )!
    expect(retry).toBeDefined()
    timers.delete(retry[0])
    retry[1].callback()
    await flush()
  }

  expect(fetches).toBe(5)
  expect(status).toBe("error")
  expect(errors).toEqual(["Camera stream unavailable."])
  expect(timers.size).toBe(0)
})

test("a CORS-blocked camera reconnects using its successful local relay", async () => {
  const workingFetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = (async (input, options) => {
    requests.push(String(input))
    if (String(input) !== "/api/camera-stream") {
      throw new TypeError("Camera does not allow CORS")
    }
    return workingFetch(input, options)
  }) as typeof fetch
  await camera.start("http://esp32.local/stream")
  expect(status).toBe("live")
  streams[0].error(new Error("Camera dropped"))
  await flush()
  const retry = [...timers.entries()].find(([, timer]) => timer.delay === 1000)!
  timers.delete(retry[0])
  retry[1].callback()
  await flush()
  expect(status).toBe("live")
  expect(requests).toEqual([
    "http://esp32.local/stream",
    "http://esp32.local:81/stream",
    "/api/camera-stream",
    "/api/camera-stream",
  ])
  expect(errors).toEqual([])
  camera.stop()
  await flush()
  expect(timers.size).toBe(0)
  expect(status).toBe("idle")
})
