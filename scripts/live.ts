/**
 * One command for the REAL stack on this laptop (what we demo):
 *
 *   bun run live                       server (everything real) + web + speaker service + gaze (keyboard) + sign mock
 *   bun run live -- --gaze fake        gaze bridge with its scripted fake tracker (screen → board → person …)
 *   bun run live -- --gaze off         nothing on :7777 (when Arunya's real bridge is running separately)
 *   bun run live -- --speaker mock     2 fake faces instead of the real look → hear model
 *   bun run live -- --sign off         when Harnoor's service is reachable (set NEXT_PUBLIC_SIGN_SERVICE_URL in apps/web/.env)
 *   bun run live -- --mock             old dev:demo behaviour: server with USE_MOCK_DATA=true (replayed lecture, no keys)
 *   bun run live -- --skip server,web  you already run those yourself
 *
 * Gaze keys (default --gaze keys, typed in THIS terminal): b = board, s = screen, p = person, a = away, m = auto, q = quit.
 * Ctrl+C stops everything. Logs are prefixed per service.
 */
import { spawn, type Subprocess } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : fallback;
};
const mock = args.includes("--mock");
const gaze = opt("gaze", "keys"); // keys | fake | off
const speaker = opt("speaker", mock ? "mock" : "real"); // real | mock | off
const sign = opt("sign", "mock"); // mock | off
const skip = new Set(opt("skip", "").split(",").filter(Boolean));
const WEB_ORIGIN = "http://localhost:3001";

const color = { server: 36, web: 35, speaker: 33, gaze: 32, sign: 34, live: 1 } as const;
const log = (name: keyof typeof color, line: string) => console.log(`\x1b[${color[name]}m[${name}]\x1b[0m ${line}`);

// --- preflight -----------------------------------------------------------------------------------------------------
const problems: string[] = [];
const warn = (message: string) => log("live", `\x1b[33m⚠ ${message}\x1b[0m`);
const envFile = join(root, "apps/server/.env");
if (!existsSync(envFile)) problems.push("apps/server/.env is missing (cp apps/server/.env.example apps/server/.env)");
if (!mock && existsSync(envFile)) {
  const env = readFileSync(envFile, "utf8");
  const has = (key: string) => new RegExp(`^${key}=\\S+`, "m").test(env); // names only, values are never printed
  for (const key of ["DATABASE_URL", "BETTER_AUTH_SECRET", "MERGE_GATEWAY_API_KEY", "GEMINI_API_KEY", "QDRANT_URL"]) if (!has(key)) problems.push(`apps/server/.env: ${key} is empty`);
  if (!has("ELEVENLABS_API_KEY") && !has("SARVAM_API_KEY") && !has("DEEPGRAM_API_KEY")) problems.push("apps/server/.env: no speech-to-text key (ELEVENLABS_API_KEY / SARVAM_API_KEY / DEEPGRAM_API_KEY)");
  if (/^STORAGE_DRIVER=s3/m.test(env) && !has("S3_BUCKET")) problems.push("apps/server/.env: STORAGE_DRIVER=s3 but S3_BUCKET is empty");
  if (!Bun.which("pdftoppm")) warn("poppler not installed: PDF slides will fail (brew install poppler). .pptx still works as text slides.");
}
if (speaker === "real") {
  if (!Bun.which("uv")) {
    problems.push("uv is required for the real speaker service.");
  } else if (!existsSync(join(root, "apps/speaker-service/data/av-assets/manifest.json"))) {
    problems.push("AV-MossFormer2 models are missing. Run bun run speaker:setup before starting the real speaker service.");
  }
}
if (gaze === "fake" && !Bun.which("uv")) problems.push("--gaze fake needs uv (or use the default --gaze keys)");

const ports: [string, number, boolean][] = [
  ["server", 3000, !skip.has("server")],
  ["web", 3001, !skip.has("web")],
  ["gaze", 7777, gaze !== "off"],
  ["sign", 7788, sign !== "off"],
  ["speaker", 7799, speaker !== "off"],
];
for (const [name, port, needed] of ports) {
  if (!needed) continue;
  const owner = Bun.spawnSync(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).stdout.toString().trim();
  if (owner) problems.push(`port ${port} (${name}) is already in use by pid ${owner.split("\n").join(", ")}; stop it first (e.g. an old \`bun run dev\`)`);
}
if (problems.length) {
  for (const problem of problems) log("live", `\x1b[31m✘ ${problem}\x1b[0m`);
  process.exit(1);
}

