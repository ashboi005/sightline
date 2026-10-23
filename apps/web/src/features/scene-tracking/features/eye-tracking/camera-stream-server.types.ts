export type CameraStreamDependencies = {
  appOrigin?: string
  resolve?: (hostname: string) => Promise<string[]>
  fetch?: typeof fetch
}
