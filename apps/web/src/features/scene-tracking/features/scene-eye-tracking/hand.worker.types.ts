import type { SceneObservation } from "./scene.types"

export type HandWorkerRequest = {
  type: string
  generation: number
  scene: SceneObservation
  bitmap: ImageBitmap
}
