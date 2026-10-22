import { createHash } from "node:crypto";
import type { IngestContextInput } from "@sightline/contracts";

export type KnowledgeChunk = { id: string; text: string; source: "TEXT" | "SLIDE"; slideIndex: number | null; bulletIndex: number | null };

export function chunkContext(input: IngestContextInput): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  const add = (text: string, source: KnowledgeChunk["source"], slideIndex: number | null, bulletIndex: number | null) => {
    const normalized = text.trim();
    if (!normalized) return;
    for (let offset = 0; offset < normalized.length; offset += 2400) {
      const content = normalized.slice(offset, offset + 2400);
      const hash = createHash("sha256").update(JSON.stringify([input.sessionId, source, slideIndex, bulletIndex, offset, content])).digest("hex");
      const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      chunks.push({ id, text: content, source, slideIndex, bulletIndex });
    }
  };
  for (const paragraph of (input.text ?? "").split(/\n\s*\n/)) add(paragraph, "TEXT", null, null);
  for (const slide of input.slides) {
    add([slide.title, slide.text].filter(Boolean).join("\n"), "SLIDE", slide.index, null);
    for (const bullet of slide.bullets) add([slide.title, bullet.text].filter(Boolean).join(": "), "SLIDE", slide.index, bullet.index);
  }
  return chunks;
}

export class BoundedCache<Value> {
  private readonly entries = new Map<string, { value: Value; expires: number }>();
  constructor(private readonly capacity = 512, private readonly ttlMs = 300_000) {}
  get(key: string): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= Date.now()) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: Value) {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
    if (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }
  clear() { this.entries.clear(); }
}
