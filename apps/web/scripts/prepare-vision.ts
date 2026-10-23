import { build } from "bun";
import { createHash } from "node:crypto";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const destination = path.join(root, "public/vision-runtime");
const handModel = path.join(root, "public/models/hand_landmarker.task");
const handModelDigest =
  "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1";
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
if (!(await Bun.file(handModel).exists())) {
  const response = await fetch(
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    { signal: AbortSignal.timeout(120_000) },
  );
  if (!response.ok)
    throw new Error(`Hand model download failed: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== handModelDigest)
    throw new Error("Hand model checksum mismatch");
  await Bun.write(handModel, bytes);
}
if (
  sha256(new Uint8Array(await Bun.file(handModel).arrayBuffer())) !==
  handModelDigest
)
  throw new Error(
    "Cached hand model checksum mismatch; remove it and rerun prepare:vision.",
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
