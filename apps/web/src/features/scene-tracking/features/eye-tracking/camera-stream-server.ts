import { lookup } from "node:dns/promises"
import { getMjpegBoundary } from "./mjpeg"
import {
  isLocalCameraHost,
  isPrivateCameraAddress,
} from "./local-camera-address"
import type { CameraStreamDependencies } from "./camera-stream-server.types"
const MAX_BODY = 4096
const MAX_REDIRECTS = 5
const HEADER_TIMEOUT = 10000
const DNS_TIMEOUT = 2000
const REDIRECTS = new Set([301, 302, 303, 307, 308])
const failure = (message: string, status: number) =>
  Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  )
function cameraUrl(input: string): URL | null {
  try {
    const url = new URL(input)
    if (
      input.length > 2048 ||
      url.protocol !== "http:" ||
      url.username ||
      url.password ||
      !isLocalCameraHost(url.hostname)
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}
async function resolveCamera(
  url: URL,
  dependencies: CameraStreamDependencies
): Promise<string> {
  if (isPrivateCameraAddress(url.hostname)) {
    return url.hostname
  }
  let addresses: string[]
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    addresses = await Promise.race([
      (
        dependencies.resolve ??
        (async (hostname) =>
          (await lookup(hostname, { all: true, family: 4 })).map(
            (result) => result.address
          ))
      )(url.hostname),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Camera hostname lookup timed out.")),
          DNS_TIMEOUT
        )
      }),
    ])
  } catch {
    throw new Error(
      "The camera hostname could not be resolved. Check its Wi-Fi connection or use its current LAN IP address."
    )
  } finally {
    clearTimeout(timeout)
  }
  if (
    !addresses.length ||
    addresses.some((address) => !isPrivateCameraAddress(address))
  ) {
    throw new Error(
      "The camera hostname did not resolve to a private LAN address."
    )
  }
  return addresses[0]
}
async function readCameraUrl(
  request: Request,
  signal: AbortSignal
): Promise<string | Response> {
  const size = Number(request.headers.get("content-length") ?? 0)
  if (!Number.isFinite(size) || size < 0 || size > MAX_BODY) {
    return failure("Camera request is too large.", 413)
  }
  const reader = request.body?.getReader()
  if (!reader) {
    return failure("Enter a camera stream URL.", 400)
  }
  const onAbort = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener("abort", onAbort, { once: true })
  if (signal.aborted) {
    onAbort()
  }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const result = await reader.read()
      signal.throwIfAborted()
      if (result.done) {
        break
      }
      total += result.value.byteLength
      if (total > MAX_BODY) {
        await reader.cancel()
        return failure("Camera request is too large.", 413)
      }
      chunks.push(result.value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !("url" in body) ||
      typeof body.url !== "string"
    ) {
      return failure("Enter a camera stream URL.", 400)
    }
    return body.url
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    return failure("Invalid camera request.", 400)
  } finally {
    signal.removeEventListener("abort", onAbort)
    reader.releaseLock()
  }
}
// Own the upstream fetch until EOF, error, or downstream cancellation.
function relayBody(
  body: ReadableStream<Uint8Array>,
  connection: AbortController
): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  let closed = false
  const close = async () => {
    if (closed) {
      return
    }
    closed = true
    connection.abort()
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (closed) {
          return
        }
        if (result.done) {
          controller.close()
          await close()
        } else {
          controller.enqueue(result.value)
        }
      } catch (error) {
        if (closed) {
          return
        }
        controller.error(error)
        await close()
      }
    },
    cancel: close,
  })
}
async function streamCamera(
  url: URL,
  signal: AbortSignal,
  dependencies: CameraStreamDependencies
): Promise<Response> {
  const address = await resolveCamera(url, dependencies)
  signal.throwIfAborted()
  let current = url
  let busyRetries = 0
  for (let redirect = 0; redirect <= MAX_REDIRECTS; ) {
    const pinned = new URL(current.href)
    pinned.hostname = address
    const connection = new AbortController()
    const cameraSignal = AbortSignal.any([signal, connection.signal])
    const upstream = await (dependencies.fetch ?? fetch)(pinned.href, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      signal: cameraSignal,
      headers: { Host: current.host, Accept: "multipart/x-mixed-replace" },
    })
    if (REDIRECTS.has(upstream.status)) {
      const location = upstream.headers.get("location")
      await upstream.body?.cancel()
      connection.abort()
      if (!location || redirect === MAX_REDIRECTS) {
        return failure(
          "The camera sent an invalid or repeated stream redirect.",
          502
        )
      }
      const next = cameraUrl(new URL(location, current).href)
      if (!next || (await resolveCamera(next, dependencies)) !== address) {
        return failure(
          "The camera redirected to another device. Use its exact stream URL.",
          502
        )
      }
      signal.throwIfAborted()
      current = next
      redirect++
      continue
    }
    if (upstream.status === 503 && busyRetries < 2) {
      // A rejected direct browser stream may need a moment to release the ESP's single preview slot.
      await upstream.body?.cancel()
      connection.abort()
      busyRetries++
      await new Promise((resolve) => setTimeout(resolve, 100))
      signal.throwIfAborted()
      continue
    }
    if (!upstream.ok) {
      await upstream.body?.cancel()
      connection.abort()
      return failure(
        upstream.status === 503
          ? "The camera preview is busy or unavailable. Close its other viewers or stop recording, then reconnect."
          : `The camera returned HTTP ${upstream.status}. Check its stream endpoint.`,
        upstream.status === 503 ? 503 : 502
      )
    }
    const contentType = upstream.headers.get("content-type") ?? ""
    if (
      !contentType.toLowerCase().includes("multipart/x-mixed-replace") ||
      !getMjpegBoundary(contentType)
    ) {
      await upstream.body?.cancel()
      connection.abort()
      return failure(
        "This endpoint did not return an MJPEG stream. Check the camera stream URL.",
        415
      )
    }
    if (!upstream.body) {
      connection.abort()
      return failure("The camera returned an empty stream.", 502)
    }
    return new Response(relayBody(upstream.body, connection), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  }
  return failure("The camera sent too many redirects.", 502)
}
async function openRequestedCamera(
  request: Request,
  signal: AbortSignal,
  dependencies: CameraStreamDependencies
): Promise<Response> {
  const input = await readCameraUrl(request, signal)
  if (input instanceof Response) {
    return input
  }
  const url = cameraUrl(input)
  if (!url) {
    return failure(
      "Use an HTTP MJPEG camera URL with a .local hostname or private LAN IP, without embedded credentials.",
      400
    )
  }
  signal.throwIfAborted()
  return streamCamera(url, signal, dependencies)
}
/** Called after route authentication; relays only same-origin requests to private cameras. */
export async function proxyCameraStream(
  request: Request,
  dependencies: CameraStreamDependencies = {}
): Promise<Response> {
  const incoming = new URL(request.url)
  const origin =
    dependencies.appOrigin ??
    `${incoming.protocol}//${request.headers.get("host") ?? incoming.host}`
  if (request.headers.get("origin") !== origin) {
    return failure(
      "Only same-origin Sightline requests can read a LAN camera.",
      403
    )
  }
  if (
    request.method !== "POST" ||
    !request.headers.get("content-type")?.startsWith("application/json")
  ) {
    return failure("Expected a camera JSON request.", 400)
  }
  const deadline = new AbortController()
  const signal = AbortSignal.any([request.signal, deadline.signal])
  const timer = setTimeout(() => deadline.abort(), HEADER_TIMEOUT)
  let onAbort: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
    }
  })
  try {
    return await Promise.race([
      openRequestedCamera(request, signal, dependencies),
      aborted,
    ])
  } catch (error) {
    if (request.signal.aborted) {
      return failure("Camera connection was stopped.", 499)
    }
    if (deadline.signal.aborted) {
      return failure(
        "The camera connection timed out. Check its Wi-Fi connection and stream availability.",
        504
      )
    }
    return failure(
      error instanceof Error && /camera hostname/i.test(error.message)
        ? error.message
        : "The Sightline server could not reach the camera. Check its Wi-Fi connection and stream URL.",
      502
    )
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", onAbort)
  }
}
