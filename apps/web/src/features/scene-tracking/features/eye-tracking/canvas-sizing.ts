export function setCanvasDimensions(
  canvas: Pick<HTMLCanvasElement, "width" | "height">,
  width: number,
  height: number
) {
  if (canvas.width !== width) {
    canvas.width = width
  }
  if (canvas.height !== height) {
    canvas.height = height
  }
}
