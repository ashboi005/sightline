import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react"
import { MarkerTracker } from "./marker-tracker"
import type { SceneCamera } from "./scene-camera"
export function useMarkerTracker(camera: SceneCamera, enabled: boolean) {
  const tracker = useMemo(() => new MarkerTracker(camera), [camera])
  const state = useSyncExternalStore(tracker.subscribe, tracker.getSnapshot)
  useEffect(() => {
    if (enabled) {
      tracker.start()
    }
    return () => tracker.dispose()
  }, [enabled, tracker])
  const retry = useCallback(() => {
    if (enabled) {
      tracker.start()
    }
  }, [enabled, tracker])
  return { ...state, retry }
}
