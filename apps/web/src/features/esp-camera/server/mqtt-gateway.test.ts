import { expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { createMqttGateway } from "./mqtt-gateway"
import { readServoConfiguration } from "./configuration"
import { PanController } from "./pan-controller"

const topic = "esp32cam/0123456789abcdef0123456789abcdef/servo/delta"

class Client extends EventEmitter {
  connected = false
  closed = false
  sent: { topic: string; payload: string; options: unknown }[] = []
  publish(
    destination: string,
    payload: string,
    options: unknown,
    callback: (error?: Error) => void
  ) {
    this.sent.push({ topic: destination, payload, options })
    callback()
    return this
  }
  end(force: boolean) {
    this.closed = force
    return this
  }
}

test("MQTT never queues an offline move and sends only bounded x deltas to the configured topic", () => {
  const client = new Client()
  let options: unknown
  const gateway = createMqttGateway(
    { brokerUrl: "mqtt://broker.hivemq.com:1883", topic },
    () => {},
    (_url, config) => {
      options = config
      return client
    }
  )
  expect(() => gateway.publish(2)).toThrow(/offline/i)
  expect(client.sent).toEqual([])
  client.connected = true
  client.emit("connect")
  gateway.publish(-6)
  expect(client.sent).toEqual([
    { topic, payload: '{"x":-6}', options: { qos: 0, retain: false } },
  ])
  expect(options).toMatchObject({
    clean: true,
    queueQoSZero: false,
    resubscribe: false,
  })
  expect(() => gateway.publish(7)).toThrow()
  expect(() => gateway.publish(50)).toThrow()
  expect(() => gateway.publish(1.5)).toThrow()
  gateway.close()
  expect(client.closed).toBe(true)
  expect(() => gateway.publish(1)).toThrow(/offline/i)
})

test("disconnect and reconnect events report the change without replaying commands", () => {
  const client = new Client()
  const states: boolean[] = []
  const gateway = createMqttGateway(
    { brokerUrl: "mqtt://broker.hivemq.com:1883", topic },
    (value) => states.push(value),
    () => client
  )
  client.connected = true
  client.emit("connect")
  gateway.publish(1)
  client.connected = false
  client.emit("offline")
  expect(gateway.connected).toBe(false)
  expect(() => gateway.publish(1)).toThrow()
  client.emit("reconnect")
  client.connected = true
  client.emit("connect")
  expect(states).toEqual([true, false, true])
  expect(client.sent).toHaveLength(1)
  gateway.close()
})

test("the environment cannot configure a malformed topic or an HTTP broker", () => {
  expect(readServoConfiguration({}).topic).toBe("esp32cam/kate/servo/delta")
  expect(() =>
    readServoConfiguration({ ESP_MQTT_TOPIC: "other/topic" })
  ).toThrow(/topic/i)
  expect(() =>
    readServoConfiguration({
      ESP_MQTT_TOPIC: topic,
      ESP_MQTT_URL: "https://example.com",
    })
  ).toThrow(/broker/i)
  expect(readServoConfiguration({ ESP_MQTT_TOPIC: topic })).toMatchObject({
    brokerUrl: "mqtt://broker.hivemq.com:1883",
    topic,
  })
})

test("verified off-center person observations become firmware-compatible MQTT degree deltas", () => {
  const client = new Client()
  let now = 10000
  const controller = new PanController({
    now: () => now,
    publish: (delta) => gateway.publish(delta),
  })
  const configuration = readServoConfiguration({})
  const gateway = createMqttGateway(
    configuration,
    (ready) => controller.setReady(ready),
    () => client
  )
  client.connected = true
  client.emit("connect")
  const observe = (frameId: number, x: number) =>
    controller.observe({
      x,
      confidence: 0.72,
      frameId,
      capturedAt: now,
      personEvidence: { detectionConfidence: 0.9, identityMargin: 0.2 },
    })
  observe(1, 0.9)
  now += 50
  observe(2, 0.9)
  expect(client.sent).toEqual([])
  expect(controller.arm()).toBe(true)
  now += 50
  observe(3, 0.9)
  now += 250
  observe(4, 0.1)
  expect(client.sent).toEqual([
    {
      topic: "esp32cam/kate/servo/delta",
      payload: '{"x":-6}',
      options: { qos: 0, retain: false },
    },
    {
      topic: "esp32cam/kate/servo/delta",
      payload: '{"x":6}',
      options: { qos: 0, retain: false },
    },
  ])
  controller.stop()
  gateway.close()
})
