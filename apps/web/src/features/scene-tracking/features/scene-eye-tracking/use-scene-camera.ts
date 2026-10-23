import { useEffect, useState, useSyncExternalStore } from "react"
import { SceneCamera } from "./scene-camera"
export function useSceneCamera(role: "scene" | "esp" = "scene") {
  const [camera] = useState(() => new SceneCamera(role))
  const state = useSyncExternalStore(camera.subscribe, camera.getSnapshot)
  useEffect(() => {
    camera.mount()
    return () => camera.dispose()
  }, [camera])
  return { camera, ...state }
}
