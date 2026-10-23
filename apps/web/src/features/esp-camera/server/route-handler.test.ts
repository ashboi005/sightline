import { expect, test } from "bun:test"
import { handleEspCameraRequest } from "./route-handler"
import { EspCameraService } from "./session-service"

function fixture() {
  const service = new EspCameraService({
    configuration: { brokerUrl: "mqtt://broker.hivemq.com:1883", topic: "esp32cam/kate/servo/delta" },
    now: () => 10_000, id: () => "session-id", schedule: () => () => {},
    createGateway: () => ({ connected: true, publish() { throw new Error("Unexpected movement") }, close() {} }),
    discover: async () => { throw new Error("Unexpected camera access") },
  })
  const dependencies = { requireUser: async () => "kate", getService: () => service }
  const request = (body: unknown) => new Request("http://localhost:3001/api/esp-camera", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })
  return { service, dependencies, request }
}

test("unauthenticated calls cannot create a gateway session", async () => {
  const f = fixture()
  let accessed = false
  const response = await handleEspCameraRequest(f.request({ action: "connect", url: "http://esp32.local/stream" }), {
    requireUser: async () => { throw new Response("Sign in", { status: 401 }) },
    getService: () => { accessed = true; return f.service },
  })
  expect(response.status).toBe(401)
  expect(accessed).toBe(false)
})

test.each([
  { action: "connect", url: "http://esp32.local/stream", brokerUrl: "mqtt://evil.example" },
  { action: "arm", sessionId: "session-id" },
  { action: "stop", sessionId: "session-id", intent: 0 },
  { action: "observe", sessionId: "session-id", intent: 1, observation: { x: 2 } },
  { action: "bad" },
])("invalid or transport-overriding request bodies fail before session access", async (body) => {
  const f = fixture()
  let accessed = false
  const response = await handleEspCameraRequest(f.request(body), { ...f.dependencies, getService: () => { accessed = true; return f.service } })
  expect(response.status).toBe(400)
  expect(accessed).toBe(false)
})

test("oversized bodies are bounded even without a Content-Length header", async () => {
  const f = fixture()
  const response = await handleEspCameraRequest(f.request({ action: "connect", url: "x".repeat(5_000) }), f.dependencies)
  expect(response.status).toBe(413)
})

test("hosted connect truthfully returns null telemetry and session ownership is enforced", async () => {
  const f = fixture()
  const response = await handleEspCameraRequest(f.request({ action: "connect", url: "http://esp32.local/stream" }), f.dependencies)
  expect(response.status).toBe(200)
  const reply = await response.json()
  expect(reply.camera).toBeNull()
  expect(reply.deviceTelemetry).toBe("unavailable")
  const forbidden = await handleEspCameraRequest(f.request({ action: "arm", sessionId: reply.sessionId, intent: 1 }), { ...f.dependencies, requireUser: async () => "someone-else" })
  expect(forbidden.status).toBe(404)
  f.service.disconnectAll()
})

test("a delayed authenticated Arm cannot override a later Stop", async () => {
  const f = fixture()
  await f.service.connect("kate", { action: "connect", url: "http://esp32.local/stream" })
  let release!: (user: string) => void
  const delayed = handleEspCameraRequest(f.request({ action: "arm", sessionId: "session-id", intent: 1 }), {
    ...f.dependencies, requireUser: () => new Promise((resolve) => { release = resolve }),
  })
  const stopped = await handleEspCameraRequest(f.request({ action: "stop", sessionId: "session-id", intent: 2 }), f.dependencies)
  expect((await stopped.json()).status).toBe("stopped")
  release("kate")
  const lateReply = await (await delayed).json()
  expect(lateReply.status).toBe("stopped")
  expect(lateReply.intent).toBe(2)
  f.service.disconnectAll()
})
