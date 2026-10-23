import { lookup } from "node:dns/promises"
import { get, type IncomingMessage } from "node:http"
import { isIPv4 } from "node:net"
import { SERVO_TOPIC_PATTERN } from "./configuration"
import type { EspCameraStatus } from "./types"

export type CameraTarget = { hostname: string; address: string }
export type CameraDiscovery = { camera: EspCameraStatus; topic: string }
type Lookup = (hostname: string) => Promise<{ address: string; family: number }[]>

function isPrivateIPv4(value: string): boolean {
  if (!isIPv4(value)) return false
  const [a, b] = value.split(".").map(Number)
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

export function validateCameraUrl(input: string): URL {
  if (input.length > 512) throw new Error("Camera URL is too long.")
  let url: URL
  try { url = new URL(input) } catch { throw new Error("Enter a valid local ESP camera URL.") }
  const localName = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+local$/i.test(url.hostname)
  if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash ||
      !["", "80", "81"].includes(url.port) || !["/", "/stream", "/status"].includes(url.pathname) ||
      (!isPrivateIPv4(url.hostname) && !localName)) {
    throw new Error("Use an HTTP ESP camera URL on a private IPv4 address or .local host, port 80 or 81, without credentials.")
  }
  return url
}

export async function resolveCameraTarget(input: string, resolve: Lookup = (hostname) => lookup(hostname, { all: true, family: 4 })): Promise<CameraTarget> {
  const url = validateCameraUrl(input)
  if (isPrivateIPv4(url.hostname)) return { hostname: url.hostname, address: url.hostname }
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const addresses = await Promise.race([
      resolve(url.hostname),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("Camera DNS lookup timed out.")), 2_000) }),
    ])
    if (!addresses.length || addresses.some(({ address, family }) => family !== 4 || !isPrivateIPv4(address))) {
      throw new Error("Camera host must resolve only to private IPv4 addresses.")
    }
    return { hostname: url.hostname, address: addresses[0].address }
  } finally {
    clearTimeout(timeout)
  }
}

/** Connects to a previously validated address; DNS is never consulted a second time. */
export function openCameraResponse(target: CameraTarget, path: "/status" | "/stream", port: 80 | 81, signal?: AbortSignal): Promise<IncomingMessage> {
  if (!isPrivateIPv4(target.address)) return Promise.reject(new Error("Camera address is not private."))
  return new Promise((resolve, reject) => {
    let deadline: ReturnType<typeof setTimeout> | undefined
    const request = get({ hostname: target.address, family: 4, port, path, signal,
      headers: { Host: `${target.hostname}:${port}`, Accept: path === "/status" ? "application/json" : "multipart/x-mixed-replace" },
      agent: false,
    }, (response) => {
      clearTimeout(deadline)
      if (response.statusCode !== 200) {
        response.destroy()
        reject(new Error(`Camera returned HTTP ${response.statusCode ?? "error"}; redirects are not followed.`))
        return
      }
      resolve(response)
    })
    deadline = setTimeout(() => request.destroy(new Error("Camera response headers timed out.")), 2_000)
    request.once("close", () => clearTimeout(deadline))
    request.setTimeout(2_000, () => request.destroy(new Error("Camera request timed out.")))
    request.on("error", reject)
  })
}

export function parseCameraStatus(value: unknown): CameraDiscovery {
  if (!value || typeof value !== "object") throw new Error("Camera returned invalid status.")
  const status = value as Record<string, unknown>
  const integer = (key: string, minimum: number, maximum: number): number => {
    const n = status[key]
    if (typeof n !== "number" || !Number.isInteger(n) || n < minimum || n > maximum) throw new Error("Camera returned invalid status.")
    return n
  }
  if (typeof status.servoReady !== "boolean" || typeof status.servoMqttConnected !== "boolean" ||
      typeof status.servoTopic !== "string" || !SERVO_TOPIC_PATTERN.test(status.servoTopic)) {
    throw new Error("Camera status does not contain a valid servo topic and readiness.")
  }
  return { topic: status.servoTopic, camera: {
    servoReady: status.servoReady, servoMqttConnected: status.servoMqttConnected,
    servoX: integer("servoX", 0, 180), servoY: integer("servoY", 0, 180),
    width: integer("width", 1, 4096), height: integer("height", 1, 4096),
  } }
}

export async function discoverCamera(input: string, signal?: AbortSignal): Promise<CameraDiscovery> {
  const target = await resolveCameraTarget(input)
  const response = await openCameraResponse(target, "/status", 80, signal)
  return readStatusResponse(response)
}

export async function readStatusResponse(response: IncomingMessage): Promise<CameraDiscovery> {
  const timeout = setTimeout(() => response.destroy(new Error("Camera status timed out.")), 2_000)
  try {
    let length = 0
    const chunks: Buffer[] = []
    for await (const chunk of response) {
      const buffer = Buffer.from(chunk)
      length += buffer.length
      if (length > 16_384) throw new Error("Camera status exceeded its size limit.")
      chunks.push(buffer)
    }
    return parseCameraStatus(JSON.parse(Buffer.concat(chunks).toString("utf8")))
  } finally {
    clearTimeout(timeout)
    response.destroy()
  }
}
