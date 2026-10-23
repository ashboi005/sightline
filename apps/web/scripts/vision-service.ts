import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

export async function startVisionService() {
  const directory = fileURLToPath(
    new URL("../../../vision/", import.meta.url)
  )
  const python = `${directory}.venv/bin/python`
  if (!existsSync(python)) {
    console.warn(
      "Object tracking needs setup from the repository root: SAM2_BUILD_CUDA=0 uv sync --project vision --frozen && uv run --project vision vision/prepare.py"
    )
    return null
  }
  const secret = randomBytes(32).toString("hex")
  const process = Bun.spawn([python, "service.py"], {
    cwd: directory,
    env: { ...globalThis.process.env, GAZE_VISION_SECRET: secret },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  })
  const reader = process.stdout.getReader()
  let output = ""
  try {
    const ready = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          throw new Error("Local vision service exited before starting.")
        }
        output += new TextDecoder().decode(value)
        const lines = output.split("\n")
        output = lines.pop() ?? ""
        for (const line of lines) {
          try {
            const info: unknown = JSON.parse(line)
            if (
              info &&
              typeof info === "object" &&
              "port" in info &&
              Number.isInteger(info.port) &&
              Number(info.port) > 0 &&
              Number(info.port) <= 65535
            ) {
              return Number(info.port)
            }
          } catch {
            /* Startup diagnostics can precede the readiness line. */
          }
        }
      }
    }
    let timeout: ReturnType<typeof setTimeout> | undefined
    const port = await Promise.race([
      ready(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Vision startup timed out.")),
          20000
        )
      }),
    ]).finally(() => clearTimeout(timeout))
    // Drain model startup diagnostics; never buffer frame data or log the secret.
    void (async () => {
      while (!(await reader.read()).done) {
        /* drain */
      }
    })().catch(() => {})
    return {
      url: `http://127.0.0.1:${port}`,
      secret,
      stop: () => process.kill(),
    }
  } catch (failure) {
    process.kill()
    reader.releaseLock()
    console.warn(
      failure instanceof Error ? failure.message : "Vision could not start."
    )
    return null
  }
}
