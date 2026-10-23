import { expect, test } from "bun:test"
import { PanController } from "./pan-controller"

function fixture(invertPan = false, angle: number | null = 90) {
  let now = 10_000
  const commands: number[] = []
  const controller = new PanController({
    now: () => now,
    publish: (delta) => commands.push(delta),
    invertPan,
    angle,
  })
  controller.setReady(true)
  const observe = (
    frameId: number,
    x = 0.9,
    confidence = 0.95,
    capturedAt = now
  ) => controller.observe({ x, confidence, frameId, capturedAt })
  const advance = (ms: number) => {
    now += ms
  }
  const prepare = () => {
    observe(1)
    advance(50)
    observe(2)
  }
  return { controller, commands, observe, advance, prepare }
}

test("connecting and selecting never move; arming requires two reliable frames", () => {
  const f = fixture()
  expect(f.controller.arm()).toBe(false)
  f.observe(1)
  expect(f.controller.arm()).toBe(false)
  f.advance(50)
  f.observe(2)
  expect(f.commands).toEqual([])
  expect(f.controller.arm()).toBe(true)
  expect(f.commands).toEqual([])
  f.advance(10)
  f.observe(3)
  expect(f.commands).toEqual([6])
})
test("the installed mount defaults to negative X for a target on the right", () => {
  let now = 10000
  const commands: number[] = []
  const controller = new PanController({
    now: () => now,
    publish: (delta) => commands.push(delta),
  })
  controller.setReady(true)
  const observe = (frameId: number, x: number) =>
    controller.observe({
      x,
      confidence: 0.72,
      frameId,
      capturedAt: now,
      personEvidence: { detectionConfidence: 0.9, identityMargin: 0.2 },
    })
  observe(1, 0.65)
  now += 50
  observe(2, 0.65)
  expect(controller.arm()).toBe(true)
  now += 50
  observe(3, 0.65)
  expect(commands).toEqual([-1])
  now += 250
  observe(4, 0.65)
  now += 250
  observe(5, 0.35)
  now += 250
  observe(6, 0.35)
  expect(commands).toEqual([-1, -1, 1, 1])
})

test("small center errors accumulate gentle whole-degree corrections instead of a minimum move every tick", () => {
  const f = fixture(false, null)
  f.prepare()
  f.controller.arm()
  for (let index = 0; index < 3; index++) {
    f.advance(250)
    f.observe(index + 3, 0.58)
    expect(f.commands).toEqual([])
  }
  f.advance(250)
  f.observe(6, 0.58)
  expect(f.commands).toEqual([1])
})

test("larger errors produce a stronger curved response while every move remains bounded", () => {
  const movement = (x: number) => {
    const f = fixture(false, null)
    f.prepare()
    f.controller.arm()
    for (let index = 0; index < 16; index++) {
      f.advance(250)
      f.observe(index + 3, x)
    }
    expect(f.commands.every((delta) => delta > 0 && delta <= 6)).toBe(true)
    return f.commands.reduce((sum, delta) => sum + delta, 0)
  }
  const near = movement(0.58),
    medium = movement(0.7),
    far = movement(0.95)
  expect(near).toBeGreaterThan(0)
  expect(medium).toBeGreaterThan(near * 2)
  expect(far).toBeGreaterThan(medium)
})

test("far-off targets get substantial correction that tapers to gentle movement near center", () => {
  const f = fixture(true, null)
  f.prepare()
  f.controller.arm()
  for (let index = 0; index < 8; index++) {
    f.advance(250)
    f.observe(index + 3, 0.85)
  }
  const farTravel = -f.commands.reduce((sum, delta) => sum + delta, 0)
  expect(farTravel).toBeGreaterThanOrEqual(40)
  expect(f.commands.every((delta) => delta < 0 && delta >= -6)).toBe(true)
  const beforeApproach = f.commands.length
  for (let index = 0; index < 8; index++) {
    f.advance(250)
    f.observe(index + 11, 0.58)
  }
  const approach = f.commands.slice(beforeApproach)
  expect(approach.every((delta) => delta === -1)).toBe(true)
  expect(-approach.reduce((sum, delta) => sum + delta, 0)).toBeLessThanOrEqual(
    3
  )
  const beforeCenter = f.commands.length
  for (let index = 0; index < 4; index++) {
    f.advance(250)
    f.observe(index + 19, 0.52)
  }
  expect(f.commands).toHaveLength(beforeCenter)
})

