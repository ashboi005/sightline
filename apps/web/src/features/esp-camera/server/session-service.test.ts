import { expect, test } from "bun:test"
import { EspCameraService } from "./session-service"
import type { ServoGateway } from "./types"

function fixture() {
  let now = 10_000
  let nextId = 0
  const tasks = new Set<{ at: number; run: () => void }>()
  const commands: number[] = []
  const gateways: {
    gateway: ServoGateway
    change: (ready: boolean) => void
  }[] = []
  const service = new EspCameraService({
    configuration: {
      brokerUrl: "mqtt://broker.hivemq.com:1883",
      topic: "esp32cam/kate/servo/delta",
    },
    now: () => now,
    id: () => `session-${++nextId}`,
    schedule(run, delay) {
      const task = { at: now + delay, run }
      tasks.add(task)
      return () => {
        tasks.delete(task)
      }
    },
    createGateway(_configuration, change) {
      const gateway = {
        connected: true,
        publish(delta: number) {
          commands.push(delta)
        },
        close() {
          this.connected = false
        },
      }
      gateways.push({ gateway, change })
      return gateway
    },
    discover: async () => {
      throw new Error("Hosted mode must not contact a LAN camera")
    },
  })
  const advance = (ms: number) => {
    now += ms
    for (const task of [...tasks])
      if (task.at <= now) {
        tasks.delete(task)
        task.run()
      }
  }
  const observe = (
    sessionId: string,
    frameId: number,
    confidence = 0.95,
    intent = 0
  ) =>
    service.execute("kate", {
      action: "observe",
      sessionId,
      intent,
      observation: { x: 0.9, confidence, frameId, capturedAt: now },
    })
  return { service, gateways, commands, tasks, advance, observe }
}

test("hosted connection reports unavailable device telemetry and does not contact the camera", async () => {
  const f = fixture()
  const reply = await f.service.connect("kate", {
    action: "connect",
    url: "http://esp32.local:81/stream",
  })
  expect(reply.camera).toBeNull()
  expect(reply.deviceTelemetry).toBe("unavailable")
  expect(reply.mqttConnected).toBe(true)
  expect(reply.serverTime).toBe(10_000)
  expect(reply.message).toMatch(/telemetry unavailable/i)
  expect(f.commands).toEqual([])
  f.service.disconnectAll()
  expect(f.tasks.size).toBe(0)
})

test("configured-topic hosted control accepts an HTTPS video reference without fetching it", async () => {
  const f = fixture()
  const reply = await f.service.connect("kate", {
    action: "connect",
    url: "https://camera.example:8443/live/video.mjpeg?view=target",
  })
  expect(reply.camera).toBeNull()
  expect(reply.status).toBe("connected")
  expect(f.commands).toEqual([])
  f.service.disconnectAll()
})

test("a refused Arm explains the missing fresh evidence", async () => {
  const f = fixture()
  const { sessionId } = await f.service.connect("kate", {
    action: "connect",
    url: "http://esp32.local/stream",
  })
  const reply = f.service.execute("kate", {
    action: "arm",
    sessionId,
    intent: 1,
  })
  expect(reply.canArm).toBe(false)
  expect(reply.message).toMatch(/two fresh/i)
  f.service.disconnectAll()
})

test("network capture latency does not make the scheduled watchdog erase consecutive confirmations", async () => {
  const f = fixture()
  const { sessionId } = await f.service.connect("kate", {
    action: "connect",
    url: "http://esp32.local/stream",
  })
  const observe = (frameId: number, capturedAt: number, intent = 0) =>
    f.service.execute("kate", {
      action: "observe",
      sessionId,
      intent,
      observation: {
        x: 0.9,
        confidence: 0.8,
        frameId,
        capturedAt,
        personEvidence: { detectionConfidence: 0.9, identityMargin: 0.2 },
      },
    })
  observe(1, 9500)
  f.advance(400)
  expect(observe(2, 9900).canArm).toBe(true)
  expect(
    f.service.execute("kate", { action: "arm", sessionId, intent: 1 }).status
  ).toBe("tracking")
  f.advance(400)
  expect(observe(3, 10300, 1).status).toBe("tracking")
  expect(f.commands).toEqual([-6])
  f.advance(750)
  expect(
    f.service.execute("kate", { action: "status", sessionId }).status
  ).toBe("paused")
  f.service.disconnectAll()
})

