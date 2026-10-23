import { expect, test, spyOn } from "bun:test"
import { proxyCameraStream } from "../features/eye-tracking/camera-stream-server"
const origin = "http://127.0.0.1:4016"
const camera = "http://esp32.local/stream"
function request(url = camera, caller = origin) {
  const value = new Request(origin + "/api/camera-stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "private-cookie",
      Authorization: "Bearer private-token",
    },
    body: JSON.stringify({ url }),
  })
  // Happy DOM strips Origin during construction; a server receives this browser header.
  value.headers.set("Origin", caller)
  return value
}
const mjpeg = () =>
  new Response(
    "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 5\r\n\r\nJPEG1\r\n--frame--\r\n",
    { headers: { "Content-Type": "multipart/x-mixed-replace;boundary=frame" } }
  )
test("a reverse-proxied deployment uses its configured public HTTPS origin", async () => {
  const response = await proxyCameraStream(
    request(camera, "https://sightline.example"),
    {
      appOrigin: "https://sightline.example",
      resolve: async () => ["192.168.1.2"],
      fetch: async () => mjpeg(),
    }
  )
  expect(response.status).toBe(200)
  await response.body?.cancel()
})
test("local bridge follows the ESP redirect without CORS and pins the same camera IP", async () => {
  const urls: string[] = []
  const options: RequestInit[] = []
  const response = await proxyCameraStream(request(), {
    resolve: async () => ["192.168.168.180"],
    fetch: async (input, init) => {
      urls.push(String(input))
      options.push(init!)
      return urls.length === 1
        ? new Response(null, {
            status: 307,
            headers: { Location: "http://192.168.168.180:81/stream" },
          })
        : mjpeg()
    },
  })
  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toContain(
    "multipart/x-mixed-replace"
  )
  expect(await response.text()).toContain("JPEG1")
  expect(urls).toEqual([
    "http://192.168.168.180/stream",
    "http://192.168.168.180:81/stream",
  ])
  const headers = new Headers(options[0].headers)
  expect(headers.get("cookie")).toBeNull()
  expect(headers.get("authorization")).toBeNull()
  expect(headers.get("host")).toBe("esp32.local")
  expect(options[0].redirect).toBe("manual")
})
test.each([
  "http://example.com/stream",
  "http://127.0.0.1/stream",
  "http://user:password@esp32.local/stream",
  "file:///private/data",
])("bridge rejects unsupported destination %s", async (url) => {
  let contacted = false
  const response = await proxyCameraStream(request(url), {
    resolve: async () => ["192.168.1.2"],
    fetch: async () => {
      contacted = true
      return mjpeg()
    },
  })
  expect(response.status).toBe(400)
  expect(contacted).toBe(false)
})
test("cross-origin callers cannot use the local bridge", async () => {
  let contacted = false
  const response = await proxyCameraStream(
    request(camera, "https://unrelated.example"),
    {
      fetch: async () => {
        contacted = true
        return mjpeg()
      },
    }
  )
  expect(response.status).toBe(403)
  expect(contacted).toBe(false)
})
test("a local hostname resolving publicly cannot initiate a fetch", async () => {
  let contacted = false
  const response = await proxyCameraStream(request(), {
    resolve: async () => ["8.8.8.8"],
    fetch: async () => {
      contacted = true
      return mjpeg()
    },
  })
  expect(response.status).toBe(502)
  expect(contacted).toBe(false)
})
test("redirects cannot leave the originally resolved camera", async () => {
  const urls: string[] = []
  const response = await proxyCameraStream(request(), {
    resolve: async () => ["192.168.1.2"],
    fetch: async (input) => {
      urls.push(String(input))
      return new Response(null, {
        status: 307,
        headers: { Location: "http://192.168.1.3/admin" },
      })
    },
  })
  expect(response.status).toBe(502)
  expect(urls).toHaveLength(1)
})
test("hostname failures give a reachability error instead of blaming CORS", async () => {
  const response = await proxyCameraStream(request(), {
    resolve: async () => {
      throw new Error("lookup failed")
    },
  })
  expect(response.status).toBe(502)
  expect((await response.json()).error).toMatch(/hostname.*resolve/i)
})
test("a stalled hostname lookup fails promptly with the IP-address remedy", async () => {
  const realTimeout = globalThis.setTimeout
  let expire: (() => void) | undefined
  const timeout = spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: () => void,
    delay?: number
  ) => {
    if (delay === 2000) expire = callback
    return realTimeout(callback, delay)
  }) as typeof setTimeout)
  const abort = new AbortController()
  const incoming = new Request(request(), { signal: abort.signal })
  incoming.headers.set("Origin", origin)
  let started!: () => void
  const lookupStarted = new Promise<void>((resolve) => {
    started = resolve
  })
  let contacted = false
  const pending = proxyCameraStream(incoming, {
    resolve: () => {
      started()
      return new Promise(() => {})
    },
    fetch: async () => {
      contacted = true
      return mjpeg()
    },
  })
  try {
    await lookupStarted
    expect(expire).toBeFunction()
    expire!()
    const response = await pending
    expect(response.status).toBe(502)
    expect((await response.json()).error).toMatch(/hostname.*IP address/i)
    expect(contacted).toBe(false)
  } finally {
    abort.abort()
    await pending
    timeout.mockRestore()
  }
})
test("a short busy response from the closing direct stream can recover", async () => {
  let calls = 0
  const response = await proxyCameraStream(
    request("http://192.168.1.2:81/stream"),
    {
      fetch: async () =>
        ++calls === 1 ? new Response(null, { status: 503 }) : mjpeg(),
    }
  )
  expect(response.status).toBe(200)
  expect(calls).toBe(2)
  await response.body?.cancel()
})
test("canceling the relay body releases the camera stream", async () => {
  let canceled = false
  const body = new ReadableStream({
    cancel() {
      canceled = true
    },
  })
  const response = await proxyCameraStream(
    request("http://192.168.1.2:81/stream"),
    {
      fetch: async () =>
        new Response(body, {
          headers: {
            "Content-Type": "multipart/x-mixed-replace;boundary=frame",
          },
        }),
    }
  )
  await response.body?.cancel()
  expect(canceled).toBe(true)
})
test("large request bodies and non-media camera replies are rejected", async () => {
  const oversized = new Request(origin + "/api/camera-stream", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ url: camera, padding: "x".repeat(5000) }),
  })
  oversized.headers.set("Origin", origin)
  expect((await proxyCameraStream(oversized)).status).toBe(413)
  const response = await proxyCameraStream(
    request("http://192.168.1.2/stream"),
    {
      fetch: async () =>
        new Response("camera setup", {
          headers: { "Content-Type": "text/html" },
        }),
    }
  )
  expect(response.status).toBe(415)
})