// --- start ---------------------------------------------------------------------------------------------------------
type Service = { name: keyof typeof color; cmd: string[]; cwd: string; env?: Record<string, string>; stdin?: "inherit"; health?: string };
const allServices: Service[] = [
  {
    name: "server",
    cmd: ["bun", "run", "--hot", "src/index.ts"],
    cwd: join(root, "apps/server"),
    env: mock ? { USE_MOCK_DATA: "true", MOCK_REPLAY_SPEED: process.env.MOCK_REPLAY_SPEED ?? "1.5" } : { USE_MOCK_DATA: "false", MOCK_AUTH: "false" },
    health: "http://localhost:3000/api/health",
  },
  { name: "web", cmd: ["bun", "run", "dev"], cwd: join(root, "apps/web"), health: WEB_ORIGIN },
];
const services = allServices.filter((service) => !skip.has(service.name));
if (speaker === "real") services.push({ name: "speaker", cmd: ["uv", "run", "sightline-speaker", "--device", "auto", "--origin", WEB_ORIGIN], cwd: join(root, "apps/speaker-service"), health: "http://127.0.0.1:7799/health" });
if (speaker === "mock") services.push({ name: "speaker", cmd: ["bun", "servers/mock-speaker-service.ts"], cwd: join(root, "packages/mocks") });
if (gaze === "keys") services.push({ name: "gaze", cmd: ["bun", "servers/mock-gaze-bridge.ts"], cwd: join(root, "packages/mocks"), stdin: "inherit" });
if (gaze === "fake") services.push({ name: "gaze", cmd: ["uv", "run", "gaze-bridge", "--tracker", "fake"], cwd: join(root, "apps/gaze-bridge") });
if (sign === "mock") services.push({ name: "sign", cmd: ["bun", "servers/mock-sign-service.ts"], cwd: join(root, "packages/mocks") });

async function pipe(name: keyof typeof color, stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim()) log(name, line);
    }
  }
  if (buffer.trim()) log(name, buffer);
}

const running: { service: Service; proc: Subprocess<"inherit" | "ignore", "pipe", "pipe"> }[] = [];
for (const service of services) {
  log("live", `starting ${service.name}: ${service.cmd.join(" ")}`);
  const proc = spawn({
    cmd: service.cmd,
    cwd: service.cwd,
    env: { ...process.env, FORCE_COLOR: "1", ...service.env },
    stdin: service.stdin ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  void pipe(service.name, proc.stdout);
  void pipe(service.name, proc.stderr);
  running.push({ service, proc });
}

let stopping = false;
const stop = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  log("live", "stopping everything…");
  for (const { proc } of running) proc.kill("SIGTERM");
  await Promise.race([Promise.all(running.map(({ proc }) => proc.exited)), Bun.sleep(4000)]);
  for (const { proc } of running) if (proc.exitCode === null) proc.kill("SIGKILL");
  process.exit(code);
};
process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));
for (const { service, proc } of running) {
  void proc.exited.then((code) => {
    if (stopping) return;
    log("live", `\x1b[31m${service.name} exited (code ${code}); stopping the rest\x1b[0m`);
    void stop(1);
  });
}

// --- wait until healthy, then print where everything is ----------------------------------------------------------
const deadline = Date.now() + 180_000;
for (const { service } of running) {
  if (!service.health) continue;
  while (!stopping && Date.now() < deadline) {
    const ok = await fetch(service.health, { signal: AbortSignal.timeout(2000) }).then((r) => r.status < 500).catch(() => false);
    if (ok) break;
    await Bun.sleep(1000);
  }
}
if (!stopping) {
  const health = (await fetch("http://localhost:3000/api/health").then((r) => r.json()).catch(() => null)) as { mocks?: Record<string, boolean> } | null;
  const mocked = Object.entries(health?.mocks ?? {}).filter(([, on]) => on).map(([name]) => name);
  log("live", "\x1b[32m✔ ready\x1b[0m");
  log("live", `  web       ${WEB_ORIGIN}   (sign up, then New lecture)`);
  log("live", `  server    http://localhost:3000   modules mocked: ${mocked.length ? mocked.join(", ") : "none — everything real"}`);
  log("live", `  speaker   ${speaker === "off" ? "off" : `ws://127.0.0.1:7799/live (${speaker})`}`);
  log("live", `  gaze      ${gaze === "off" ? "off (external bridge)" : gaze === "keys" ? "ws://localhost:7777 — press b/s/p/a here to move the student's gaze, m = auto" : "ws://localhost:7777 (fake tracker)"}`);
  log("live", `  sign      ${sign === "off" ? "off (NEXT_PUBLIC_SIGN_SERVICE_URL)" : "ws://localhost:7788/ws (mock)"}`);
  log("live", "  demo      docs/demo/demo-script.md   ·   Ctrl+C stops everything");
  // The real look → hear model loads in the background after the service is up (~10–30 s).
  if (speaker === "real") {
    while (!stopping && Date.now() < deadline + 120_000) {
      const state = (await fetch("http://127.0.0.1:7799/health").then((r) => r.json()).catch(() => null)) as { ready?: boolean; error?: string | null } | null;
      if (state?.ready) { log("speaker", "\x1b[32m✔ look → hear model loaded\x1b[0m"); break; }
      if (state?.error) { log("speaker", `\x1b[31m✘ model failed to load: ${state.error}\x1b[0m`); break; }
      await Bun.sleep(2000);
    }
  }
}
