"use client";

import type { SnapshotTrigger } from "@sightline/contracts";
import { Button } from "@sightline/ui/components/button";
import { Camera, ImagePlus } from "lucide-react";

import { useSnapshots } from "@/hooks/use-lecture-data";
import { assetUrl } from "@/lib/api";
import { formatClock } from "@/lib/recordings/timeline";

const WHY: Record<SnapshotTrigger, string> = {
  SPEECH_CUE: "The teacher pointed it out",
  BOARD_DWELL: "You looked at the board",
  VISUAL_CHANGE: "The board changed",
  POINTING: "The teacher pointed at it",
  MANUAL: "You saved it",
};
import { useLiveLecture } from "@/providers/live-lecture-provider";

/** Board snapshots: saved automatically (speech cues, board dwell, board changes) or with "Save board". */
export function BoardPanel() {
  const lecture = useLiveLecture();
  const snapshots = useSnapshots(lecture.activeId);
  const list = [...(snapshots.data ?? [])].sort((a, b) => b.capturedAt - a.capturedAt);

  return (
    <div className="space-y-3">
      {lecture.canSaveBoard ? (
        <Button variant="clay" onClick={() => void lecture.saveBoard()}>
          <ImagePlus /> Save board
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Turn on the scene camera to save the board into your notes.</p>
          <Button variant="clay-soft" onClick={() => void lecture.scene.start()}>
            <Camera /> Turn on scene camera
          </Button>
          {lecture.scene.error && <p className="text-sm text-destructive">{lecture.scene.error}</p>}
        </div>
      )}
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Snapshots of the board appear here and go into your notes.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2.5">
          {list.map((snap) => (
            <li key={snap.id}>
              <figure>
                <img src={assetUrl(snap.imageUrl)} alt={snap.description ?? snap.reason ?? "Board snapshot"} className="aspect-video w-full rounded-xl border bg-muted object-cover" />
                <figcaption className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {formatClock(snap.atMs)} · {WHY[snap.trigger]}
                  </span>{" "}
                  {snap.description ?? "Describing…"}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
