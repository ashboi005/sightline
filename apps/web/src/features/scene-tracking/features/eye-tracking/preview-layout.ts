import type { FrameDimensions } from "./eye-tracking.types"
import type { PreviewCardFit, PreviewStage } from "./preview-layout.types"
export function fitPreviewFrame(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number
): FrameDimensions | null {
  if (
    ![sourceWidth, sourceHeight, maxWidth, maxHeight].every(
      (value) => Number.isFinite(value) && value > 0
    )
  ) {
    return null
  }
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight)
  return { width: sourceWidth * scale, height: sourceHeight * scale }
}
export function fitSquarePreview(
  maxWidth: number,
  maxHeight: number
): FrameDimensions | null {
  if (
    ![maxWidth, maxHeight].every((value) => Number.isFinite(value) && value > 0)
  ) {
    return null
  }
  const side = Math.min(maxWidth, maxHeight)
  return { width: side, height: side }
}
export function fitPreviewStage(
  sourceWidth: number | null,
  sourceHeight: number | null,
  maxWidth: number,
  maxHeight: number,
  chromeHeight: number
): PreviewStage | null {
  if (
    ![maxWidth, maxHeight, chromeHeight].every(Number.isFinite) ||
    maxWidth <= 0 ||
    maxHeight <= 0 ||
    chromeHeight < 0
  ) {
    return null
  }
  if (sourceWidth === null && sourceHeight === null) {
    const stage = fitSquarePreview(maxWidth, maxHeight)
    if (!stage || stage.height <= chromeHeight) {
      return null
    }
    return {
      ...stage,
      image: { width: stage.width, height: stage.height - chromeHeight },
    }
  }
  if (sourceWidth === null || sourceHeight === null) {
    return null
  }
  const image = fitPreviewFrame(
    sourceWidth,
    sourceHeight,
    maxWidth,
    maxHeight - chromeHeight
  )
  if (!image) {
    return null
  }
  return { width: image.width, height: image.height + chromeHeight, image }
}
export function fitPreviewCard(
  sourceWidth: number,
  sourceHeight: number,
  cardWidth: number,
  cardHeight: number,
  chromeHeight: number,
  footerHeight = 0
): PreviewCardFit | null {
  if (
    ![cardWidth, cardHeight, chromeHeight, footerHeight].every(
      Number.isFinite
    ) ||
    cardWidth <= 0 ||
    cardHeight <= 0 ||
    chromeHeight < 0 ||
    footerHeight < 0
  ) {
    return null
  }
  const previewHeight = cardHeight - footerHeight
  const image = fitPreviewFrame(
    sourceWidth,
    sourceHeight,
    cardWidth,
    previewHeight - chromeHeight
  )
  if (!image) {
    return null
  }
  return {
    card: { width: cardWidth, height: cardHeight },
    preview: { width: cardWidth, height: previewHeight },
    image,
  }
}
