import { EventEmitter } from "node:events"
import { expect, test } from "bun:test"
import { startProductionServer } from "../../../../../scripts/start-production"

test("production startup launches vision before the standalone Node server and preserves its environment", async () => {
  const order: string[] = []
  const signals = new EventEmitter()
  let command: string[] = []
  let childEnvironment: NodeJS.ProcessEnv = {}
  const code = await startProductionServer({
    environment: { SIGHTLINE_LOCAL_VISION: "1", PORT: "4016", HOSTNAME: "0.0.0.0", SERVER_URL: "http://server:3000" },
    signals,
    startVision: async () => {
      order.push("vision")
      return { url: "http://127.0.0.1:4567", secret: "fixture-secret", stop: () => { order.push("stopped") } }
    },
    spawn: (args, environment) => {
      order.push("web")
      command = args
      childEnvironment = environment
      return { exited: Promise.resolve(7), kill() {} }
    },
  })
  expect(code).toBe(7)
  expect(order).toEqual(["vision", "web", "stopped"])
  expect(command).toEqual(["node", "--import", "varlock/auto-load", "server.js"])
  expect(childEnvironment).toMatchObject({ PORT: "4016", HOSTNAME: "0.0.0.0", SERVER_URL: "http://server:3000", GAZE_VISION_URL: "http://127.0.0.1:4567", GAZE_VISION_SECRET: "fixture-secret" })
  expect(signals.listenerCount("SIGTERM")).toBe(0)
})

test("disabled local vision preserves an explicitly configured companion without starting Python", async () => {
  let starts = 0
  let childEnvironment: NodeJS.ProcessEnv = {}
  await startProductionServer({
    environment: { SIGHTLINE_LOCAL_VISION: "0", GAZE_VISION_URL: "http://127.0.0.1:4568", GAZE_VISION_SECRET: "external-fixture" },
    signals: new EventEmitter(),
    startVision: async () => { starts++; return null },
    spawn: (_args, environment) => {
      childEnvironment = environment
      return { exited: Promise.resolve(0), kill() {} }
    },
  })
  expect(starts).toBe(0)
  expect(childEnvironment.GAZE_VISION_URL).toBe("http://127.0.0.1:4568")
  expect(childEnvironment.GAZE_VISION_SECRET).toBe("external-fixture")
})

test("a failed standalone spawn releases its companion and signal handlers", async () => {
  let stopped = false
  const signals = new EventEmitter()
  await expect(startProductionServer({
    environment: { SIGHTLINE_LOCAL_VISION: "1" },
    signals,
    startVision: async () => ({ url: "http://127.0.0.1:4567", secret: "fixture", stop: () => { stopped = true } }),
    spawn: () => { throw new Error("spawn failed") },
  })).rejects.toThrow("spawn failed")
  expect(stopped).toBe(true)
  expect(signals.listenerCount("SIGINT")).toBe(0)
  expect(signals.listenerCount("SIGTERM")).toBe(0)
  expect(signals.listenerCount("exit")).toBe(0)
})

test("shutdown during companion startup releases the late companion without starting Node", async () => {
  const signals = new EventEmitter()
  let release!: (value: { url: string; secret: string; stop(): void }) => void
  let stopped = false
  let spawned = false
  const starting = startProductionServer({
    environment: { SIGHTLINE_LOCAL_VISION: "1" },
    signals,
    startVision: () => new Promise((resolve) => { release = resolve }),
    spawn: () => { spawned = true; return { exited: Promise.resolve(0), kill() {} } },
  })
  signals.emit("SIGTERM")
  release({ url: "http://127.0.0.1:4567", secret: "fixture", stop: () => { stopped = true } })
  expect(await starting).toBe(143)
  expect(spawned).toBe(false)
  expect(stopped).toBe(true)
})

test("SIGTERM stops both running children and returns the signal exit code", async () => {
  const signals = new EventEmitter()
  let resolveExit!: (code: number) => void
  let stopped = false
  const starting = startProductionServer({
    environment: { SIGHTLINE_LOCAL_VISION: "1" },
    signals,
    startVision: async () => ({ url: "http://127.0.0.1:4567", secret: "fixture", stop: () => { stopped = true } }),
    spawn: () => ({
      exited: new Promise((resolve) => { resolveExit = resolve }),
      kill: () => resolveExit(143),
    }),
  })
  await Promise.resolve()
  signals.emit("SIGTERM")
  expect(await starting).toBe(143)
  expect(stopped).toBe(true)
})
