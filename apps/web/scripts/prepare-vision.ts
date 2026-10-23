import { build } from "bun";
import { createHash } from "node:crypto";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const destination = path.join(root, "public/vision-runtime");
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
/** Downloads a pinned MediaPipe model once and checks it on every run. */
async function prepareModel(name: string, url: string, digest: string) {
  const file = path.join(root, "public/models", name);
  if (!(await Bun.file(file).exists())) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok)
      throw new Error(`${name} download failed: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (sha256(bytes) !== digest) throw new Error(`${name} checksum mismatch`);
    await Bun.write(file, bytes);
  }
  if (sha256(new Uint8Array(await Bun.file(file).arrayBuffer())) !== digest)
    throw new Error(
      `Cached ${name} checksum mismatch; remove it and rerun prepare:vision.`,
    );
}
await prepareModel(
  "hand_landmarker.task",
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1",
);
// Webcam attention: head pose tells whether the student faces the screen, looks up at the board or away.
await prepareModel(
  "face_landmarker.task",
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
);
const packageRoot = path.dirname(
  require.resolve("@mediapipe/tasks-vision/package.json"),
);
await mkdir(destination, { recursive: true });
await cp(path.join(packageRoot, "wasm"), path.join(destination, "wasm"), {
  recursive: true,
});
await cp(
  path.join(root, "public/models/LICENSE"),
  path.join(destination, "LICENSE"),
);
const result = await build({
  entrypoints: [
    path.join(
      root,
      "src/features/scene-tracking/features/scene-eye-tracking/hand.worker.ts",
    ),
  ],
  target: "browser",
  format: "iife",
  minify: true,
  outdir: destination,
  naming: "scene-hand.worker.js",
});
if (!result.success) {
  throw new Error(result.logs.map(String).join("\n"));
}
console.log("Prepared pinned MediaPipe worker and WASM assets.");
