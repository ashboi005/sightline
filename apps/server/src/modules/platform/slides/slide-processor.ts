/**
 * OWNER: Tushar. Turns an uploaded PDF/PPTX into page images + extracted text.
 */
import type { Slide } from "@sightline/contracts";
import { fixtures, toSlideBullets } from "@sightline/mocks";

import { notImplemented } from "../../../lib/errors";
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

  async process(_input: ProcessSlidesInput): Promise<Slide[]> {
    await new Promise((r) => setTimeout(r, 1500));
    return Promise.all(
      fixtures.lecture.slides.slides.map(async (s) => {
        const assetId = await this.assets.put("image/svg+xml", new TextEncoder().encode(renderSlideSvg(s)));
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

/**
 * TODO(tushar): PDF → PNG per page (pdftoppm / pdf.js) + text per page (pdftotext -layout);
 * PPT/PPTX → PDF first via LibreOffice headless (add to the server Dockerfile). Split bullets by line.
 */
export class FileSlideProcessor implements SlideProcessor {
  readonly name = "file";

  async process(_input: ProcessSlidesInput): Promise<Slide[]> {
    throw notImplemented("FileSlideProcessor.process", "Tushar");
  }
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
