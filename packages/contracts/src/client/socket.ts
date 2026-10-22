import type { z } from "zod";

export type SocketStatus = "CONNECTING" | "OPEN" | "RECONNECTING" | "CLOSED";

export type TypedSocketOptions<In extends z.ZodType> = {
  url: string;
  /** Schema for messages coming FROM the other side. Invalid frames are dropped with a console warning. */
  incoming: In;
  onMessage: (message: z.infer<In>) => void;
  onStatus?: (status: SocketStatus) => void;
  /** Called on every (re)connect — send hello / stream.start here. */
  onOpen?: () => void;
  /** Reconnect with backoff (default true). */
  reconnect?: boolean;
};

export type TypedSocket<Out> = {
  send: (message: Out) => void;
  /** ArrayBuffer, typed array / DataView, or Blob. */
  sendBinary: (data: ArrayBuffer | ArrayBufferView<ArrayBuffer> | Blob) => void;
  close: () => void;
  readonly status: SocketStatus;
};

/** Browser/Bun WebSocket wrapper: JSON + zod validation in, typed JSON out, auto-reconnect. */
export function createTypedSocket<In extends z.ZodType, Out>(options: TypedSocketOptions<In>): TypedSocket<Out> {
  let ws: WebSocket | null = null;
  let status: SocketStatus = "CONNECTING";
  let attempt = 0;
  let closedByUser = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const setStatus = (next: SocketStatus) => {
    status = next;
    options.onStatus?.(next);
  };

  const connect = () => {
    ws = new WebSocket(options.url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      attempt = 0;
      setStatus("OPEN");
      options.onOpen?.();
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let json: unknown;
      try {
        json = JSON.parse(event.data);
      } catch {
        console.warn("[socket] non-JSON frame dropped", event.data);
        return;
      }
      const parsed = options.incoming.safeParse(json);
      if (parsed.success) options.onMessage(parsed.data);
      else console.warn("[socket] frame does not match contract", json, parsed.error.issues);
    };
    ws.onclose = () => {
      if (closedByUser || options.reconnect === false) return setStatus("CLOSED");
      setStatus("RECONNECTING");
      const delay = Math.min(10_000, 500 * 2 ** attempt++);
      retryTimer = setTimeout(connect, delay);
    };
  };

  setStatus("CONNECTING");
  connect();

  return {
    send: (message) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    },
    sendBinary: (data) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(data as never);
    },
    close: () => {
      closedByUser = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    },
    get status() {
      return status;
    },
  };
}
