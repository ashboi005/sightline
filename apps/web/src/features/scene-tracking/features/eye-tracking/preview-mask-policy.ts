const previewMaskIntervalMs = 200
export function shouldIncludePreviewMasks(
  enabled: boolean,
  timestamp: number,
  lastMaskTimestamp: number
) {
  return enabled && timestamp - lastMaskTimestamp >= previewMaskIntervalMs
}
