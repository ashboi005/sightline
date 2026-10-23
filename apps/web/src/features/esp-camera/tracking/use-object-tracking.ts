import { useEffect, useState, useSyncExternalStore } from "react"
import { ObjectTracking } from "./object-tracking"
import type { ViewerCamera } from "./viewer-camera.types"

export function useObjectTracking(
  scene: ViewerCamera,
  auxiliary: ViewerCamera,
  visible: boolean,
  supplied?: ObjectTracking
) {
  const [tracking] = useState(() => supplied ?? new ObjectTracking())
  const snapshot = useSyncExternalStore(
    tracking.subscribe,
    tracking.getSnapshot
  )
  useEffect(() => {
    if (!visible) {
      tracking.clear()
      return
    }
    const hidden = () => {
      if (document.hidden) {
        tracking.clear()
      }
    }
    document.addEventListener("visibilitychange", hidden)
    const timer = setInterval(() => {
      if (!document.hidden) {
        void tracking.tick(scene, auxiliary)
      }
    }, 33)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", hidden)
      tracking.clear()
    }
  }, [tracking, scene, auxiliary, visible])
  return { tracking, snapshot }
}
