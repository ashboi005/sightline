import { startVisionService } from "./vision-service"

type Companion = NonNullable<Awaited<ReturnType<typeof startVisionService>>>
type WebProcess = { exited: Promise<number>; kill(): void }
type ProductionDependencies = {
  environment: NodeJS.ProcessEnv
  signals: Pick<NodeJS.EventEmitter, "once" | "removeListener">
  startVision: typeof startVisionService
  spawn: (command: string[], environment: NodeJS.ProcessEnv) => WebProcess
}

/** Own the optional companion while preserving the standalone Node/Varlock entry point. */
export async function startProductionServer(options: Partial<ProductionDependencies> = {}) {
  const {
    environment = process.env,
    signals = process,
    startVision = startVisionService,
    spawn = (command, env) => Bun.spawn(command, {
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  } = options
  let companion: Companion | null = null
  let web: WebProcess | null = null
  let stopping = false
  let signalExitCode: number | undefined
  const releaseCompanion = () => {
    const owned = companion
    companion = null
    owned?.stop()
  }
  const stop = (exitCode?: number) => {
    if (stopping) return
    stopping = true
    signalExitCode = exitCode
    web?.kill()
    releaseCompanion()
  }
  const interrupt = () => stop(130)
  const terminate = () => stop(143)
  const exit = () => stop()
  signals.once("SIGINT", interrupt)
  signals.once("SIGTERM", terminate)
  signals.once("exit", exit)
  try {
    if (environment.SIGHTLINE_LOCAL_VISION === "1") {
      companion = await startVision()
    }
    if (stopping) return signalExitCode ?? 0
    web = spawn([
      environment.SIGHTLINE_WEB_NODE || "node",
      "--import",
      "varlock/auto-load",
      "server.js",
    ], {
      ...environment,
      GAZE_VISION_URL: companion?.url ?? environment.GAZE_VISION_URL ?? "",
      GAZE_VISION_SECRET: companion?.secret ?? environment.GAZE_VISION_SECRET ?? "",
    })
    const code = await web.exited
    return signalExitCode ?? code
  } finally {
    web?.kill()
    releaseCompanion()
    signals.removeListener("SIGINT", interrupt)
    signals.removeListener("SIGTERM", terminate)
    signals.removeListener("exit", exit)
  }
}

if (import.meta.main) {
  process.exitCode = await startProductionServer()
}
