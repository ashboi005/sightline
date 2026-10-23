import { expect, test } from "bun:test"
import { Readable } from "node:stream"
import type { IncomingMessage } from "node:http"
import { parseCameraStatus, readStatusResponse, resolveCameraTarget, validateCameraUrl } from "./camera-http"

test.each([
  "https://esp32.local/stream", "http://user:password@esp32.local/stream",
  "http://127.0.0.1/status", "http://169.254.169.254/", "http://8.8.8.8/",
  "http://localhost/", "http://example.com/", "http://192.168.1.2:8080/",
  "http://192.168.1.2/admin", "http://192.168.1.2/stream?url=http://example.com",
])("rejects non-camera destinations before any network access: %s", (url) => {
  expect(() => validateCameraUrl(url)).toThrow()
})

test("mDNS resolves once and pins only a private IPv4 destination", async () => {
  const target = await resolveCameraTarget("http://esp32.local:81/stream", async () => [{ address: "192.168.1.20", family: 4 }])
  expect(target).toEqual({ hostname: "esp32.local", address: "192.168.1.20" })
  await expect(resolveCameraTarget("http://esp32.local/stream", async () => [{ address: "127.0.0.1", family: 4 }])).rejects.toThrow()
  await expect(resolveCameraTarget("http://esp32.local/stream", async () => [{ address: "192.168.1.20", family: 4 }, { address: "8.8.8.8", family: 4 }])).rejects.toThrow()
})

test("device status requires the exact servo topic and bounded geometry/angles", () => {
  const status = { servoReady: true, servoMqttConnected: true, servoX: 90, servoY: 90, width: 600, height: 800, servoTopic: "esp32cam/kate/servo/delta" }
  expect(parseCameraStatus(status).topic).toBe("esp32cam/kate/servo/delta")
  expect(() => parseCameraStatus({ ...status, servoTopic: "esp32cam/+/servo/delta" })).toThrow()
  expect(() => parseCameraStatus({ ...status, servoX: 181 })).toThrow()
  expect(() => parseCameraStatus({ ...status, servoReady: "true" })).toThrow()
})

test("status bodies are bounded and destroyed after oversized or malformed JSON", async () => {
  const oversized = Readable.from([Buffer.alloc(16_385, " ")]) as IncomingMessage
  await expect(readStatusResponse(oversized)).rejects.toThrow(/size limit/i)
  expect(oversized.destroyed).toBe(true)
  const malformed = Readable.from([Buffer.from('{"servoReady":')]) as IncomingMessage
  await expect(readStatusResponse(malformed)).rejects.toThrow()
  expect(malformed.destroyed).toBe(true)
})
