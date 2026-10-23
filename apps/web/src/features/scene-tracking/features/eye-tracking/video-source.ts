import type { VideoReadyOptions } from "./video-source.types"
export function waitForVideoDimensions(
  video: HTMLVideoElement,
  { timeoutMs = 15000 }: VideoReadyOptions = {}
): Promise<void> {
  if (video.videoWidth && video.videoHeight) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      video.removeEventListener("loadeddata", onLoadedData)
      video.removeEventListener("error", onError)
    }
    const onLoadedData = () => {
      cleanup()
      if (video.videoWidth) {
        resolve()
        return
      }
      reject(new Error("Video has no image data."))
    }
    const onError = () => {
      cleanup()
      reject(new Error("Unable to read this video source."))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(
        new Error("Video did not become ready. Try reconnecting the camera.")
      )
    }, timeoutMs)
    video.addEventListener("loadeddata", onLoadedData, { once: true })
    video.addEventListener("error", onError, { once: true })
  })
}
export function getCameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Camera permission was denied. Allow camera access in your browser, then retry."
    }
    if (error.name === "NotFoundError") {
      return "No camera found. Connect a camera or open a recorded eye video."
    }
    if (error.name === "NotReadableError") {
      return "Camera is in use. Close the other camera app and retry."
    }
  }
  if (error instanceof Error) {
    return error.message
  }
  return "Unable to start the camera."
}
export function getVideoErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return "This video could not be decoded. Try an MP4 or WebM file."
}
