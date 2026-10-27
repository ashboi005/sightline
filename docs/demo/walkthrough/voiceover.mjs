// Generates the narration in voiceover.json with ElevenLabs and mixes it into the rendered video.
//   node voiceover.mjs <in.mp4> <out.mp4> [--env apps/server/.env] [--ffmpeg <path>] [--clips <dir>]
// Reads ELEVENLABS_API_KEY from the environment, or from the --env file. Clips are cached in --clips by voice and text,
// so re-running after a timing change only re-mixes; changing a line's text regenerates just that line.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const [input, output] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")).map((p) => resolve(p));
const ffmpeg = flag("--ffmpeg", "ffmpeg");
const clips = resolve(flag("--clips", resolve(here, "voiceover-clips")));
const envFile = flag("--env", null);

let key = process.env.ELEVENLABS_API_KEY;
if (!key && envFile) {
  const line = readFileSync(envFile, "utf8").split("\n").find((l) => /^ELEVENLABS_API_KEY\s*=/.test(l));
  key = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
}
if (!key) throw new Error("ELEVENLABS_API_KEY is not set (pass --env apps/server/.env)");

const script = JSON.parse(readFileSync(resolve(here, "voiceover.json"), "utf8"));
mkdirSync(clips, { recursive: true });

const duration = (file) => {
  let out = "";
  try {
    execFileSync(ffmpeg, ["-i", file], { stdio: "pipe" });
  } catch (e) {
    out = String(e.stderr);
  }
  const m = out.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
};

// A line may use its own voice (e.g. the laptop speaking for the student); neighbours only stitch within one voice.
const voiceOf = (line) => line?.voice_id ?? script.voice_id;
const files = [];
for (const [i, line] of script.lines.entries()) {
  const voice = voiceOf(line);
  const prev = script.lines[i - 1], next = script.lines[i + 1];
  const id = createHash("sha1").update(`${voice}|${script.model_id}|${line.text}`).digest("hex").slice(0, 10);
  const file = resolve(clips, `${String(i).padStart(2, "0")}-${id}.mp3`);
  if (!existsSync(file)) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text: line.text,
        model_id: script.model_id,
        previous_text: voiceOf(prev) === voice ? prev?.text : undefined,
        next_text: voiceOf(next) === voice ? next?.text : undefined,
        voice_settings: { stability: 0.55, similarity_boost: 0.75 },
      }),
    });
    if (!res.ok) throw new Error(`line ${i}: ${res.status} ${await res.text()}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const tempo = line.tempo ?? 1;
  const len = duration(file) / tempo;
  const overlap = line.at + len - (next?.at ?? Infinity);
  console.log(`${String(i).padStart(2)}  ${line.at.toFixed(1)}s  ${len.toFixed(2)}s${overlap > 0 ? `  OVERLAPS next line by ${overlap.toFixed(2)}s` : ""}`);
  files.push({ file, at: line.at, end: line.at + len, tempo });
}

// Hold the last frame if the narration runs past the end of the video.
const videoLen = duration(input);
const pad = Math.max(0, Math.max(...files.map((f) => f.end)) + 0.05 - videoLen);
const delays = files
  .map((f, i) => `[${i + 1}:a]${f.tempo !== 1 ? `atempo=${f.tempo},` : ""}adelay=${Math.round(f.at * 1000)}:all=1[a${i}]`)
  .join(";");
const mix = `${files.map((_, i) => `[a${i}]`).join("")}amix=inputs=${files.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
const video = pad > 0 ? `[0:v]tpad=stop_mode=clone:stop_duration=${pad.toFixed(2)}[vout];` : "";
execFileSync(ffmpeg, [
  "-y", "-loglevel", "error", "-i", input, ...files.flatMap((f) => ["-i", f.file]),
  "-filter_complex", `${video}${delays};${mix}`,
  "-map", pad > 0 ? "[vout]" : "0:v", "-map", "[aout]",
  ...(pad > 0 ? ["-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p"] : ["-c:v", "copy"]),
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", output,
], { stdio: "inherit" });
console.log(`wrote ${output}${pad > 0 ? ` (held the last frame ${pad.toFixed(2)}s longer for the narration)` : ""}`);
