export type NetworkSource = {
  localRelay?: boolean
  name: string
  streamUrl: string
} & (
  | {
      kind: "mjpeg"
      firstFrame: Uint8Array
      frames: AsyncGenerator<Uint8Array>
    }
  | {
      kind: "video"
      video: HTMLVideoElement
    }
)

export type DirectCameraResponse = { streamUrl: URL; response: Response }
