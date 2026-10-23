import { expect, test } from "bun:test";
import { EspControlClient, type ControlTransport } from "./control-client";
import type { EspCameraReply, EspCameraRequest } from "./server/types";

const reply = (
  status: EspCameraReply["status"] = "connected",
  intent = 0,
): EspCameraReply => ({
  sessionId: "session",
  status,
  intent,
  message: status,
  camera: null,
  mqttConnected: true,
  deviceTelemetry: "unavailable",
  invertPan: false,
  leaseExpiresAt: 1000,
  canArm: true,
  serverTime: Date.now(),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a delayed Arm response cannot override Stop or send old-intent observations", async () => {
  const armed = deferred<EspCameraReply>(),
    calls: EspCameraRequest[] = [];
  const client = new EspControlClient(async (request) => {
    calls.push(request);
    if (request.action === "arm") return armed.promise;
    return reply(
      request.action === "stop" ? "stopped" : "connected",
      "intent" in request ? request.intent : 0,
    );
  });
  await client.connect("http://camera.local:81/stream", false);
  const pending = client.track();
  client.stop();
  armed.resolve(reply("tracking", 1));
  await pending;
  expect(client.getSnapshot().reply?.status).toBe("stopped");
  await client.observe({
    x: 0.8,
    confidence: 0.95,
    frameId: 1,
    capturedAt: 100,
  });
  const observation = calls.find((request) => request.action === "observe");
  expect(observation && "intent" in observation && observation.intent).toBe(2);
});
test("disconnect releases a connection that completes after leaving setup", async () => {
  const connected = deferred<EspCameraReply>(),
    calls: EspCameraRequest[] = [];
  const client = new EspControlClient(async (request) => {
    calls.push(request);
    return request.action === "connect"
      ? connected.promise
      : reply("disconnected");
  });
  const pending = client.connect("http://camera.local:81/stream", false);
  await Promise.resolve();
  client.disconnect();
  connected.resolve(reply());
  await pending;
  expect(client.getSnapshot().reply).toBeNull();
  expect(calls.at(-1)?.action).toBe("disconnect");
});
test("an old status response cannot resurrect tracking while Stop is in flight", async () => {
  const stopped = deferred<EspCameraReply>();
  const client = new EspControlClient(async (request) => {
    if (request.action === "arm") return reply("tracking", request.intent);
    if (request.action === "stop") return stopped.promise;
    if (request.action === "status") return reply("tracking", 1);
    return reply();
  });
  await client.connect("https://camera.example/stream", false);
  await client.track();
  client.stop();
  await client.poll();
  expect(client.getSnapshot().reply?.status).toBe("stopped");
  expect(client.getSnapshot().reply?.intent).toBe(2);
  stopped.resolve(reply("stopped", 2));
  await Promise.resolve();
  expect(client.getSnapshot().reply?.status).toBe("stopped");
});
test("frame timestamps use the server clock when the host and browser differ", async () => {
  const calls: EspCameraRequest[] = [];
  const client = new EspControlClient(async (request) => {
    calls.push(request);
    return { ...reply(), serverTime: Date.now() + 60_000 };
  });
  await client.connect("https://camera.example/stream", false);
  const timestamp = Date.now() - 50;
  await client.observe({
    x: 0.6,
    confidence: 0.9,
    frameId: 1,
    capturedAt: timestamp,
  });
  const observation = calls.find((request) => request.action === "observe");
  expect(
    observation?.action === "observe" &&
      Math.abs(observation.observation.capturedAt - timestamp - 60_000) < 20,
  ).toBe(true);
});
test("repeated frames are not submitted as new movement evidence", async () => {
  const calls: EspCameraRequest[] = [];
  const client = new EspControlClient(async (request) => {
    calls.push(request);
    return reply();
  });
  await client.connect("http://camera.local:81/stream", false);
  const frame = { x: 0.8, confidence: 0.95, frameId: 1, capturedAt: 100 };
  await client.observe(frame);
  await client.observe(frame);
  expect(calls.filter((request) => request.action === "observe")).toHaveLength(
    1,
  );
});
test("an old Arm completion does not unlock a new in-progress connection", async () => {
  const arm = deferred<EspCameraReply>(),
    connection = deferred<EspCameraReply>();
  let connections = 0;
  const transport: ControlTransport = async (request) => {
    if (request.action === "arm") return arm.promise;
    if (request.action === "connect" && ++connections > 1)
      return connection.promise;
    return reply();
  };
  const client = new EspControlClient(transport);
  await client.connect("http://camera.local:81/stream", false);
  const pendingArm = client.track();
  const pendingConnect = client.connect("http://other.local:81/stream", false);
  arm.resolve(reply("tracking", 1));
  await pendingArm;
  expect(client.getSnapshot().busy).toBe(true);
  connection.resolve(reply());
  await pendingConnect;
});
