/**
 * OWNER: Tushar. Turns an uploaded PDF/PPTX into page images + extracted text.
 */
import type { Slide } from "@sightline/contracts";
import { fixtures, toSlideBullets } from "@sightline/mocks";

import { AppError } from "../../../lib/errors";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { newId } from "../../../lib/ids";
import type { AssetStore } from "../assets/asset-store";

export type ProcessSlidesInput = { sessionId: string; fileName: string; bytes: Uint8Array };

export interface SlideProcessor {
  readonly name: string;
  process(input: ProcessSlidesInput): Promise<Slide[]>;
}

/** Ignores the uploaded file and returns the Kirchhoff deck, rendered as SVG slides. */
export class MockSlideProcessor implements SlideProcessor {
  readonly name = "mock";

  constructor(
    private readonly assets: AssetStore,
    private readonly assetUrl: (assetId: string) => string,
  ) {}

  async process(input: ProcessSlidesInput): Promise<Slide[]> {
    await new Promise((r) => setTimeout(r, 1500));
    return Promise.all(
      fixtures.lecture.slides.slides.map(async (s) => {
        const assetId = await this.assets.put("image/svg+xml", new TextEncoder().encode(renderSlideSvg(s)), input.sessionId);
        return {
          id: newId("sld"),
          index: s.index,
          imageUrl: this.assetUrl(assetId),
          title: s.title,
          text: [s.title, ...s.bullets].join("\n"),
          bullets: toSlideBullets(s.bullets),
        };
      }),
    );
  }
}

export class FileSlideProcessor implements SlideProcessor {
  readonly name = "file";

  constructor(private readonly assets: AssetStore, private readonly assetUrl: (id: string) => string) {}

  async checkDependencies() {
    for (const command of ["pdfinfo", "pdftoppm", "pdftotext", "libreoffice"]) {
      if (!Bun.which(command)) throw new Error(`Real slides require ${command}; use the development server container`);
    }
  }

  async process(input: ProcessSlidesInput): Promise<Slide[]> {
    const extension = input.fileName.toLowerCase().match(/\.(pdf|ppt|pptx)$/)?.[1];
    if (!extension || input.bytes.length === 0) throw new AppError("VALIDATION_ERROR", "Empty or unsupported document");
    if (extension === "pdf" && new TextDecoder().decode(input.bytes.slice(0, 5)) !== "%PDF-") throw new AppError("VALIDATION_ERROR", "Invalid PDF signature");
    const directory = await mkdtemp(join(tmpdir(), "sightline-slides-"));
    try {
      const source = join(directory, `source.${extension}`);
      await Bun.write(source, input.bytes);
      if (extension !== "pdf") await runConverter(["libreoffice", `-env:UserInstallation=${pathToFileURL(join(directory, "profile")).href}`, "--headless", "--convert-to", "pdf", "--outdir", directory, source], directory);
      const pdf = join(directory, "source.pdf");
      const info = await runConverter(["pdfinfo", pdf], directory);
      const pageCount = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
      if (!Number.isInteger(pageCount) || pageCount <= 0) throw new AppError("VALIDATION_ERROR", "Document has no readable pages");
      await runConverter(["pdftoppm", "-png", "-scale-to", "1600", pdf, join(directory, "page")], directory);
      const images = (await readdir(directory)).filter((name) => /^page-\d+\.png$/.test(name)).sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
      if (images.length !== pageCount) throw new AppError("UPSTREAM_ERROR", "Conversion produced an incomplete deck");
      const slides: Slide[] = [];
      for (const [index, name] of images.entries()) {
        const text = (await runConverter(["pdftotext", "-f", String(index + 1), "-l", String(index + 1), "-layout", pdf, "-"], directory)).replace(/\f/g, "").trim();
        const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const assetId = await this.assets.put("image/png", new Uint8Array(await Bun.file(join(directory, name)).arrayBuffer()), input.sessionId);
        slides.push({ id: newId("sld"), index, imageUrl: this.assetUrl(assetId), title: lines[0] ?? null, text, bullets: lines.slice(1).map((line, bulletIndex) => ({ index: bulletIndex, text: line.replace(/^[•●▪\-]\s*/, "") })) });
      }
      return slides;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

async function runConverter(command: string[], cwd: string): Promise<string> {
  const process = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe", timeout: 120_000, killSignal: "SIGKILL" });
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (code !== 0) throw new AppError("VALIDATION_ERROR", `Document conversion failed (${command[0]}): ${stderr.slice(0, 400) || "converter exited or timed out"}`);
  return stdout;
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderSlideSvg(slide: { index: number; title: string; bullets: string[] }): string {
  const bullets = slide.bullets
    .map((b, i) => `<text x="80" y="${250 + i * 70}" font-size="34" fill="#1f2937">• ${escapeXml(b)}</text>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<rect width="1280" height="720" fill="#f8fafc"/>
<rect width="1280" height="12" fill="#2563eb"/>
<text x="80" y="150" font-family="Helvetica, Arial, sans-serif" font-size="56" font-weight="700" fill="#0f172a">${escapeXml(slide.title)}</text>
<g font-family="Helvetica, Arial, sans-serif">${bullets}</g>
<text x="1200" y="690" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#64748b" text-anchor="end">${slide.index + 1}</text>
</svg>`;
}
