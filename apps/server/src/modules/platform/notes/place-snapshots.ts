import type { GenerateNotesInput, NoteSection, Snapshot } from "@sightline/contracts";

export function placeSnapshots(sections: NoteSection[], snapshots: Snapshot[], transcript: GenerateNotesInput["transcript"]) {
  const segments = new Map(transcript.map((segment) => [segment.id, segment]));
  const placed = new Set(sections.flatMap((section) => section.blocks.flatMap((block) => block.type === "image" ? [block.snapshotId] : [])));
  const additions = new Map<NoteSection, NoteSection["blocks"]>();
  for (const snapshot of [...snapshots].sort((left, right) => left.atMs - right.atMs || left.id.localeCompare(right.id))) {
    if (placed.has(snapshot.id)) continue;
    let target: NoteSection | undefined;
    let greatestOverlap = 0;
    for (const section of sections) {
      const overlap = section.sourceSegmentIds.filter((id) => snapshot.segmentIds.includes(id)).length;
      if (overlap > greatestOverlap) { target = section; greatestOverlap = overlap; }
    }
    if (!target) {
      let nearestDistance = Infinity;
      for (const section of sections) {
        for (const id of section.sourceSegmentIds) {
          const segment = segments.get(id);
          if (!segment) continue;
          const distance = Math.max(segment.startMs - snapshot.atMs, snapshot.atMs - segment.endMs, 0);
          if (distance < nearestDistance) { target = section; nearestDistance = distance; }
        }
      }
    }
    if (!target) {
      const before = [...transcript].sort((left, right) => right.startMs - left.startMs).find((segment) => segment.startMs <= snapshot.atMs && segment.slidePointer);
      target = sections.find((section) => before?.slidePointer && section.slideIndexes.includes(before.slidePointer.slideIndex)) ?? sections.at(-1);
    }
    if (!target) continue;
    const blocks = additions.get(target) ?? [];
    blocks.push({ type: "image", snapshotId: snapshot.id, url: snapshot.imageUrl, caption: snapshot.description ?? snapshot.reason });
    additions.set(target, blocks);
    placed.add(snapshot.id);
  }
  for (const [section, blocks] of additions) section.blocks.splice(Math.min(1, section.blocks.length), 0, ...blocks);
}
