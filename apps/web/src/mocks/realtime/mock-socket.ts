import type { Socket, SocketHandlers, SocketStatus } from "@/lib/realtime/socket";

export type MockScript<In, Out> = (io: {
  emit: (message: In) => void;
  /** Timers that are cleared automatically when the socket closes. */
  after: (ms: number, fn: () => void) => void;
  every: (ms: number, fn: () => void) => void;
  /** Cancel every pending `after`/`every`, e.g. to restart a loop. */
  clearTimers: () => void;
}) => { onCommand?: (command: Out) => void };

/** A fake socket that "connects" after a short delay, then runs `script` in place of a server. */
export function createMockSocket<In, Out>(handlers: SocketHandlers<In>, script: MockScript<In, Out>): Socket<Out> {
  let status: SocketStatus = "CONNECTING";
  let timers: ReturnType<typeof setTimeout>[] = [];
  let intervals: ReturnType<typeof setInterval>[] = [];
  let onCommand: ((command: Out) => void) | undefined;

  const setStatus = (next: SocketStatus) => {
    status = next;
    handlers.onStatus?.(next);
  };
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    intervals.forEach(clearInterval);
    timers = [];
    intervals = [];
  };

  setStatus("CONNECTING");
  const opening = setTimeout(() => {
    setStatus("OPEN");
    onCommand = script({
      emit: (message) => status === "OPEN" && handlers.onMessage(message),
      after: (ms, fn) => void timers.push(setTimeout(fn, ms)),
      every: (ms, fn) => void intervals.push(setInterval(fn, ms)),
      clearTimers,
    }).onCommand;
  }, 300);

  return {
    send: (message) => status === "OPEN" && onCommand?.(message),
    sendBinary: () => {},
    close: () => {
      clearTimeout(opening);
      clearTimers();
      setStatus("CLOSED");
    },
    get status() {
      return status;
    },
  };
}
