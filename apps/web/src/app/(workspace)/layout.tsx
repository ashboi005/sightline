"use client";

import { AuthGate } from "@/components/workspace/auth-gate";
import { WorkspaceShell } from "@/components/workspace/shell";
import { SceneProvider } from "@/providers/scene-provider";
import { GazeProvider } from "@/providers/gaze-provider";
import { LiveLectureProvider } from "@/providers/live-lecture-provider";

/** Every signed-in page shares one shell, one gaze connection and one running lecture. */
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGate>
      <GazeProvider>
        <SceneProvider>
          <LiveLectureProvider>
            <WorkspaceShell>{children}</WorkspaceShell>
          </LiveLectureProvider>
        </SceneProvider>
      </GazeProvider>
    </AuthGate>
  );
}
