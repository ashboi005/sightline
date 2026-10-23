import { useEffect, useState, useSyncExternalStore } from "react"
import type {
  TrackerController,
  TrackerSource,
} from "../eye-tracking/use-tracker.types"
import { readCalibrationMethod } from "./calibration-preferences"
import { sceneEyeEvidence } from "./eye-evidence"
import type { EyeModel } from "../eye-tracking/eye-tracking.types"
import type { SceneCamera } from "./scene-camera"
import type { SceneSource } from "./scene-camera.types"
import { SceneSession } from "./scene-session"
export function stableSceneCameraKey(
  source: TrackerSource | SceneSource | null
) {
  if (!source) {
    return null
  }
  return JSON.stringify([
    source.kind,
    source.deviceId || source.url || source.name,
  ])
}
export function stableSceneSetupKey(
  tracker: TrackerController,
  camera: SceneCamera,
  lockedModel: EyeModel | null
) {
  const scene = camera.getSnapshot()
  if (
    !tracker.settings.locked ||
    !tracker.source ||
    !scene.source ||
    !lockedModel ||
    tracker.dimensions.width <= 0 ||
    tracker.dimensions.height <= 0 ||
    camera.rawCanvas.width <= 0 ||
    camera.rawCanvas.height <= 0
  ) {
    return null
  }
  return JSON.stringify([
    stableSceneCameraKey(tracker.source),
    tracker.settings,
    tracker.dimensions,
    tracker.transform,
    scene.transform,
    stableSceneCameraKey(scene.source),
    camera.rawCanvas.width,
    camera.rawCanvas.height,
    lockedModel.center,
    lockedModel.radius,
  ])
}
export function useSceneSession(
  tracker: TrackerController,
  camera: SceneCamera,
  identity: string
) {
  const [session] = useState(() => new SceneSession(readCalibrationMethod()))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  useEffect(() => {
    session.setCameraOrientation({
      eye: tracker.transform,
      scene: camera.getSnapshot().transform,
    })
  }, [session, tracker.transform, camera, identity])
  useEffect(() => {
    session.invalidate()
  }, [session, identity])
  useEffect(() => {
    const frame = tracker.frame
    if (!frame) {
      return
    }
    const now = performance.now()
    const { observation } = sceneEyeEvidence(
      frame,
      tracker.settings.locked,
      now
    )
    if (observation) {
      session.addEye(observation, now)
    }
  }, [session, tracker.frame, tracker.settings.locked, identity])
  useEffect(() => {
    const measure = () => {
      const now = performance.now()
      session.measure(camera.latest, now)
      session.checkCaptureFreshness(now)
    }
    const unsubscribe = camera.subscribe(measure)
    const timer = setInterval(measure, 100)
    return () => {
      unsubscribe()
      clearInterval(timer)
    }
  }, [camera, session])
  return { session, ...state }
}
