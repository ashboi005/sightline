import { fileURLToPath } from "node:url"
import { startVisionService } from "./vision-service"

export function applicationServerArguments(
  nextCli: string,
  command: "dev" | "start",
  extraArguments: string[],
  runtime = process.env.SIGHTLINE_WEB_NODE || Bun.which("node") || process.execPath
) {
  const args = [runtime, nextCli, command]
  if (command === "dev") args.push("--webpack")
  const hasPort = extraArguments.some((argument) =>
    argument === "--port" || argument === "-p" || argument.startsWith("--port=")
  )
  if (!hasPort) args.push("--port", process.env.PORT || "3001")
  return [...args, ...extraArguments]
}

async function runApplicationServer() {
  const supplied = process.argv.slice(2)
  const command = supplied[0] === "start" ? "start" : "dev"
  const extraArguments = supplied[0] === "start" || supplied[0] === "dev"
    ? supplied.slice(1)
    : supplied
  const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url))
  const vision = process.env.SIGHTLINE_LOCAL_VISION === "1"
    ? await startVisionService()
    : null
  let web: ReturnType<typeof Bun.spawn> | undefined
  const stop = () => {
    web?.kill()
    vision?.stop()
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  process.once("exit", stop)
  try {
    web = Bun.spawn(applicationServerArguments(nextCli, command, extraArguments), {
      env: {
        ...process.env,
        GAZE_VISION_URL: vision?.url ?? process.env.GAZE_VISION_URL ?? "",
        GAZE_VISION_SECRET: vision?.secret ?? process.env.GAZE_VISION_SECRET ?? "",
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    process.exitCode = await web.exited
  } finally {
    vision?.stop()
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
    process.removeListener("exit", stop)
  }
}

if (import.meta.main) {
  await runApplicationServer()
}
