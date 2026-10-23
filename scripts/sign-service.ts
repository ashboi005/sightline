import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const action = process.argv[2];
const commands: Record<string, string[]> = {
  setup: ["sync", "--frozen"],
  dev: ["run", "--frozen", "sign-service"],
  test: ["run", "--frozen", "pytest", "-q"],
  verify: ["run", "--frozen", "python", "-m", "sign_service.verify_alphabet"],
  eval: ["run", "--frozen", "python", "-m", "sign_service.evaluate_videos"],
  camera: ["run", "--frozen", "sign-service-camera"],
};
if (!action || !commands[action]) throw new Error("Expected setup, dev, test, verify, eval or camera");
const child = Bun.spawn(["uv", ...commands[action], ...process.argv.slice(3)], {
  cwd: resolve(root, "apps/sign-service"), stdout: "inherit", stderr: "inherit",
  env: { ...process.env,
    UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? resolve(root, ".cache/uv"),
  },
});
process.exit(await child.exited);
