import type {
  EspCameraObservation,
  EspCameraReply,
  EspCameraRequest,
} from "./server/types";

export type ControlSnapshot = {
  reply: EspCameraReply | null;
  busy: boolean;
  error: string;
};
export type ControlTransport = (
  request: EspCameraRequest,
  keepalive?: boolean,
) => Promise<EspCameraReply>;
const transport: ControlTransport = async (request, keepalive = false) => {
  const response = await fetch("/api/esp-camera", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    keepalive,
    signal: AbortSignal.timeout(request.action === "connect" ? 12_000 : 2500),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Camera control is unavailable.");
  return body as EspCameraReply;
};

/** Client intent prevents delayed requests from re-arming after Stop or a new connection. */
export class EspControlClient {
  private state: ControlSnapshot = { reply: null, busy: false, error: "" };
  private listeners = new Set<() => void>();
  private sessionId: string | null = null;
  private generation = 0;
  private intent = 0;
  private observing = false;
  private polling = false;
  private lastFrame = -1;
  private order = 0;
  private applied = 0;
  private clockOffset = 0;
  private releasing: Promise<unknown> = Promise.resolve();
  constructor(private request: ControlTransport = transport) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(next: Partial<ControlSnapshot>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }
  async connect(url: string, invertPan: boolean) {
    this.disconnect();
    const generation = this.generation;
    this.update({ busy: true, error: "" });
    try {
      await this.releasing;
      if (generation !== this.generation) return;
      const reply = await this.request({ action: "connect", url, invertPan });
      if (generation !== this.generation) {
        void this.request(
          { action: "disconnect", sessionId: reply.sessionId },
          true,
        ).catch(() => {});
        return;
      }
      this.sessionId = reply.sessionId;
      this.clockOffset = reply.serverTime - Date.now();
      this.update({ reply, busy: false });
    } catch (error) {
      if (generation === this.generation)
        this.update({ busy: false, error: message(error) });
    }
  }
  async observe(observation: EspCameraObservation) {
    if (
      !this.sessionId ||
      this.observing ||
      this.state.busy ||
      observation.frameId <= this.lastFrame
    )
      return;
    this.lastFrame = observation.frameId;
    this.observing = true;
    try {
      await this.send({
        action: "observe",
        sessionId: this.sessionId,
        observation: {
          ...observation,
          capturedAt: observation.capturedAt + this.clockOffset,
        },
        intent: this.intent,
      });
    } finally {
      this.observing = false;
    }
  }
  async poll() {
    if (!this.sessionId || this.polling || this.state.busy) return;
    this.polling = true;
    try {
      await this.send({ action: "status", sessionId: this.sessionId });
    } finally {
      this.polling = false;
    }
  }
  async track() {
    if (
      !this.sessionId ||
      this.state.busy ||
      this.state.reply?.status === "tracking" ||
      this.state.reply?.status === "paused"
    )
      return;
    this.update({ busy: true, error: "" });
    const generation = this.generation,
      intent = ++this.intent;
    await this.send({ action: "arm", sessionId: this.sessionId, intent });
    if (generation === this.generation && intent === this.intent)
      this.update({ busy: false });
  }
  stop(reason = "Following stopped. Confirm the target to track again.") {
    if (!this.sessionId) return;
    const intent = ++this.intent;
    this.applied = ++this.order;
    this.update({
      busy: false,
      reply: this.state.reply
        ? { ...this.state.reply, status: "stopped", message: reason, intent }
        : null,
    });
    void this.send({ action: "stop", sessionId: this.sessionId, intent }, true);
  }
  disconnect() {
    const sessionId = this.sessionId;
    this.generation++;
    this.intent = 0;
    this.sessionId = null;
    this.lastFrame = -1;
    this.update({ reply: null, busy: false, error: "" });
    if (sessionId)
      this.releasing = this.request(
        { action: "disconnect", sessionId },
        true,
      ).catch(() => {});
  }
  private async send(request: EspCameraRequest, keepalive = false) {
    const generation = this.generation,
      intent = this.intent,
      order = ++this.order;
    try {
      const reply = await this.request(request, keepalive);
      if (
        generation === this.generation &&
        intent === this.intent &&
        reply.intent === intent &&
        order >= this.applied
      ) {
        this.applied = order;
        // Using receive time includes network delay in the next frame's age, conservatively.
        if (request.action === "status")
          this.clockOffset = reply.serverTime - Date.now();
        this.update({ reply, error: "" });
      }
    } catch (error) {
      if (generation !== this.generation || intent !== this.intent) return;
      this.update({ error: message(error) });
      if (
        request.action !== "stop" &&
        (this.state.reply?.status === "tracking" ||
          this.state.reply?.status === "paused")
      )
        this.stop("Control connection lost. Following stopped.");
    }
  }
}
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Camera control is unavailable.";
}
