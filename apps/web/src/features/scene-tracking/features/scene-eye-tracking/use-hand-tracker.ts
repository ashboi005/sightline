import { useEffect, useState, useSyncExternalStore } from "react"
import { HandTracker } from "./hand-tracker"
import type { SceneCamera } from "./scene-camera"
export function useHandTracker(camera: SceneCamera, enabled: boolean) {
  const [tracker] = useState(() => new HandTracker(camera))
  const state = useSyncExternalStore(tracker.subscribe, tracker.getSnapshot)
  useEffect(() => {
    if (enabled) {
      tracker.start()
    }
    return () => tracker.dispose()
  }, [enabled, tracker])
  return { ...state, retry: () => tracker.start() }
}