test.each(["http://192.168.1.10:3001", "https://sightline.example"])(
  "authenticated same-origin deployments can relay from %s",
  async (appOrigin) => {
    const incoming = new Request(appOrigin + "/api/camera-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://192.168.1.2/stream" }),
    })
    incoming.headers.set("Origin", appOrigin)
    const response = await proxyCameraStream(incoming, {
      fetch: async () => mjpeg(),
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain("JPEG1")
  }
)
test("canceling during hostname lookup cannot start a late camera request", async () => {
  const controller = new AbortController()
  const incoming = new Request(origin + "/api/camera-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: camera }),
    signal: controller.signal,
  })
  incoming.headers.set("Origin", origin)
  let resolveLookup!: (addresses: string[]) => void
  let contacted = false
  const pending = proxyCameraStream(incoming, {
    resolve: () =>
      new Promise((resolve) => {
        resolveLookup = resolve
      }),
    fetch: async () => {
      contacted = true
      return mjpeg()
    },
  })
  while (!resolveLookup) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  controller.abort()
  expect((await pending).status).toBe(499)
  resolveLookup(["192.168.1.2"])
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(contacted).toBe(false)
})

test("an interrupted JSON body is canceled without waiting for another chunk", async () => {
  const abort = new AbortController()
  let canceled = false
  let bodyController!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      bodyController = controller
      controller.enqueue(new TextEncoder().encode("{"))
    },
    cancel() {
      canceled = true
    },
  })
  const incoming = new Request(origin + "/api/camera-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: abort.signal,
  })
  incoming.headers.set("Origin", origin)
  let contacted = false
  const pending = proxyCameraStream(incoming, {
    fetch: async () => {
      contacted = true
      return mjpeg()
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  abort.abort()
  const result = await Promise.race([
    pending,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
  ])
  if (!canceled) {
    bodyController.error(new Error("Test cleanup"))
  }
  await pending
  expect(result?.status).toBe(499)
  expect(canceled).toBe(true)
  expect(contacted).toBe(false)
})

test("the connection deadline also closes a stalled JSON request body", async () => {
  const realTimeout = globalThis.setTimeout
  let expire!: () => void
  const timeout = spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: () => void,
    delay?: number
  ) => {
    if (delay === 10000) {
      expire = callback
      return realTimeout(() => {}, 10000)
    }
    return realTimeout(callback, delay)
  }) as typeof setTimeout)
  let canceled = false
  const incoming = new Request(origin + "/api/camera-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream({
      cancel() {
        canceled = true
      },
    }),
  })
  incoming.headers.set("Origin", origin)
  try {
    const pending = proxyCameraStream(incoming)
    expire()
    expect((await pending).status).toBe(504)
    expect(canceled).toBe(true)
  } finally {
    timeout.mockRestore()
  }
})

test("disconnecting the relay aborts the owning camera fetch, not just its reader", async () => {
  let cameraSignal!: AbortSignal
  const response = await proxyCameraStream(
    request("http://192.168.1.2:81/stream"),
    {
      fetch: async (_, options) => {
        cameraSignal = options!.signal!
        return new Response(new ReadableStream(), {
          headers: {
            "Content-Type": "multipart/x-mixed-replace;boundary=frame",
          },
        })
      },
    }
  )
  expect(cameraSignal.aborted).toBe(false)
  await response.body?.cancel()
  expect(cameraSignal.aborted).toBe(true)
})

test("an upstream stream error releases its reader and aborts its fetch", async () => {
  let upstream!: ReadableStreamDefaultController<Uint8Array>
  let cameraSignal!: AbortSignal
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      upstream = controller
    },
  })
  const response = await proxyCameraStream(
    request("http://192.168.1.2/stream"),
    {
      fetch: async (_, options) => {
        cameraSignal = options!.signal!
        return new Response(body, {
          headers: {
            "Content-Type": "multipart/x-mixed-replace;boundary=frame",
          },
        })
      },
    }
  )
  const reader = response.body!.getReader()
  const pending = reader.read()
  upstream.error(new Error("Camera dropped"))
  await expect(pending).rejects.toThrow("Camera dropped")
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(cameraSignal.aborted).toBe(true)
  expect(body.locked).toBe(false)
  reader.releaseLock()
})
