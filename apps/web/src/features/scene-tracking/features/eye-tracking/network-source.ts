import { isLocalCameraHost } from "./local-camera-address"
import { getMjpegBoundary, readMjpegFrames } from "./mjpeg"
import type {
  NetworkSource,
  DirectCameraResponse,
} from "./network-source.types"
const VIDEO_READY_TIMEOUT_MS = 15000
const ESP32_STREAM_PORT = "81"
const LOCAL_CAMERA_DIRECT_TIMEOUT_MS = 2000
export class CameraAccessError extends Error {
  constructor() {
    super(getCameraStreamErrorMessage())
    this.name = "CameraAccessError"
  }
}
export async function openNetworkSource(
  input: string,
  signal: AbortSignal,
  allowEsp32Fallback = true,
  preferLocalRelay = false
): Promise<NetworkSource> {
  const url = parseNetworkUrl(input)
  throwIfAborted(signal)
  const localCamera =
    url.protocol === "http:" && isLocalCameraHost(url.hostname)
  if (preferLocalRelay && localCamera) {
    return openLocalCameraRelay(url, signal)
  }
  const deadline = localCamera ? new AbortController() : null
  const directSignal = deadline
    ? AbortSignal.any([signal, deadline.signal])
    : signal
  const timer = deadline
    ? setTimeout(() => deadline.abort(), LOCAL_CAMERA_DIRECT_TIMEOUT_MS)
    : undefined
  let direct: DirectCameraResponse
  try {
    direct = await fetchDirectCameraResponse(
      url,
      directSignal,
      allowEsp32Fallback
    )
  } catch (error) {
    const directTimedOut = deadline?.signal.aborted
    deadline?.abort()
    throwIfAborted(signal)
    if (localCamera && (error instanceof CameraAccessError || directTimedOut)) {
      return openLocalCameraRelay(url, signal)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
  const streamUrl = direct.streamUrl
  const response = direct.response
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.toLowerCase().includes("multipart/x-mixed-replace")) {
    return openMjpegSource(url, streamUrl.href, response, contentType, signal)
  }
  const videoUrl = response.url || streamUrl.href
  await cancelResponseBody(response)
  return openVideoSource(url, videoUrl, signal)
}
async function fetchDirectCameraResponse(
  url: URL,
  signal: AbortSignal,
  allowEsp32Fallback: boolean
): Promise<DirectCameraResponse> {
  let streamUrl = url
  let response: Response
  try {
    response = await fetchCameraResponse(streamUrl.href, signal)
  } catch (error) {
    const fallbackUrl = getEsp32StreamFallback(url)
    if (
      !(error instanceof CameraAccessError) ||
      !allowEsp32Fallback ||
      !fallbackUrl
    ) {
      throw error
    }
    throwIfAborted(signal)
    streamUrl = fallbackUrl
    response = await fetchCameraResponse(streamUrl.href, signal)
  }
  return { streamUrl, response }
}
async function openLocalCameraRelay(
  url: URL,
  signal: AbortSignal
): Promise<NetworkSource> {
  let response: Response
  try {
    response = await fetch("/api/camera-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.href }),
      signal,
      credentials: "same-origin",
      cache: "no-store",
    })
  } catch {
    throwIfAborted(signal)
    throw new CameraAccessError()
  }
  if (!response.ok) {
    const detail = await readCameraStreamError(response)
    await cancelResponseBody(response)
    throw new Error(
      detail ||
        "The camera relay is unavailable. Check the Sightline server."
    )
  }
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("multipart/x-mixed-replace")) {
    await cancelResponseBody(response)
    throw new Error("The local camera endpoint did not return an MJPEG stream.")
  }
  const source = await openMjpegSource(
    url,
    url.href,
    response,
    contentType,
    signal
  )
  return { ...source, localRelay: true }
}
function parseNetworkUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error("Enter a complete HTTP or HTTPS camera stream URL.")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Use an HTTP or HTTPS network stream URL.")
  }
  if (url.username || url.password) {
    throw new Error("Use a camera URL without embedded login credentials.")
  }
  return url
}
function getEsp32StreamFallback(url: URL): URL | null {
  if (url.protocol !== "http:" || url.port || url.pathname !== "/stream") {
    return null
  }
  if (!isLocalCameraHost(url.hostname)) {
    return null
  }
  const fallbackUrl = new URL(url.href)
  fallbackUrl.port = ESP32_STREAM_PORT
  return fallbackUrl
}
async function fetchCameraResponse(
  streamUrl: string,
  signal: AbortSignal
): Promise<Response> {
  let response: Response
  try {
    response = await fetch(streamUrl, {
      signal,
      mode: "cors",
      credentials: "omit",
      redirect: "follow",
      cache: "no-store",
    })
  } catch {
    if (signal.aborted) {
      throw createAbortError()
    }
    throw new CameraAccessError()
  }
  if (!response.ok) {
    const detail = await readCameraStreamError(response)
    await cancelResponseBody(response)
    if (detail) {
      throw new Error(detail)
    }
    throw new Error(
      `The camera returned HTTP ${response.status}. Check its stream URL and network connection.`
    )
  }
  return response
}
async function openMjpegSource(
  url: URL,
  streamUrl: string,
  response: Response,
  contentType: string,
  signal: AbortSignal
): Promise<NetworkSource> {
  const boundary = getMjpegBoundary(contentType)
  if (!boundary) {
    await cancelResponseBody(response)
    throw new Error("The camera returned an invalid MJPEG boundary.")
  }
  if (!response.body) {
    throw new Error("The camera returned an empty MJPEG stream.")
  }
  const frames = readMjpegFrames(response.body, boundary, signal)
  let firstFrame: IteratorResult<Uint8Array>
  try {
    firstFrame = await frames.next()
    throwIfAborted(signal)
  } catch (error) {
    await frames.return(undefined)
    throw error
  }
  if (firstFrame.done) {
    await frames.return(undefined)
    throw new Error("The camera stream contains no JPEG frame.")
  }
  return {
    kind: "mjpeg",
    name: url.hostname,
    streamUrl,
    firstFrame: firstFrame.value,
    frames,
  }
}
async function openVideoSource(
  url: URL,
  streamUrl: string,
  signal: AbortSignal
): Promise<NetworkSource> {
  const video = document.createElement("video")
  video.muted = true
  video.playsInline = true
  video.crossOrigin = "anonymous"
  video.src = streamUrl
  try {
    await playVideo(video, signal)
    await waitForVideoDimensions(video, signal)
    throwIfAborted(signal)
  } catch {
    disposeVideo(video)
    if (signal.aborted) {
      throw createAbortError()
    }
    throw new Error(
      "The browser could not play this network video. Check that the URL provides MJPEG or a browser-playable video stream."
    )
  }
  return {
    kind: "video",
    name: url.hostname,
    streamUrl,
    video,
  }
}
function playVideo(
  video: HTMLVideoElement,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener("abort", onAbort)
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const onAbort = () => {
      disposeVideo(video)
      finish(createAbortError())
    }
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    try {
      video.play().then(() => finish(), finish)
    } catch (error) {
      finish(error)
    }
  })
}
function waitForVideoDimensions(
  video: HTMLVideoElement,
  signal: AbortSignal
): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      finish(new Error("The camera video did not become ready in time."))
    }, VIDEO_READY_TIMEOUT_MS)
    const onLoaded = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        finish()
        return
      }
      finish(new Error("The camera video contains no readable image data."))
    }
    const onError = () => {
      finish(new Error("The browser could not decode this camera stream."))
    }
    const onAbort = () => {
      finish(createAbortError())
    }
    const finish = (error?: Error) => {
      clearTimeout(timeout)
      video.removeEventListener("loadeddata", onLoaded)
      video.removeEventListener("error", onError)
      signal.removeEventListener("abort", onAbort)
      if (error) {
        reject(error)
        return
      }
      resolve()
    }
    video.addEventListener("loadeddata", onLoaded, { once: true })
    video.addEventListener("error", onError, { once: true })
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
    }
  })
}
async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {})
}
async function readCameraStreamError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error
    }
  } catch {
    /* Camera errors can also be plain text or an empty response. */
  }
  return ""
}
function disposeVideo(video: HTMLVideoElement): void {
  video.pause()
  video.removeAttribute("src")
  video.load()
}
function getCameraStreamErrorMessage(): string {
  return "The browser cannot read this camera. Check the URL and local-network permission. The camera must allow CORS on stream and redirect responses."
}
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createAbortError()
  }
}
function createAbortError(): DOMException {
  return new DOMException("The camera source was stopped.", "AbortError")
}
