/**
 * Everything the web app needs, mocked, in one terminal:
 *   - the server with USE_MOCK_DATA=true (replayed Kirchhoff lecture, demo user, seeded demo lecture, local storage)
 *   - the device mocks from packages/mocks: gaze bridge (:7777), sign service (:7788), speaker service (:7799)
 *
 *   bun run dev:demo            then, in another terminal: bun run dev:web
 *
 * The gaze mock reads this terminal's keys: b = board, s = screen, p = person, a = away, m = auto, q = quit.
 * MOCK_SIGN_AUTO=1 bun run dev:demo makes the sign mock recognise phrases without a webcam.
 */
import { spawn, type Subprocess } from "bun";

const env = {
  ...process.env,
  USE_MOCK_DATA: "true",
  MOCK_REPLAY_SPEED: process.env.MOCK_REPLAY_SPEED ?? "1.5",
};

const processes: [string, string[], "inherit" | "ignore"][] = [
  ["server", ["bun", "run", "dev:server"], "ignore"],
  ["gaze", ["bun", "run", "mock:gaze"], "inherit"],
  ["sign", ["bun", "run", "mock:sign"], "ignore"],
  ["speaker", ["bun", "run", "mock:speaker"], "ignore"],
];

const running: Subprocess[] = processes.map(([name, cmd, stdin]) => {
  console.log(`[demo] starting ${name}: ${cmd.join(" ")}`);
  return spawn({ cmd, env, stdin, stdout: "inherit", stderr: "inherit" });
});

const stop = () => {
  for (const p of running) p.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race(running.map((p) => p.exited));
stop();
