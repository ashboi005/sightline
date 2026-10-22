import type { LectureNotes, NoteBlock, Snapshot } from "@sightline/contracts";
import { AppError, notFound } from "../../../lib/errors";
import type { AssetStore } from "../assets/asset-store";
import { renderNotes } from "./render";

export async function exportNotes(notes: LectureNotes, snapshots: Snapshot[], assets: AssetStore): Promise<string> {
  if (!notes.sections.some((section) => section.blocks.some((block) => block.type === "image"))) return notes.markdown;
  const trusted = new Map(snapshots.filter((snapshot) => snapshot.sessionId === notes.sessionId).map((snapshot) => [snapshot.id, snapshot]));
  const embedded = new Map<string, string>();
  let size = 0;
  const sections = [];
  for (const section of notes.sections) {
    const blocks: NoteBlock[] = [];
    for (const block of section.blocks) {
      if (block.type !== "image") { blocks.push(block); continue; }
      const snapshot = trusted.get(block.snapshotId);
      if (!snapshot || snapshot.imageUrl !== block.url) throw new AppError("VALIDATION_ERROR", "Notes reference an unknown snapshot");
      const assetId = new URL(snapshot.imageUrl, "http://assets.local").pathname.match(/^\/api\/assets\/(ast_[a-z0-9]+)$/)?.[1];
      if (!assetId || await assets.getSessionId(assetId) !== notes.sessionId) throw notFound("Snapshot asset");
      let url = embedded.get(assetId);
      if (!url) {
        const asset = await assets.get(assetId);
        if (!asset) throw notFound("Snapshot asset");
        if (!["image/png", "image/jpeg", "image/webp"].includes(asset.contentType)) throw new AppError("VALIDATION_ERROR", "Snapshot export requires a PNG, JPEG or WebP image");
        size += asset.bytes.byteLength;
        if (size > 20 * 1024 * 1024) throw new AppError("VALIDATION_ERROR", "Snapshot images exceed the 20 MiB Markdown export limit");
        url = `data:${asset.contentType};base64,${Buffer.from(asset.bytes).toString("base64")}`;
        embedded.set(assetId, url);
      }
      blocks.push({ ...block, url });
    }
    sections.push({ ...section, blocks });
  }
  return renderNotes({ ...notes, sections });
}