test("crossing the center discards fractional corrections in the old direction", () => {
  const f = fixture(false, null)
  f.prepare()
  f.controller.arm()
  for (let index = 0; index < 2; index++) {
    f.advance(250)
    f.observe(index + 3, 0.6)
  }
  expect(f.commands).toEqual([])
  for (let index = 0; index < 2; index++) {
    f.advance(250)
    f.observe(index + 5, 0.4)
    expect(f.commands).toEqual([])
  }
  f.advance(250)
  f.observe(7, 0.4)
  expect(f.commands).toEqual([-1])
})

test("entering the deadband clears fractional corrections before a new offset", () => {
  const f = fixture(false, null)
  f.prepare()
  f.controller.arm()
  for (const [index, x] of [0.6, 0.6, 0.5, 0.6, 0.6].entries()) {
    f.advance(250)
    f.observe(index + 3, x)
  }
  expect(f.commands).toEqual([])
})

test("normal variations in network frame rate do not multiply the response", () => {
  const movement = (fps: number) => {
    const f = fixture(false, null)
    f.prepare()
    f.controller.arm()
    for (let index = 0; index < fps * 4; index++) {
      f.advance(1000 / fps)
      f.observe(index + 3, 0.7)
    }
    expect(f.commands.every((delta) => delta > 0 && delta <= 6)).toBe(true)
    return f.commands.reduce((sum, delta) => sum + delta, 0)
  }
  expect(Math.abs(movement(2) - movement(20))).toBeLessThanOrEqual(2)
})

test("commands remain bounded and rate limited with a center deadband", () => {
  const f = fixture()
  f.prepare()
  f.controller.arm()
  f.advance(10)
  f.observe(3, 1)
  f.advance(249)
  f.observe(4, 0)
  f.advance(1)
  f.observe(5, 0)
  f.advance(250)
  f.observe(6, 0.53)
  expect(f.commands).toEqual([6, -6])
})

test("duplicate or reordered frames cannot publish or renew freshness", () => {
  const f = fixture()
  f.prepare()
  f.controller.arm()
  f.advance(250)
  expect(f.observe(2)).toBe(false)
  f.advance(501)
  f.controller.checkFreshness()
  expect(f.controller.status).toBe("stopped")
  expect(f.commands).toEqual([])
  f.observe(3)
  expect(f.controller.status).toBe("stopped")
})

test.each([
  { x: 0.9, confidence: 0.8, frameId: 3, capturedAt: 10_100 },
  { x: 0.9, confidence: 0.95, frameId: 3, capturedAt: 9_000 },
  { x: 0.9, confidence: 0.95, frameId: 3, capturedAt: 10_201 },
  { x: Number.NaN, confidence: 0.95, frameId: 3, capturedAt: 10_100 },
])(
  "unreliable, stale, future, or invalid observations disarm",
  (observation) => {
    const f = fixture()
    f.prepare()
    f.controller.arm()
    f.advance(50)
    f.controller.observe(observation)
    expect(f.controller.status).toBe("stopped")
    expect(f.commands).toEqual([])
  }
)

test("transport loss and recovery require new samples and explicit rearming", () => {
  const f = fixture()
  f.prepare()
  f.controller.arm()
  f.controller.setReady(false)
  f.controller.setReady(true)
  expect(f.controller.arm()).toBe(false)
  f.advance(50)
  f.observe(3)
  f.advance(50)
  f.observe(4)
  expect(f.commands).toEqual([])
  expect(f.controller.status).toBe("stopped")
  expect(f.controller.arm()).toBe(true)
})

test("manual stop does not send a fake firmware command", () => {
  const f = fixture()
  f.prepare()
  f.controller.arm()
  f.controller.stop()
  f.advance(250)
  f.observe(3)
  expect(f.commands).toEqual([])
  expect(f.controller.status).toBe("stopped")
})

test("known position bounds and inverted mounting constrain the requested movement", () => {
  const f = fixture(false, 179)
  f.prepare()
  f.controller.arm()
  f.advance(1)
  f.observe(3)
  f.advance(250)
  f.observe(4)
  expect(f.commands).toEqual([1])
  const inverted = fixture(true, null)
  inverted.prepare()
  inverted.controller.arm()
  inverted.advance(1)
  inverted.observe(3)
  expect(inverted.commands).toEqual([-6])
})

