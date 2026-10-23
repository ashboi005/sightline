import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Only expose the HTTPS endpoint of a successfully started tunnel. */
export function publicWebSocketUrl(line: string): string | null {
  try {
    const entry = JSON.parse(line);
    if (entry.msg !== "started tunnel" || typeof entry.url !== "string") return null;
    const url = new URL(entry.url);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.protocol = "wss:";
    url.pathname = "/ws";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function signServicePort(env: Record<string, string | undefined> = process.env): number {
  const port = Number(env.SIGN_SERVICE_PORT ?? env.PORT ?? "7788");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Sign-service port must be 1–65535.");
  return port;
}

export function signTunnelArgs(env: Record<string, string | undefined> = process.env): string[] {
  const domain = env.NGROK_DOMAIN?.trim();
  const invalid = () => new Error(
    "Set NGROK_DOMAIN to your assigned static domain from https://dashboard.ngrok.com/domains " +
    "in the root .env.local or terminal environment. Temporary URLs are disabled.",
  );
  if (!domain) throw invalid();
  let url: URL;
  try {
    url = new URL(domain.includes("://") ? domain : "https://" + domain);
  } catch {
    throw invalid();
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.pathname !== "/" || url.search || url.hash ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(url.hostname)) throw invalid();
  return [
    "http", "http://127.0.0.1:" + signServicePort(env), "--url=" + url.origin,
    "--inspect=false", "--log=stdout", "--log-format=json",
  ];
}

async function main() {
  const args = signTunnelArgs();
  const port = signServicePort();
  const cached = resolve(root, ".cache/tools/ngrok", process.platform === "win32" ? "ngrok.exe" : "ngrok");
  const executable = process.env.NGROK_BIN || Bun.which("ngrok") || (existsSync(cached) ? cached : null);
  if (!executable) {
    throw new Error("Install ngrok on PATH or set NGROK_BIN to its executable. See apps/sign-service/README.md.");
  }
  console.log("[sign:tunnel] Forwarding only http://127.0.0.1:" + port);
  const child = Bun.spawn([
    executable, ...args,
  ], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: process.env });
  const stop = () => child.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  let announced = false;
  let errorCode = "";
  async function readLogs(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder();
    let pending = "";
    for await (const chunk of stream) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const url = publicWebSocketUrl(line);
        if (url && !announced) {
          announced = true;
          console.log("[sign:tunnel] WebSocket: " + url);
          console.log("NEXT_PUBLIC_SIGN_SERVICE_URL=" + url);
          console.log("[sign:tunnel] Keep this terminal open. Ctrl+C closes the public endpoint.");
        }
        // Do not echo raw agent errors: invalid-token errors may include credentials.
        errorCode ||= line.match(/ERR_NGROK_\d+/)?.[0] ?? "";
      }
    }
  }
  const results = await Promise.all([readLogs(child.stdout), readLogs(child.stderr), child.exited]);
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  if (results[2] !== 0) {
    console.error("[sign:tunnel] ngrok stopped" + (errorCode ? " (" + errorCode + ")" : "") +
      ". Check its account/configuration and whether another agent is running.");
  }
  process.exitCode = results[2];
}

if (import.meta.main) await main();
