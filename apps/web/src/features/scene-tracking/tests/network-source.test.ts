import { afterEach, expect, spyOn, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { openNetworkSource } from "../features/eye-tracking/network-source"

if (typeof document === "undefined") GlobalRegistrator.register()

const originalFetch = globalThis.fetch
const originalVideoPlay = HTMLVideoElement.prototype.play
const originalVideoWidth = Object.getOwnPropertyDescriptor(
  HTMLVideoElement.prototype,
  "videoWidth"
)
const originalVideoHeight = Object.getOwnPropertyDescriptor(
  HTMLVideoElement.prototype,
  "videoHeight"
)

afterEach(() => {
  globalThis.fetch = originalFetch
  HTMLVideoElement.prototype.play = originalVideoPlay
  restoreVideoDimension("videoWidth", originalVideoWidth)
  restoreVideoDimension("videoHeight", originalVideoHeight)
})

function restoreVideoDimension(
  name: "videoWidth" | "videoHeight",
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) {
    Object.defineProperty(HTMLVideoElement.prototype, name, descriptor)
    return
  }

  delete (HTMLVideoElement.prototype as any)[name]
}

function createMjpegResponse() {
  const content =
    "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 5\r\n\r\nJPEG1\r\n--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 5\r\n\r\nJPEG2\r\n"
  const bytes = new TextEncoder().encode(content)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 9) {
        controller.enqueue(bytes.slice(offset, offset + 9))
      }
      controller.close()
    },
  })

  return new Response(body, {
    headers: {
      "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    },
  })
}

test("opens an mDNS MJPEG camera directly in the browser and follows its redirects", async () => {
  let requestedUrl = ""
  let requestOptions: RequestInit | undefined
  globalThis.fetch = async (input, options) => {
    requestedUrl = String(input)
    requestOptions = options
    return createMjpegResponse()
  }

  const source = await openNetworkSource(
    "http://esp32.local/stream",
    new AbortController().signal
  )

  expect(requestedUrl).toBe("http://esp32.local/stream")
  expect(requestOptions?.mode).toBe("cors")
  expect(requestOptions?.credentials).toBe("omit")
  expect(requestOptions?.redirect).toBe("follow")
  expect(source.kind).toBe("mjpeg")
  expect(source.streamUrl).toBe("http://esp32.local/stream")
  if (source.kind !== "mjpeg") throw new Error("Expected an MJPEG source")
  expect(new TextDecoder().decode(source.firstFrame)).toBe("JPEG1")

  const remainingFrames: string[] = []
  for await (const frame of source.frames) {
    remainingFrames.push(new TextDecoder().decode(frame))
  }
  expect(remainingFrames).toEqual(["JPEG2"])
})

test("a browser access failure explains camera permissions without another service", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch")
  }

  await expect(
    openNetworkSource("http://esp32.local/stream", new AbortController().signal)
  ).rejects.toThrow(/browser.*camera.*CORS.*redirect/i)
})

test.each([
  [
    "http://esp32.local/stream?fps=20",
    "http://esp32.local:81/stream?fps=20",
    "esp32.local",
  ],
  [
    "http://192.168.1.11/stream",
    "http://192.168.1.11:81/stream",
    "192.168.1.11",
  ],
])(
  "a blocked local ESP32 stream connects directly on port 81: %s",
  async (input, directUrl, hostname) => {
    const requests: string[] = []
    globalThis.fetch = async (requestedUrl) => {
      const url = String(requestedUrl)
      requests.push(url)
      if (url === input) {
        throw new TypeError("Redirect blocked by CORS")
      }
      if (url === directUrl) {
        return createMjpegResponse()
      }
      throw new Error("Unexpected camera destination")
    }

    const source = await openNetworkSource(input, new AbortController().signal)

    expect(requests).toEqual([input, directUrl])
    expect(source.kind).toBe("mjpeg")
    expect(source.name).toBe(hostname)
    expect(source.streamUrl).toBe(directUrl)
    if (source.kind !== "mjpeg") {
      throw new Error("Expected a readable MJPEG stream")
    }
    expect(new TextDecoder().decode(source.firstFrame)).toBe("JPEG1")
    await source.frames.return(undefined)
  }
)

test.each([
  "http://esp32.local:8080/stream",
  "http://esp32.local:81/stream",
  "http://esp32.local/video.mp4",
  "https://esp32.local/stream",
  "http://camera.example/stream",
])(
  "a blocked custom camera URL does not probe another port: %s",
  async (input) => {
    const requests: string[] = []
    globalThis.fetch = async (requestedUrl) => {
      requests.push(String(requestedUrl))
      throw new TypeError("Failed to fetch")
    }

    await expect(
      openNetworkSource(input, new AbortController().signal)
    ).rejects.toThrow(/browser.*camera/i)
    expect(requests).toEqual(
      input.startsWith("http://esp32.local")
        ? [input, "/api/camera-stream"]
        : [input]
    )
  }
)