test("publish failure disarms and is never retried on the same observation", () => {
  let now = 10_000
  const c = new PanController({
    now: () => now,
    publish: () => {
      throw new Error("offline")
    },
  })
  c.setReady(true)
  c.observe({ x: 0.9, confidence: 0.9, frameId: 1, capturedAt: now })
  now += 50
  c.observe({ x: 0.9, confidence: 0.9, frameId: 2, capturedAt: now })
  c.arm()
  now += 50
  expect(() =>
    c.observe({ x: 0.9, confidence: 0.9, frameId: 3, capturedAt: now })
  ).not.toThrow()
  expect(c.status).toBe("stopped")
})

test("a person identity uses its real similarity plus detector and separation evidence", () => {
  const f = fixture()
  const observe = (frameId: number, capturedAt: number, margin = 0.2) =>
    f.controller.observe({
      x: 0.9,
      confidence: 0.71,
      frameId,
      capturedAt,
      personEvidence: { detectionConfidence: 0.9, identityMargin: margin },
    })
  expect(observe(1, 10_000)).toBe(true)
  f.advance(50)
  expect(observe(2, 10_050)).toBe(true)
  expect(f.controller.arm()).toBe(true)
  f.advance(250)
  observe(3, 10_300)
  expect(f.commands).toEqual([6])
  f.advance(250)
  expect(observe(4, 10_550, 0.01)).toBe(false)
  expect(f.controller.status).toBe("stopped")
  expect(f.commands).toEqual([6])
})

test("brief person stream gaps pause commands and need two fresh confirmations to resume", () => {
  const f = fixture()
  let frame = 0
  const observe = (capturedAt: number) =>
    f.controller.observe({
      x: 0.9,
      confidence: 0.75,
      frameId: ++frame,
      capturedAt,
      personEvidence: { detectionConfidence: 0.9, identityMargin: 0.2 },
    })
  observe(10_000)
  f.advance(50)
  observe(10_050)
  f.controller.arm()
  f.advance(750)
  f.controller.checkFreshness()
  expect(f.controller.status).toBe("paused")
  expect(f.commands).toEqual([])
  observe(10_800)
  expect(f.controller.status).toBe("paused")
  f.advance(100)
  observe(10_900)
  expect(f.controller.status).toBe("tracking")
  expect(f.commands).toEqual([6])
  f.advance(2000)
  f.controller.checkFreshness()
  expect(f.controller.status).toBe("stopped")
  observe(12_900)
  f.advance(100)
  observe(13_000)
  expect(f.controller.status).toBe("stopped")
  expect(f.commands).toEqual([6])
})

test("verified network frames arriving half a second late can arm and keep following at 2.5 fps", () => {
  let now = 10_000
  const commands: number[] = []
  const controller = new PanController({
    now: () => now,
    publish: (delta) => commands.push(delta),
  })
  controller.setReady(true)
  const observe = (frameId: number) =>
    controller.observe({
      x: 0.9,
      confidence: 0.8,
      frameId,
      capturedAt: now - 500,
      personEvidence: { detectionConfidence: 0.9, identityMargin: 0.2 },
    })
  observe(1)
  now += 400
  observe(2)
  expect(controller.canArm).toBe(true)
  expect(controller.arm()).toBe(true)
  for (let frame = 3; frame <= 6; frame++) {
    now += 400
    observe(frame)
    expect(controller.status).toBe("tracking")
  }
  expect(commands).toEqual([-6, -6, -6, -6])
  now += 750
  controller.checkFreshness()
  expect(controller.status).toBe("paused")
  expect(commands).toHaveLength(4)
})

test("arrival continuity cannot arm from a capture that has since expired", () => {
  let now = 10_000
  const controller = new PanController({
    now: () => now,
    publish: () => {
      throw Error("Unexpected movement")
    },
  })
  controller.setReady(true)
  const observe = (frameId: number) =>
    controller.observe({
      x: 0.9,
      confidence: 0.95,
      frameId,
      capturedAt: now - 500,
    })
  observe(1)
  now += 100
  observe(2)
  expect(controller.canArm).toBe(true)
  now += 250
  expect(controller.canArm).toBe(false)
  expect(controller.arm()).toBe(false)
})
