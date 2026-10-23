import { createHash } from "node:crypto"
import { cp, mkdir, mkdtemp, rename, rm } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const destination = path.join(root, "public/voice-runtime")
const cache = path.resolve(root, "../../.local-reference/voice")
const checksum =
  "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498"
const archive = path.join(cache, "english.zip")
const model = path.join(destination, "english-0.15.tar.gz")
await mkdir(destination, { recursive: true })
await mkdir(cache, { recursive: true })
const packageRoot = path.dirname(
  require.resolve("@lichess-org/vosk-browser/package.json")
)
for (const file of ["vosk.worker.js", "vosk.wasm"]) {
  await cp(path.join(packageRoot, "dist", file), path.join(destination, file))
}
await cp(
  path.join(root, "scripts/microphone.worklet.js"),
  path.join(destination, "microphone.worklet.js")
)
await cp(
  path.join(root, "public/models/LICENSE"),
  path.join(destination, "LICENSE")
)
await cp(
  path.join(root, "scripts/voice-NOTICE.txt"),
  path.join(destination, "NOTICE.txt")
)
if (!(await Bun.file(model).exists())) {
  if (!(await Bun.file(archive).exists())) {
    const response = await fetch(
      "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip",
      { signal: AbortSignal.timeout(120_000) }
    )
    if (!response.ok) {
      throw new Error("English model download failed: " + response.status)
    }
    const bytes = await response.arrayBuffer()
    if (
      createHash("sha256").update(new Uint8Array(bytes)).digest("hex") !==
      checksum
    ) {
      throw new Error("English model checksum mismatch")
    }
    await Bun.write(archive, bytes)
  }
  const bytes = await Bun.file(archive).arrayBuffer()
  if (
    createHash("sha256").update(new Uint8Array(bytes)).digest("hex") !==
    checksum
  ) {
    throw new Error("Cached English model checksum mismatch")
  }
  const staging = await mkdtemp(path.join(cache, "prepare-"))
  const packed = path.join(staging, "english.tar.gz")
  try {
    for (const args of [
      ["unzip", "-q", archive, "-d", staging],
      ["tar", "-czf", packed, "-C", staging, "vosk-model-small-en-us-0.15"],
    ]) {
      const process = Bun.spawn(args, { stdout: "ignore", stderr: "inherit" })
      if (await process.exited) {
        throw new Error(
          "English model preparation failed (requires unzip and tar)"
        )
      }
    }
    await rename(packed, model)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
console.log("Prepared local English voice worker, WASM and model.")
