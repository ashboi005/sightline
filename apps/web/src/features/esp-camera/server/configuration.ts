// The firmware subscribes to this broker. No request body can override it.
export const ESP_MQTT_BROKER_URL = "mqtt://broker.hivemq.com:1883"
// Matches firmware commit d67f4b3, src/mqtt_config.h.
export const ESP_SERVO_TOPIC = "esp32cam/kate/servo/delta"
// This mount turns left for positive X and right for negative X.
export const ESP_DEFAULT_INVERT_PAN = true
// Normal following stays bounded; a 50-degree move is only a manual diagnostic.
export const ESP_MAX_PAN_DELTA = 6
export const ESP_PAN_COMMAND_INTERVAL_MS = 250
export const SERVO_TOPIC_PATTERN =
  /^esp32cam\/(?:kate|[a-f0-9]{32})\/servo\/delta$/

export type ServoConfiguration = {
  brokerUrl: string
  topic: string
  username?: string
  password?: string
}

export function readServoConfiguration(
  environment: Record<string, string | undefined>
): ServoConfiguration {
  const topic = environment.ESP_MQTT_TOPIC?.trim() || ESP_SERVO_TOPIC
  if (topic && !SERVO_TOPIC_PATTERN.test(topic))
    throw new Error("The configured ESP MQTT topic is invalid.")
  const brokerUrl = environment.ESP_MQTT_URL || ESP_MQTT_BROKER_URL
  let broker: URL
  try {
    broker = new URL(brokerUrl)
  } catch {
    throw new Error("The configured MQTT broker URL is invalid.")
  }
  if (
    !["mqtt:", "mqtts:"].includes(broker.protocol) ||
    !broker.hostname ||
    broker.username ||
    broker.password ||
    broker.search ||
    broker.hash ||
    (broker.pathname && broker.pathname !== "/")
  ) {
    throw new Error(
      "Configure a mqtt:// or mqtts:// broker and separate MQTT credentials."
    )
  }
  return {
    brokerUrl,
    topic,
    username: environment.ESP_MQTT_USERNAME,
    password: environment.ESP_MQTT_PASSWORD,
  }
}