test("an aborted ESP32 connection never starts the port 81 fallback", async () => {
  const controller = new AbortController()
  const requests: string[] = []
  globalThis.fetch = async (requestedUrl) => {
    requests.push(String(requestedUrl))
    controller.abort()
    throw new TypeError("Failed to fetch")
  }

  await expect(
    openNetworkSource("http://esp32.local/stream", controller.signal)
  ).rejects.toMatchObject({ name: "AbortError" })
  expect(requests).toEqual(["http://esp32.local/stream"])
})

test("rejects non-HTTP network source URLs before fetching", async () => {
  let requested = false
  globalThis.fetch = async () => {
    requested = true
    return new Response()
  }

  await expect(
    openNetworkSource("file:///tmp/eye.mjpeg", new AbortController().signal)
  ).rejects.toThrow(/HTTP or HTTPS/i)
  expect(requested).toBe(false)
})

test("rejects embedded camera credentials before making a request", async () => {
  let requested = false
  globalThis.fetch = async () => {
    requested = true
    return new Response()
  }

  await expect(
    openNetworkSource(
      "http://user:password@esp32.local/stream",
      new AbortController().signal
    )
  ).rejects.toThrow("without embedded login credentials")
  expect(requested).toBe(false)
})

test("reports HTTP errors from the camera directly", async () => {
  globalThis.fetch = async () => new Response("unavailable", { status: 503 })

  await expect(
    openNetworkSource(
      "http://camera.example/stream",
      new AbortController().signal
    )
  ).rejects.toThrow("The camera returned HTTP 503")
})

test("shows the camera's HTTP error detail", async () => {
  globalThis.fetch = async () =>
    Response.json(
      {
        error: "The camera is busy. Close its other stream connection.",
      },
      { status: 502 }
    )

  await expect(
    openNetworkSource("http://esp32.local/stream", new AbortController().signal)
  ).rejects.toThrow("The camera is busy")
})

test("rejects MJPEG responses that do not declare a boundary", async () => {
  globalThis.fetch = async () =>
    new Response("", {
      headers: { "Content-Type": "multipart/x-mixed-replace" },
    })

  await expect(
    openNetworkSource(
      "http://camera.example/stream",
      new AbortController().signal
    )
  ).rejects.toThrow("invalid MJPEG boundary")
})

test("opens browser-playable network video after checking its response type", async () => {
  globalThis.fetch = async () =>
    new Response("video", {
      headers: { "Content-Type": "video/mp4" },
    })
  HTMLVideoElement.prototype.play = async () => {}
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    configurable: true,
    get: () => 640,
  })
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    configurable: true,
    get: () => 360,
  })

  const source = await openNetworkSource(
    "https://camera.example/eye.mp4",
    new AbortController().signal
  )

  expect(source.kind).toBe("video")
  if (source.kind !== "video") throw new Error("Expected a video source")
  expect(source.video.crossOrigin).toBe("anonymous")
  expect(source.video.getAttribute("src")).toBe(
    "https://camera.example/eye.mp4"
  )
  expect(source.video.videoWidth).toBe(640)
  source.video.pause()
})

test("IP video uses the final URL after a camera redirect", async () => {
  globalThis.fetch = async () => {
    const response = new Response("video", {
      headers: { "Content-Type": "video/mp4" },
    })
    Object.defineProperty(response, "url", {
      value: "http://192.168.1.11:81/video.mp4",
    })
    return response
  }
  HTMLVideoElement.prototype.play = async () => {}
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    configurable: true,
    get: () => 640,
  })
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    configurable: true,
    get: () => 360,
  })
  const source = await openNetworkSource(
    "http://esp32.local/video",
    new AbortController().signal
  )
  expect(source.kind).toBe("video")
  if (source.kind !== "video") throw new Error("Expected a video")
  expect(source.video.getAttribute("src")).toBe(
    "http://192.168.1.11:81/video.mp4"
  )
  source.video.pause()
})

test("reports when the browser cannot decode a network video", async () => {
  globalThis.fetch = async () =>
    new Response("video", {
      headers: { "Content-Type": "video/mp4" },
    })
  HTMLVideoElement.prototype.play = async () => {
    throw new Error("Unsupported video source")
  }

  await expect(
    openNetworkSource(
      "https://camera.example/eye.mp4",
      new AbortController().signal
    )
  ).rejects.toThrow(/could not play.*network video/i)
})
test("aborting video startup cancels an unresolved play and releases its URL", async () => {
  globalThis.fetch = async () =>
    new Response("video", { headers: { "Content-Type": "video/mp4" } })
  let video!: HTMLVideoElement, releasePlay!: () => void
  const controller = new AbortController()
  HTMLVideoElement.prototype.play = function () {
    video = this
    return new Promise<void>((resolve) => {
      releasePlay = resolve
    })
  }
  const pending = openNetworkSource(
    "http://camera.local/stream.mp4",
    controller.signal
  ).then(
    (value) => {
      if (value.kind === "video") {
        value.video.pause()
        value.video.removeAttribute("src")
      }
      return "resolved"
    },
    (error) => error.name
  )
  try {
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()
    const outcome = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve("hung"), 20)),
    ])
    expect(outcome).toBe("AbortError")
    expect(video.getAttribute("src")).toBeNull()
  } finally {
    releasePlay()
    await pending
  }
})

