import { randomUUID } from "node:crypto"
import { connect } from "mqtt"
import { discoverCamera } from "./camera-http"
import { readServoConfiguration } from "./configuration"
import { createMqttGateway } from "./mqtt-gateway"
import { EspCameraService } from "./session-service"

const globalGateway = globalThis as typeof globalThis & { sightlineEspCameraService?: EspCameraService }

/** Lazy: importing the API route never connects to a device or MQTT broker. */
export function getEspCameraService(): EspCameraService {
  if (!globalGateway.sightlineEspCameraService) {
    const service = new EspCameraService({
      configuration: readServoConfiguration(process.env),
      now: Date.now,
      id: randomUUID,
      schedule(callback, delay) {
        const timer = setTimeout(callback, delay)
        timer.unref()
        return () => clearTimeout(timer)
      },
      createGateway: (configuration, onChange) => createMqttGateway(configuration, onChange, connect),
      discover: discoverCamera,
    })
    globalGateway.sightlineEspCameraService = service
    process.once("exit", () => service.disconnectAll())
  }
  return globalGateway.sightlineEspCameraService
}
