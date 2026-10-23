import cvModule from "@techstark/opencv-js"
import type { CV, OpenCvRuntime } from "./opencv.types"
let pending: Promise<OpenCvRuntime> | null = null
/** Lazy-loaded once in the worker; no remote script/CDN and no camera-frame upload. */
export function loadOpenCv(): Promise<OpenCvRuntime> {
  pending ??= (async () => {
    const imported = cvModule as unknown as CV | Promise<CV>
    const cv = imported instanceof Promise ? await imported : imported
    if (!cv.Mat) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(
              new Error(
                "The vision engine did not initialize. Reload to retry."
              )
            ),
          30000
        )
        cv.onRuntimeInitialized = () => {
          clearTimeout(timeout)
          resolve()
        }
      })
    }
    return { cv }
  })().catch((error) => {
    pending = null
    throw error
  })
  return pending
}