test("aborting an MJPEG source releases the pending response reader", async () => {
  let cancelled = false
  const controller = new AbortController()
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true
    },
  })
  globalThis.fetch = async () =>
    new Response(body, {
      headers: {
        "Content-Type": "multipart/x-mixed-replace; boundary=frame",
      },
    })

  const pendingSource = openNetworkSource(
    "http://camera.example/stream",
    controller.signal
  )
  await Promise.resolve()
  await Promise.resolve()
  controller.abort()

  await expect(pendingSource).rejects.toMatchObject({ name: "AbortError" })
  expect(cancelled).toBe(true)
})

test("an ESP stream without CORS uses the same-origin helper and keeps the entered URL", async () => {
  const requests: { url: string; options?: RequestInit }[] = []
  globalThis.fetch = async (input, options) => {
    requests.push({ url: String(input), options })
    if (String(input) === "/api/camera-stream") return createMjpegResponse()
    throw new TypeError("No CORS headers")
  }
  const source = await openNetworkSource(
    "http://esp32.local/stream",
    new AbortController().signal
  )
  expect(requests.map((x) => x.url)).toEqual([
    "http://esp32.local/stream",
    "http://esp32.local:81/stream",
    "/api/camera-stream",
  ])
  expect(requests.at(-1)!.options?.body).toBe(
    '{"url":"http://esp32.local/stream"}'
  )
  expect(requests.at(-1)!.options?.credentials).toBe("same-origin")
  expect(source.streamUrl).toBe("http://esp32.local/stream")
  expect(source.localRelay).toBe(true)
  if (source.kind !== "mjpeg") throw new Error("Expected MJPEG")
  expect(new TextDecoder().decode(source.firstFrame)).toBe("JPEG1")
  await source.frames.return(undefined)
})
test("a relay reconnect avoids starting another rejected direct connection", async () => {
  const requests: string[] = []
  globalThis.fetch = async (input) => {
    requests.push(String(input))
    return createMjpegResponse()
  }
  const source = await openNetworkSource(
    "http://esp32.local/stream",
    new AbortController().signal,
    false,
    true
  )
  expect(requests).toEqual(["/api/camera-stream"])
  if (source.kind === "mjpeg") await source.frames.return(undefined)
})

test("a hanging local browser request reaches the relay before the camera deadline", async () => {
  const realTimeout = globalThis.setTimeout
  let expire!: () => void
  const timeout = spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: () => void,
    delay?: number
  ) => {
    if (delay === 2000) {
      expire = callback
      return realTimeout(() => {}, 2000)
    }
    return realTimeout(callback, delay)
  }) as typeof setTimeout)
  const requests: string[] = []
  globalThis.fetch = async (input, options) => {
    requests.push(String(input))
    if (String(input) === "/api/camera-stream") {
      return createMjpegResponse()
    }
    return new Promise((_, reject) =>
      options?.signal?.addEventListener(
        "abort",
        () => reject(options.signal?.reason),
        { once: true }
      )
    )
  }
  try {
    const pending = openNetworkSource(
      "http://esp32.local/stream",
      new AbortController().signal
    )
    expect(expire).toBeDefined()
    expire()
    const source = await pending
    expect(source.localRelay).toBe(true)
    expect(requests).toEqual([
      "http://esp32.local/stream",
      "/api/camera-stream",
    ])
    if (source.kind === "mjpeg") {
      await source.frames.return(undefined)
    }
  } finally {
    timeout.mockRestore()
  }
})

test("relay handoff aborts rejected browser requests without stopping the relay", async () => {
  const directSignals: AbortSignal[] = []
  const owner = new AbortController()
  globalThis.fetch = async (input, options) => {
    if (String(input) === "/api/camera-stream") {
      expect(options!.signal!.aborted).toBe(false)
      return createMjpegResponse()
    }
    directSignals.push(options!.signal!)
    throw new TypeError("CORS denied")
  }
  const source = await openNetworkSource(
    "http://esp32.local/stream",
    owner.signal
  )
  expect(directSignals).toHaveLength(2)
  expect(directSignals.every((signal) => signal.aborted)).toBe(true)
  expect(owner.signal.aborted).toBe(false)
  if (source.kind === "mjpeg") {
    await source.frames.return(undefined)
  }
})
