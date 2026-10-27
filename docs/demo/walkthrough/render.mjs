// Renders walkthrough.html to an MP4, frame by frame (deterministic, no screen recording).
//   node render.mjs <out.mp4> [--ffmpeg <path>] [--fps 30] [--html walkthrough.html] [--channel chrome] [--stills 3,12.5,20]
// Needs the `playwright` package (with its Chromium, or `--channel chrome` for an installed Chrome) and ffmpeg.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const out = resolve(args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "sightline-walkthrough.mp4");
const fps = Number(flag("--fps", 30));
const ffmpeg = flag("--ffmpeg", "ffmpeg");
const stills = flag("--stills", null);

const browser = await chromium.launch({ channel: flag("--channel", undefined) });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(resolve(flag("--html", resolve(here, "walkthrough.html")))).href, { waitUntil: "networkidle" });
await page.evaluate(() => window.__ready);
const duration = await page.evaluate(() => window.__duration);

if (stills) {
  // Stills still step through every frame up to each time, so the eased caption scroll matches the video.
  mkdirSync(out, { recursive: true });
  const times = stills.split(",").map(Number).sort((a, b) => a - b);
  let frame = 0;
  for (const t of times) {
    while (frame / fps <= t) await page.evaluate((x) => window.__render(x), frame++ / fps);
    await page.screenshot({ path: resolve(out, `t${t.toFixed(2)}.png`) });
  }
} else {
  const enc = spawn(ffmpeg, [
    "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const total = Math.round(duration * fps);
  for (let f = 0; f < total; f++) {
    await page.evaluate((x) => window.__render(x), f / fps);
    const png = await page.screenshot({ type: "png" });
    if (!enc.stdin.write(png)) await new Promise((r) => enc.stdin.once("drain", r));
    if (f % fps === 0) process.stdout.write(`\r${(f / fps).toFixed(0)}s / ${duration}s`);
  }
  enc.stdin.end();
  await new Promise((r, j) => enc.on("close", (c) => (c === 0 ? r() : j(new Error(`ffmpeg exited ${c}`)))));
  console.log(`\nwrote ${out}`);
}
await browser.close();