test("person gap recovery expires on its own timer and Stop cannot be undone by new frames", async () => {
  const f = fixture()
  const { sessionId } = await f.service.connect("kate", {
    action: "connect",
    url: "http://esp32.local/stream",
  })
  const observe = (frameId: number, capturedAt: number, intent = 0) =>
    f.service.execute("kate", {
      action: "observe",
      sessionId,
      intent,
      observation: {
        x: 0.9,
        confidence: 0.72,
        frameId,
        capturedAt,
        personEvidence: { detectionConfidence: 0.9, identityMargin: 0.2 },
      },
    })
  observe(1, 10_000)
  f.advance(50)
  observe(2, 10_050)
  f.service.execute("kate", { action: "arm", sessionId, intent: 1 })
  f.advance(750)
  expect(
    f.service.execute("kate", { action: "status", sessionId }).status
  ).toBe("paused")
  f.advance(1250)
  expect(
    f.service.execute("kate", { action: "status", sessionId }).status
  ).toBe("stopped")
  observe(3, 12_050, 1)
  f.advance(50)
  observe(4, 12_100, 1)
  expect(
    f.service.execute("kate", { action: "status", sessionId }).status
  ).toBe("stopped")
  expect(f.commands).toEqual([])
  f.service.disconnectAll()
  expect(f.tasks.size).toBe(0)
})

test("a topic has one session owner, including concurrent connects by the same user", async () => {
  const f = fixture()
  const first = await f.service.connect("kate", {
    action: "connect",
    url: "http://esp32.local/stream",
  })
  await expect(
    f.service.connect("someone-else", {
      action: "connect",
      url: "http://192.168.1.20/stream",
    })
  ).rejects.toMatchObject({ status: 409 })
  await expect(
    f.service.connect("kate", {
      action: "connect",
      url: "http://esp32.local/stream",
    })
  ).rejects.toMatchObject({ status: 409 })
  expect(() =>
    f.service.execute("someone-else", {
      action: "arm",
      sessionId: first.sessionId,
      intent: 1,
    })
  ).toThrow()
  expect(f.commands).toEqual([])
  f.service.disconnectAll()
})

test("fresh frames then explicit arm permit movement; stale expiry stops it without another request", async () => {
  const f = fixture()
  const { sessionId } = await f.service.connect("kate", {
    action: "connect",
    url: "http://esp32.local/stream",
  })
  f.observe(sessionId, 1)
  f.advance(50)
  f.observe(sessionId, 2)
  expect(
    f.service.execute("kate", { action: "arm", sessionId, intent: 1 }).status
  ).toBe("tracking")
  f.advance(10)
  f.observe(sessionId, 3, 0.95, 1)
  expect(f.commands).toEqual([-6])
  f.advance(750)
  expect(
    f.service.execute("kate", { action: "status", sessionId }).status
  ).toBe("stopped")
  f.observe(sessionId, 4, 0.95, 1)
  expect(f.commands).toEqual([-6])
  f.service.disconnectAll()
})

test("repeated frame IDs never extend a session's lease", async () => {
  const f = fixture()
  const { sessionId } = await f.service.connect("kate", {
    action: "connect",
    url: "http://esp32.local/stream",
  })
  const first = f.observe(sessionId, 1)
  f.advance(1_000)
  expect(f.observe(sessionId, 1).leaseExpiresAt).toBe(first.leaseExpiresAt)
  f.advance(29_001)
  expect(() =>
    f.service.execute("kate", { action: "status", sessionId })
  ).toThrow()
  expect(f.gateways[0].gateway.connected).toBe(false)
  expect(f.tasks.size).toBe(0)
})

test("disconnect removes resources and releases the device for a new owner", async () => {
  const f = fixture()
  const { sessionId } = await f.service.connect("kate", {
    action: "connect",
    url: "http://esp32.local/stream",
  })
  f.advance(100)
  const disconnected = f.service.execute("kate", {
    action: "disconnect",
    sessionId,
  })
  expect(disconnected.status).toBe("disconnected")
  expect(disconnected.serverTime).toBe(10_100)
  expect(f.tasks.size).toBe(0)
  const next = await f.service.connect("new-owner", {
    action: "connect",
    url: "http://esp32.local/stream",
  })
  expect(next.status).toBe("connected")
  f.service.disconnectAll()
})

test("a later Stop supersedes delayed Arm and observations from an older intent", async () => {
  const f = fixture()
  const { sessionId } = await f.service.connect("kate", {
    action: "connect",
    url: "http://esp32.local/stream",
  })
  f.observe(sessionId, 1)
  f.advance(50)
  f.observe(sessionId, 2)
  expect(
    f.service.execute("kate", { action: "stop", sessionId, intent: 2 }).status
  ).toBe("stopped")
  f.advance(50)
  f.observe(sessionId, 3, 0.95, 2)
  f.advance(50)
  f.observe(sessionId, 4, 0.95, 2)
  const delayedArm = f.service.execute("kate", {
    action: "arm",
    sessionId,
    intent: 1,
  })
  expect(delayedArm.status).toBe("stopped")
  expect(delayedArm.intent).toBe(2)
  f.advance(50)
  f.observe(sessionId, 5, 0.95, 1)
  expect(f.commands).toEqual([])
  f.service.disconnectAll()
})
