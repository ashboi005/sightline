import type { ServoConfiguration } from "./configuration"
import { ESP_MAX_PAN_DELTA, SERVO_TOPIC_PATTERN } from "./configuration"
import type { ServoGateway } from "./types"

export interface MqttClientLike {
  readonly connected: boolean
  on(event: string, listener: () => void): unknown
  removeListener(event: string, listener: () => void): unknown
  publish(
    topic: string,
    payload: string,
    options: { qos: 0; retain: false },
    callback: (error?: Error) => void
  ): unknown
  end(force: boolean): unknown
}

export type MqttConnectOptions = {
  clean: true
  queueQoSZero: false
  resubscribe: false
  reconnectPeriod: number
  connectTimeout: number
  username?: string
  password?: string
}

export function createMqttGateway(
  configuration: ServoConfiguration,
  onConnectionChange: (connected: boolean) => void,
  connect: (url: string, options: MqttConnectOptions) => MqttClientLike
): ServoGateway {
  if (!SERVO_TOPIC_PATTERN.test(configuration.topic))
    throw new Error(
      "The device servo topic must be configured before connecting."
    )
  const client = connect(configuration.brokerUrl, {
    clean: true,
    queueQoSZero: false,
    resubscribe: false,
    reconnectPeriod: 2_000,
    connectTimeout: 5_000,
    username: configuration.username,
    password: configuration.password,
  })
  let closed = false
  let ready = false
  const update = (value: boolean) => {
    if (closed || value === ready) return
    ready = value
    onConnectionChange(value)
  }
  const connected = () => update(true)
  const disconnected = () => update(false)
  const events: [string, () => void][] = [
    ["connect", connected],
    ["offline", disconnected],
    ["close", disconnected],
    ["reconnect", disconnected],
    ["error", disconnected],
  ]
  for (const [event, listener] of events) client.on(event, listener)
  return {
    get connected() {
      return !closed && ready && client.connected
    },
    publish(delta) {
      if (closed || !ready || !client.connected)
        throw new Error("MQTT is offline; movement was discarded.")
      if (
        !Number.isInteger(delta) ||
        delta === 0 ||
        Math.abs(delta) > ESP_MAX_PAN_DELTA
      )
        throw new Error("Invalid bounded pan delta.")
      client.publish(
        configuration.topic,
        JSON.stringify({ x: delta }),
        { qos: 0, retain: false },
        (error) => {
          if (error) disconnected()
        }
      )
    },
    close() {
      if (closed) return
      closed = true
      ready = false
      for (const [event, listener] of events)
        client.removeListener(event, listener)
      // Keep teardown errors handled after removing state listeners.
      client.on("error", () => {})
      client.end(true)
    },
  }
}
