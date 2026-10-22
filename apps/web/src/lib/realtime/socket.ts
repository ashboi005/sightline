export type SocketStatus = "CONNECTING" | "OPEN" | "RECONNECTING" | "CLOSED";

/** What every connection (real or mock) gives you. Same shape the live-client helpers expect. */
export type Socket<Out> = {
  send: (message: Out) => void;
  /** Raw bytes, e.g. mic PCM on the session socket after `audio.start`. */
  sendBinary: (data: ArrayBuffer | ArrayBufferView<ArrayBuffer> | Blob) => void;
  close: () => void;
  readonly status: SocketStatus;
};

export type SocketHandlers<In> = {
  onMessage: (message: In) => void;
  onStatus?: (status: SocketStatus) => void;
};

/** JSON WebSocket with automatic reconnect (0.5 s, 1 s, 2 s … up to 10 s). `onOpen` runs on every (re)connect. */
export function createSocket<In extends { type: string }, Out>(
  url: string,
  handlers: SocketHandlers<In> & { onOpen?: () => void },
): Socket<Out> {
  let ws: WebSocket | null = null;
  let status: SocketStatus = "CONNECTING";
  let attempt = 0;
  let closedByUser = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const setStatus = (next: SocketStatus) => {
    status = next;
    handlers.onStatus?.(next);
  };

  const connect = () => {
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      attempt = 0;
      setStatus("OPEN");
      handlers.onOpen?.();
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        handlers.onMessage(JSON.parse(event.data) as In);
      } catch {
        console.warn("[socket] dropped a frame that isn't JSON", url);
      }
    };
    ws.onclose = () => {
      if (closedByUser) return setStatus("CLOSED");
      setStatus("RECONNECTING");
      retry = setTimeout(connect, Math.min(10_000, 500 * 2 ** attempt++));
    };
  };

  setStatus("CONNECTING");
  connect();

  return {
    send: (message) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    },
    sendBinary: (data) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(data);
    },
    close: () => {
      closedByUser = true;
      clearTimeout(retry);
      ws?.close();
    },
    get status() {
      return status;
    },
  };
}
